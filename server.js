const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const STORE_PATH = path.join(ROOT, 'data', 'planner-store.json');

const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const TOKEN_SECRET = process.env.TOKEN_SECRET;
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS || 60 * 60 * 8);

if (!AUTH_PASSWORD || !TOKEN_SECRET) {
  console.error('FATAL: AUTH_PASSWORD and TOKEN_SECRET environment variables must be set. Refusing to start with insecure defaults.');
  process.exit(1);
}

const LOGIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const loginAttemptsByIp = new Map();

function isLoginRateLimited(ip) {
  const now = Date.now();
  const attempts = (loginAttemptsByIp.get(ip) || []).filter((ts) => now - ts < LOGIN_RATE_LIMIT_WINDOW_MS);
  attempts.push(now);
  loginAttemptsByIp.set(ip, attempts);
  return attempts.length > LOGIN_RATE_LIMIT_MAX_ATTEMPTS;
}

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({
      state: { projectName: 'Project Planner' },
      version: 0,
      updatedAt: null,
    }, null, 2));
  }
}

function normalizeStoreShape(input) {
  if (!input || typeof input !== 'object') {
    return { state: {}, version: 0, updatedAt: null };
  }

  if (Object.prototype.hasOwnProperty.call(input, 'state') && Object.prototype.hasOwnProperty.call(input, 'version')) {
    return {
      state: input.state && typeof input.state === 'object' ? input.state : {},
      version: Number.isInteger(input.version) ? input.version : 0,
      updatedAt: typeof input.updatedAt === 'string' || input.updatedAt == null ? input.updatedAt : null,
    };
  }

  return {
    state: input,
    version: 0,
    updatedAt: null,
  };
}

function readStore() {
  try {
    ensureStore();
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeStoreShape(parsed);
  } catch (error) {
    console.warn('Unable to read planner data store, returning empty state.', error);
    return { state: {}, version: 0, updatedAt: null };
  }
}

function isWithinRoot(targetPath) {
  return targetPath === ROOT || targetPath.startsWith(ROOT + path.sep);
}

function writeStore(store) {
  ensureStore();
  const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
  fs.renameSync(tempPath, STORE_PATH);
}

let storeWriteQueue = Promise.resolve();

function withStoreLock(task) {
  const run = storeWriteQueue.then(task, task);
  storeWriteQueue = run.catch(() => {});
  return run;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, status, contentType, contentBuffer, filename) {
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  };
  if (filename) headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  res.writeHead(status, headers);
  res.end(contentBuffer);
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Malformed token' };
  const [header, body, signature] = parts;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${body}`).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return { ok: false, reason: 'Bad signature' };
  }

  const payload = safeJsonParse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'Invalid payload' };
  if (!payload.exp || Date.now() >= payload.exp * 1000) return { ok: false, reason: 'Token expired' };
  if (!payload.iat || payload.exp - payload.iat > TOKEN_TTL_SECONDS) return { ok: false, reason: 'Invalid token lifetime' };
  return { ok: true, payload };
}

function getAuthToken(req) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return '';
  return token;
}

function requireAuth(req, res) {
  const token = getAuthToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Missing bearer token', code: 'UNAUTHORIZED' });
    return null;
  }
  const verified = verifyToken(token);
  if (!verified.ok) {
    sendJson(res, 401, { error: verified.reason, code: 'UNAUTHORIZED' });
    return null;
  }
  return verified.payload;
}

function parseDateString(value) {
  if (!value || typeof value !== 'string') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) return '';
  return asDate.toISOString().slice(0, 10);
}

function getSheetRows(workbook, names) {
  const sheetName = names.find((name) => workbook.Sheets[name]);
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
}

function getCellValue(row, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
  }
  return '';
}

function parseBoolean(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y';
}

function parseNumber(value, fallback = 0) {
  const trimmed = String(value ?? '').trim();
  if (trimmed === '') return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DASHBOARD_STATUS_OPTIONS = new Set(['Not Started', 'In Progress', 'Complete', 'Overdue', 'On Hold']);
const PRIORITY_OPTIONS = new Set(['High', 'Medium', 'Low']);
const REQUIRED_IMPORT_SHEETS = ['milestones', 'tasks', 'dashboard_tasks', 'timeline'];
const REQUIRED_PLANNER_FIELDS = ['projectName', 'objective', 'dueDate', 'reward', 'notes'];
const REQUIRED_DASHBOARD_FIELDS = [
  'projectName',
  'dashDate',
  'dashStatus',
  'dashSummary',
  'budgetPlanned',
  'budgetActual',
  'pending.decisions',
  'pending.actions',
  'pending.changeRequests',
];

function isDateString(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function isBooleanText(value) {
  if (value == null || value === '') return true;
  const normalized = String(value).trim().toLowerCase();
  return ['true', 'false', 'yes', 'no', '1', '0', 'y', 'n'].includes(normalized);
}

function getSheetHeaders(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(String(cell?.v ?? '').trim());
  }
  return headers.filter((header) => header.length > 0);
}

function collectWorkbookValidationErrors(workbook) {
  const errors = [];
  const sheetNames = workbook.SheetNames || [];

  REQUIRED_IMPORT_SHEETS.forEach((sheet) => {
    if (!sheetNames.includes(sheet)) {
      errors.push({ field: sheet, message: `Missing required sheet '${sheet}'.` });
    }
  });

  const hasPlannerFields = sheetNames.includes('planner_fields');
  const hasDashboardFields = sheetNames.includes('dashboard_fields');
  const hasSummary = sheetNames.includes('summary');
  if ((!hasPlannerFields || !hasDashboardFields) && !hasSummary) {
    errors.push({
      field: 'planner_fields/dashboard_fields',
      message: "Workbook must include both 'planner_fields' and 'dashboard_fields', or a legacy 'summary' sheet.",
    });
  }

  if (hasPlannerFields) {
    const plannerRows = getSheetRows(workbook, ['planner_fields']);
    const fields = new Set(plannerRows.map((row) => String(getCellValue(row, ['Field'])).trim()).filter(Boolean));
    REQUIRED_PLANNER_FIELDS.forEach((field) => {
      if (!fields.has(field)) errors.push({ field: `planner_fields.${field}`, message: `Missing required planner field '${field}'.` });
    });
    plannerRows.forEach((row, index) => {
      const key = String(getCellValue(row, ['Field'])).trim();
      const value = getCellValue(row, ['Value']);
      if (key === 'dueDate' && !isDateString(String(value || ''))) {
        errors.push({ field: `planner_fields row ${index + 2}`, message: "dueDate must be in YYYY-MM-DD format." });
      }
    });
  }

  if (hasDashboardFields) {
    const dashboardRows = getSheetRows(workbook, ['dashboard_fields']);
    const fields = new Set(dashboardRows.map((row) => String(getCellValue(row, ['Field'])).trim()).filter(Boolean));
    REQUIRED_DASHBOARD_FIELDS.forEach((field) => {
      if (!fields.has(field)) errors.push({ field: `dashboard_fields.${field}`, message: `Missing required dashboard field '${field}'.` });
    });
    dashboardRows.forEach((row, index) => {
      const key = String(getCellValue(row, ['Field'])).trim();
      const value = getCellValue(row, ['Value']);
      if (key === 'dashDate' && !isDateString(String(value || ''))) {
        errors.push({ field: `dashboard_fields row ${index + 2}`, message: "dashDate must be in YYYY-MM-DD format." });
      }
      if ((key === 'budgetPlanned' || key === 'budgetActual' || key.startsWith('pending.'))) {
        const trimmed = String(value ?? '').trim();
        if (trimmed !== '' && !Number.isFinite(Number(trimmed))) {
          errors.push({ field: `dashboard_fields row ${index + 2}`, message: `${key} must be a number.` });
        }
      }
    });
  }

  if (sheetNames.includes('milestones')) {
    const headers = new Set(getSheetHeaders(workbook, 'milestones'));
    ['ID', 'Milestone', 'Progress (0-5)', 'Due Date', 'Done (true/false)'].forEach((header) => {
      if (!headers.has(header)) errors.push({ field: 'milestones', message: `Missing required column '${header}' in milestones.` });
    });
    getSheetRows(workbook, ['milestones']).forEach((row, index) => {
      const progress = getCellValue(row, ['Progress (0-5)', 'Progress']);
      const due = String(getCellValue(row, ['Due Date', 'DueDate']) || '');
      const done = getCellValue(row, ['Done (true/false)', 'Done']);
      if (progress !== '' && (!Number.isFinite(Number(progress)) || Number(progress) < 0 || Number(progress) > 5)) {
        errors.push({ field: `milestones row ${index + 2}`, message: 'Progress must be a number from 0 to 5.' });
      }
      if (!isDateString(due)) {
        errors.push({ field: `milestones row ${index + 2}`, message: 'Due Date must be in YYYY-MM-DD format.' });
      }
      if (!isBooleanText(done)) {
        errors.push({ field: `milestones row ${index + 2}`, message: 'Done must be true/false (or yes/no).' });
      }
    });
  }

  if (sheetNames.includes('tasks')) {
    const headers = new Set(getSheetHeaders(workbook, 'tasks'));
    ['ID', 'Task Name', 'Start Date', 'End Date', 'Priority', 'Done (true/false)'].forEach((header) => {
      if (!headers.has(header)) errors.push({ field: 'tasks', message: `Missing required column '${header}' in tasks.` });
    });
    getSheetRows(workbook, ['tasks']).forEach((row, index) => {
      const start = String(getCellValue(row, ['Start Date', 'StartDate']) || '');
      const end = String(getCellValue(row, ['End Date', 'EndDate']) || '');
      const prio = String(getCellValue(row, ['Priority']) || '').trim();
      const done = getCellValue(row, ['Done (true/false)', 'Done']);
      if (!isDateString(start)) errors.push({ field: `tasks row ${index + 2}`, message: 'Start Date must be in YYYY-MM-DD format.' });
      if (!isDateString(end)) errors.push({ field: `tasks row ${index + 2}`, message: 'End Date must be in YYYY-MM-DD format.' });
      if (prio && !PRIORITY_OPTIONS.has(prio)) {
        errors.push({ field: `tasks row ${index + 2}`, message: "Priority must be one of: High, Medium, Low." });
      }
      if (!isBooleanText(done)) errors.push({ field: `tasks row ${index + 2}`, message: 'Done must be true/false (or yes/no).' });
    });
  }

  if (sheetNames.includes('dashboard_tasks')) {
    const headers = new Set(getSheetHeaders(workbook, 'dashboard_tasks'));
    ['ID', 'Task Name', 'Assigned To', 'Start Date', 'End Date', 'Status', 'Priority', 'Comments'].forEach((header) => {
      if (!headers.has(header)) errors.push({ field: 'dashboard_tasks', message: `Missing required column '${header}' in dashboard_tasks.` });
    });
    getSheetRows(workbook, ['dashboard_tasks']).forEach((row, index) => {
      const start = String(getCellValue(row, ['Start Date', 'StartDate']) || '');
      const end = String(getCellValue(row, ['End Date', 'EndDate']) || '');
      const status = String(getCellValue(row, ['Status']) || '').trim();
      const prio = String(getCellValue(row, ['Priority']) || '').trim();
      if (!isDateString(start)) errors.push({ field: `dashboard_tasks row ${index + 2}`, message: 'Start Date must be in YYYY-MM-DD format.' });
      if (!isDateString(end)) errors.push({ field: `dashboard_tasks row ${index + 2}`, message: 'End Date must be in YYYY-MM-DD format.' });
      if (status && !DASHBOARD_STATUS_OPTIONS.has(status)) {
        errors.push({ field: `dashboard_tasks row ${index + 2}`, message: 'Status must be one of: Not Started, In Progress, Complete, Overdue, On Hold.' });
      }
      if (prio && !PRIORITY_OPTIONS.has(prio)) {
        errors.push({ field: `dashboard_tasks row ${index + 2}`, message: 'Priority must be one of: High, Medium, Low.' });
      }
    });
  }

  if (sheetNames.includes('timeline')) {
    const headers = new Set(getSheetHeaders(workbook, 'timeline'));
    ['ID', 'Row Name', 'Marker Type (check/diamond)', 'Marked Days (comma-separated)'].forEach((header) => {
      if (!headers.has(header)) errors.push({ field: 'timeline', message: `Missing required column '${header}' in timeline.` });
    });
    getSheetRows(workbook, ['timeline']).forEach((row, index) => {
      const markerType = String(getCellValue(row, ['Marker Type (check/diamond)', 'Type']) || '').trim();
      if (markerType && markerType !== 'check' && markerType !== 'diamond') {
        errors.push({ field: `timeline row ${index + 2}`, message: "Marker Type must be 'check' or 'diamond'." });
      }
      const cellsRaw = String(getCellValue(row, ['Marked Days (comma-separated)', 'Cells']) || '').trim();
      if (!cellsRaw) return;
      const invalidDay = cellsRaw
        .split(',')
        .map((value) => value.trim())
        .find((value) => !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 30);
      if (invalidDay) {
        errors.push({ field: `timeline row ${index + 2}`, message: 'Marked Days must be comma-separated integers from 1 to 30.' });
      }
    });
  }

  return errors;
}

function createSheet(rows, headers) {
  if (Array.isArray(rows) && rows.length > 0) {
    return XLSX.utils.json_to_sheet(rows, { header: headers });
  }
  return XLSX.utils.json_to_sheet([], { header: headers });
}

function buildPlannerViewSheet(state) {
  const rows = [];
  rows.push(['Project Planner - Planner View']);
  rows.push([]);
  rows.push(['Project Name', state.projectName || '', 'Objective', state.objective || '']);
  rows.push(['Due Date', state.dueDate || '', 'Reward', state.reward || '']);
  rows.push([]);
  rows.push(['Milestones']);
  rows.push(['#', 'Milestone', 'Progress (0-5)', 'Due Date', 'Done']);
  (Array.isArray(state.milestones) ? state.milestones : []).forEach((m, i) => {
    rows.push([i + 1, m.text || '', m.progress ?? '', m.due || '', m.done ? 'true' : 'false']);
  });
  rows.push([]);
  rows.push(['Timeline (1-30 days)']);
  const timelineHeader = ['Row', 'Task', 'Type'];
  for (let d = 1; d <= 30; d += 1) timelineHeader.push(`D${d}`);
  rows.push(timelineHeader);
  (Array.isArray(state.gantt) ? state.gantt : []).forEach((g, i) => {
    const type = g.type === 'diamond' ? 'diamond' : 'check';
    const marker = type === 'diamond' ? '◆' : '✓';
    const daySet = new Set(Array.isArray(g.cells) ? g.cells : []);
    const row = [i + 1, g.name || '', type];
    for (let d = 1; d <= 30; d += 1) row.push(daySet.has(d) ? marker : '');
    rows.push(row);
  });
  rows.push([]);
  rows.push(['Tasks']);
  rows.push(['#', 'Task', 'Start Date', 'End Date', 'Priority', 'Done']);
  (Array.isArray(state.tasks) ? state.tasks : []).forEach((t, i) => {
    rows.push([i + 1, t.task || '', t.start || '', t.end || '', t.prio || '', t.done ? 'true' : 'false']);
  });
  rows.push([]);
  rows.push(['Notes', state.notes || '']);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 6 }, { wch: 36 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, ...Array(30).fill({ wch: 4 })];
  ws['!merges'] = [
    XLSX.utils.decode_range('A1:AF1'),
    XLSX.utils.decode_range('A6:E6'),
    XLSX.utils.decode_range('A15:AF15'),
    XLSX.utils.decode_range('A20:AF20'),
    XLSX.utils.decode_range('A23:F23'),
    XLSX.utils.decode_range('A' + rows.length + ':A' + rows.length),
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 7 };
  return ws;
}

function buildDashboardViewSheet(state) {
  const rows = [];
  rows.push(['Project Planner - Dashboard View']);
  rows.push([]);
  rows.push(['Project Name', state.projectName || '', 'Status', state.dashStatus || '', 'Date', state.dashDate || '']);
  rows.push(['Health Summary', state.dashSummary || '']);
  rows.push([]);
  rows.push(['Budget']);
  rows.push(['Planned', state.budgetPlanned ?? '', 'Actual', state.budgetActual ?? '']);
  rows.push([]);
  rows.push(['Pending']);
  rows.push(['Decisions', state.pending?.decisions ?? '', 'Actions', state.pending?.actions ?? '', 'Change Requests', state.pending?.changeRequests ?? '']);
  rows.push([]);
  rows.push(['Dashboard Tasks']);
  rows.push(['#', 'Task', 'Assigned To', 'Start Date', 'End Date', 'Status', 'Priority', 'Comments']);
  (Array.isArray(state.dashTasks) ? state.dashTasks : []).forEach((t, i) => {
    rows.push([i + 1, t.name || '', t.assigned || '', t.start || '', t.end || '', t.status || '', t.prio || '', t.comments || '']);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 6 }, { wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 40 }];
  ws['!merges'] = [
    XLSX.utils.decode_range('A1:H1'),
    XLSX.utils.decode_range('A4:H4'),
    XLSX.utils.decode_range('A6:D6'),
    XLSX.utils.decode_range('A9:F9'),
    XLSX.utils.decode_range('A12:H12'),
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 13 };
  return ws;
}

function toWorksheetRows(list, columns, includeOrder = false) {
  if (!Array.isArray(list)) return [];
  return list.map((item, index) => {
    const row = {};
    if (includeOrder) row.Order = index + 1;
    columns.forEach((column) => {
      row[column.label] = item?.[column.key] ?? '';
    });
    return row;
  });
}

function fromWorksheetRows(rows, columns, booleanKeys = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => {
    const item = { id: getCellValue(row, ['ID', 'Id', 'id']) || `import-${index + 1}` };
    columns.forEach((column) => {
      if (column.key === 'id') return;
      let value = getCellValue(row, [column.label, column.altLabel].filter(Boolean));
      if (booleanKeys.includes(column.key)) value = parseBoolean(value);
      item[column.key] = value ?? '';
    });
    return item;
  });
}

function buildWorkbookFromState(state) {
  const workbook = XLSX.utils.book_new();

  const plannerFieldRows = [
    { Field: 'projectName', Label: 'Project Name', Value: state.projectName || '' },
    { Field: 'objective', Label: 'Objective', Value: state.objective || '' },
    { Field: 'dueDate', Label: 'Due Date (YYYY-MM-DD)', Value: state.dueDate || '' },
    { Field: 'reward', Label: 'Achievement / Reward', Value: state.reward || '' },
    { Field: 'notes', Label: 'Notes', Value: state.notes || '' },
  ];

  const dashboardFieldRows = [
    { Field: 'projectName', Label: 'Project Name', Value: state.projectName || '' },
    { Field: 'dashDate', Label: 'Dashboard Date (YYYY-MM-DD)', Value: state.dashDate || '' },
    { Field: 'dashStatus', Label: 'Dashboard Status', Value: state.dashStatus || '' },
    { Field: 'dashSummary', Label: 'Project Health Summary', Value: state.dashSummary || '' },
    { Field: 'budgetPlanned', Label: 'Budget Planned', Value: state.budgetPlanned ?? '' },
    { Field: 'budgetActual', Label: 'Budget Actual', Value: state.budgetActual ?? '' },
    { Field: 'pending.decisions', Label: 'Pending Decisions', Value: state.pending?.decisions ?? '' },
    { Field: 'pending.actions', Label: 'Pending Actions', Value: state.pending?.actions ?? '' },
    { Field: 'pending.changeRequests', Label: 'Pending Change Requests', Value: state.pending?.changeRequests ?? '' },
  ];

  const legacySummary = [{
    projectName: state.projectName || '',
    objective: state.objective || '',
    dueDate: state.dueDate || '',
    reward: state.reward || '',
    notes: state.notes || '',
    dashDate: state.dashDate || '',
    dashStatus: state.dashStatus || '',
    dashSummary: state.dashSummary || '',
    budgetPlanned: state.budgetPlanned ?? '',
    budgetActual: state.budgetActual ?? '',
    pendingDecisions: state.pending?.decisions ?? '',
    pendingActions: state.pending?.actions ?? '',
    pendingChangeRequests: state.pending?.changeRequests ?? '',
  }];

  const milestoneColumns = [
    { key: 'id', label: 'ID' },
    { key: 'text', label: 'Milestone' },
    { key: 'progress', label: 'Progress (0-5)', altLabel: 'Progress' },
    { key: 'due', label: 'Due Date', altLabel: 'DueDate' },
    { key: 'done', label: 'Done (true/false)', altLabel: 'Done' },
  ];

  const taskColumns = [
    { key: 'id', label: 'ID' },
    { key: 'task', label: 'Task Name', altLabel: 'Task' },
    { key: 'start', label: 'Start Date', altLabel: 'StartDate' },
    { key: 'end', label: 'End Date', altLabel: 'EndDate' },
    { key: 'prio', label: 'Priority' },
    { key: 'done', label: 'Done (true/false)', altLabel: 'Done' },
  ];

  const dashTaskColumns = [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Task Name', altLabel: 'Task' },
    { key: 'assigned', label: 'Assigned To', altLabel: 'AssignedTo' },
    { key: 'start', label: 'Start Date', altLabel: 'StartDate' },
    { key: 'end', label: 'End Date', altLabel: 'EndDate' },
    { key: 'status', label: 'Status' },
    { key: 'prio', label: 'Priority' },
    { key: 'comments', label: 'Comments' },
  ];

  const ganttRows = (Array.isArray(state.gantt) ? state.gantt : []).map((row, index) => ({
    Order: index + 1,
    ID: row.id || '',
    'Row Name': row.name || '',
    'Marker Type (check/diamond)': row.type || 'check',
    'Marked Days (comma-separated)': Array.isArray(row.cells) ? row.cells.join(',') : '',
  }));

  const templateNotes = [
    { Section: 'How to use', Notes: 'Edit values and import the same workbook back to the app.' },
    { Section: 'Required sheets', Notes: 'planner_fields, dashboard_fields, milestones, tasks, dashboard_tasks, timeline' },
    { Section: 'Date format', Notes: 'Use YYYY-MM-DD for all date fields.' },
    { Section: 'Booleans', Notes: 'Use true/false or yes/no for Done fields.' },
    { Section: 'Statuses', Notes: 'Not Started, In Progress, Complete, Overdue, On Hold' },
    { Section: 'Priorities', Notes: 'High, Medium, Low' },
  ];

  const milestoneRows = toWorksheetRows(state.milestones, milestoneColumns, true);
  const taskRows = toWorksheetRows(state.tasks, taskColumns, true);
  const dashboardTaskRows = toWorksheetRows(state.dashTasks, dashTaskColumns, true);

  XLSX.utils.book_append_sheet(workbook, buildPlannerViewSheet(state), 'planner_view');
  XLSX.utils.book_append_sheet(workbook, buildDashboardViewSheet(state), 'dashboard_view');
  XLSX.utils.book_append_sheet(workbook, createSheet(templateNotes, ['Section', 'Notes']), 'template_notes');
  XLSX.utils.book_append_sheet(workbook, createSheet(plannerFieldRows, ['Field', 'Label', 'Value']), 'planner_fields');
  XLSX.utils.book_append_sheet(workbook, createSheet(dashboardFieldRows, ['Field', 'Label', 'Value']), 'dashboard_fields');
  XLSX.utils.book_append_sheet(workbook, createSheet(legacySummary, Object.keys(legacySummary[0])), 'summary');
  XLSX.utils.book_append_sheet(workbook, createSheet(milestoneRows, ['Order', ...milestoneColumns.map((column) => column.label)]), 'milestones');
  XLSX.utils.book_append_sheet(workbook, createSheet(taskRows, ['Order', ...taskColumns.map((column) => column.label)]), 'tasks');
  XLSX.utils.book_append_sheet(workbook, createSheet(dashboardTaskRows, ['Order', ...dashTaskColumns.map((column) => column.label)]), 'dashboard_tasks');
  XLSX.utils.book_append_sheet(workbook, createSheet(ganttRows, ['Order', 'ID', 'Row Name', 'Marker Type (check/diamond)', 'Marked Days (comma-separated)']), 'timeline');

  return workbook;
}

function buildTemplateState() {
  return {
    projectName: '',
    objective: '',
    dueDate: '',
    reward: '',
    notes: '',
    milestones: [],
    gantt: [],
    tasks: [],
    dashDate: '',
    dashStatus: '',
    dashSummary: '',
    budgetPlanned: '',
    budgetActual: '',
    pending: { decisions: '', actions: '', changeRequests: '' },
    dashTasks: [],
  };
}

function parseWorkbookToState(buffer, previousState) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const validationErrors = collectWorkbookValidationErrors(workbook);
  if (validationErrors.length > 0) {
    const validationError = new Error('Workbook validation failed.');
    validationError.code = 'EXCEL_VALIDATION_FAILED';
    validationError.validationErrors = validationErrors;
    throw validationError;
  }

  const state = {
    ...(previousState && typeof previousState === 'object' ? previousState : {}),
  };

  const plannerFieldRows = getSheetRows(workbook, ['planner_fields']);
  if (plannerFieldRows.length > 0) {
    const plannerFields = {};
    plannerFieldRows.forEach((row) => {
      const key = getCellValue(row, ['Field']).trim();
      const value = getCellValue(row, ['Value']);
      if (key) plannerFields[key] = value;
    });

    state.projectName = String(plannerFields.projectName || state.projectName || '');
    state.objective = String(plannerFields.objective || '');
    state.dueDate = parseDateString(String(plannerFields.dueDate || ''));
    state.reward = String(plannerFields.reward || '');
    state.notes = String(plannerFields.notes || '');
  }

  const dashboardFieldRows = getSheetRows(workbook, ['dashboard_fields']);
  if (dashboardFieldRows.length > 0) {
    const dashboardFields = {};
    dashboardFieldRows.forEach((row) => {
      const key = getCellValue(row, ['Field']).trim();
      const value = getCellValue(row, ['Value']);
      if (key) dashboardFields[key] = value;
    });

    state.projectName = String(dashboardFields.projectName || state.projectName || '');
    state.dashDate = parseDateString(String(dashboardFields.dashDate || ''));
    state.dashStatus = String(dashboardFields.dashStatus || '');
    state.dashSummary = String(dashboardFields.dashSummary || '');
    state.budgetPlanned = parseNumber(dashboardFields.budgetPlanned, 0);
    state.budgetActual = parseNumber(dashboardFields.budgetActual, 0);
    state.pending = {
      decisions: parseNumber(dashboardFields['pending.decisions'], 0),
      actions: parseNumber(dashboardFields['pending.actions'], 0),
      changeRequests: parseNumber(dashboardFields['pending.changeRequests'], 0),
    };
  }

  if (plannerFieldRows.length === 0 && dashboardFieldRows.length === 0) {
    const summaryRows = getSheetRows(workbook, ['summary']);
    if (summaryRows.length > 0) {
      const row = summaryRows[0];
      state.projectName = row.projectName || state.projectName || '';
      state.objective = row.objective || '';
      state.dueDate = parseDateString(row.dueDate) || '';
      state.reward = row.reward || '';
      state.notes = row.notes || '';
      state.dashDate = parseDateString(row.dashDate) || '';
      state.dashStatus = row.dashStatus || '';
      state.dashSummary = row.dashSummary || '';
      state.budgetPlanned = parseNumber(row.budgetPlanned, 0);
      state.budgetActual = parseNumber(row.budgetActual, 0);
      state.pending = {
        decisions: parseNumber(row.pendingDecisions, 0),
        actions: parseNumber(row.pendingActions, 0),
        changeRequests: parseNumber(row.pendingChangeRequests, 0),
      };
    }
  }

  const milestoneRows = getSheetRows(workbook, ['milestones']);
  const milestoneColumns = [
    { key: 'id', label: 'ID', altLabel: 'Id' },
    { key: 'text', label: 'Milestone', altLabel: 'Task/Milestone' },
    { key: 'progress', label: 'Progress (0-5)', altLabel: 'Progress' },
    { key: 'due', label: 'Due Date', altLabel: 'DueDate' },
    { key: 'done', label: 'Done (true/false)', altLabel: 'Done' },
  ];
  if (milestoneRows.length > 0) {
    state.milestones = fromWorksheetRows(milestoneRows, milestoneColumns, ['done']).map((item) => ({
      ...item,
      progress: Math.min(5, Math.max(0, parseNumber(item.progress, 0))),
      due: parseDateString(String(item.due || '')),
    }));
  }

  const taskRows = getSheetRows(workbook, ['tasks']);
  const taskColumns = [
    { key: 'id', label: 'ID', altLabel: 'Id' },
    { key: 'task', label: 'Task Name', altLabel: 'Task' },
    { key: 'start', label: 'Start Date', altLabel: 'StartDate' },
    { key: 'end', label: 'End Date', altLabel: 'EndDate' },
    { key: 'prio', label: 'Priority' },
    { key: 'done', label: 'Done (true/false)', altLabel: 'Done' },
  ];
  if (taskRows.length > 0) {
    state.tasks = fromWorksheetRows(taskRows, taskColumns, ['done']).map((item) => ({
      ...item,
      start: parseDateString(String(item.start || '')),
      end: parseDateString(String(item.end || '')),
    }));
  }

  const dashTaskRows = getSheetRows(workbook, ['dashboard_tasks']);
  const dashTaskColumns = [
    { key: 'id', label: 'ID', altLabel: 'Id' },
    { key: 'name', label: 'Task Name', altLabel: 'Task' },
    { key: 'assigned', label: 'Assigned To', altLabel: 'AssignedTo' },
    { key: 'start', label: 'Start Date', altLabel: 'StartDate' },
    { key: 'end', label: 'End Date', altLabel: 'EndDate' },
    { key: 'status', label: 'Status' },
    { key: 'prio', label: 'Priority' },
    { key: 'comments', label: 'Comments' },
  ];
  if (dashTaskRows.length > 0) {
    state.dashTasks = fromWorksheetRows(dashTaskRows, dashTaskColumns).map((item) => ({
      ...item,
      start: parseDateString(String(item.start || '')),
      end: parseDateString(String(item.end || '')),
    }));
  }

  const timelineRows = getSheetRows(workbook, ['timeline']);
  if (timelineRows.length > 0) {
    state.gantt = timelineRows.map((row, index) => ({
      id: getCellValue(row, ['ID', 'Id', 'id']) || `gantt-import-${index + 1}`,
      name: getCellValue(row, ['Row Name', 'Name']) || '',
      type: getCellValue(row, ['Marker Type (check/diamond)', 'Type']) === 'diamond' ? 'diamond' : 'check',
      cells: String(getCellValue(row, ['Marked Days (comma-separated)', 'Cells']) || '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    }));
  }

  return state;
}

function getPublicStoreResponse(store) {
  return {
    state: store.state || {},
    version: store.version || 0,
    updatedAt: store.updatedAt || null,
  };
}

function serveStaticFile(res, filePath) {
  const safePath = path.resolve(filePath);
  if (!isWithinRoot(safePath)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  const ext = path.extname(safePath).toLowerCase();
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
  }[ext] || 'application/octet-stream';

  fs.readFile(safePath, (error, contents) => {
    if (error) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    sendFile(res, 200, contentType, contents);
  });
}

function isConflict(currentVersion, expectedVersion, force) {
  if (force) return false;
  return Number(currentVersion) !== Number(expectedVersion ?? 0);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'project-planner',
      mode: 'no-database-file-store',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === '/api/planner/template.xlsx' && req.method === 'GET') {
    try {
      const workbook = buildWorkbookFromState(buildTemplateState());
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      sendFile(
        res,
        200,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer,
        'project-planner-template.xlsx',
      );
    } catch (error) {
      sendJson(res, 500, { error: 'Could not export workbook template', code: 'EXCEL_TEMPLATE_EXPORT_FAILED' });
    }
    return;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
      if (isLoginRateLimited(clientIp)) {
        sendJson(res, 429, { error: 'Too many login attempts. Try again later.', code: 'RATE_LIMITED' });
        return;
      }

      const body = await readRequestBody(req);
      const payload = safeJsonParse(body);
      if (!payload || typeof payload !== 'object') {
        sendJson(res, 400, { error: 'Invalid JSON payload', code: 'INVALID_JSON' });
        return;
      }

      const usernameBuffer = Buffer.from(String(payload.username || ''));
      const passwordBuffer = Buffer.from(String(payload.password || ''));
      const expectedUser = Buffer.from(AUTH_USER);
      const expectedPassword = Buffer.from(AUTH_PASSWORD);
      const userMatches = usernameBuffer.length === expectedUser.length && crypto.timingSafeEqual(usernameBuffer, expectedUser);
      const passMatches = passwordBuffer.length === expectedPassword.length && crypto.timingSafeEqual(passwordBuffer, expectedPassword);

      if (!userMatches || !passMatches) {
        sendJson(res, 401, { error: 'Invalid credentials', code: 'UNAUTHORIZED' });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const exp = now + TOKEN_TTL_SECONDS;
      const token = signToken({ sub: AUTH_USER, iat: now, exp });
      sendJson(res, 200, {
        ok: true,
        token,
        expiresInSeconds: TOKEN_TTL_SECONDS,
        tokenType: 'Bearer',
      });
      return;
    } catch (error) {
      sendJson(res, 500, { error: 'Login failed', code: 'LOGIN_FAILED' });
      return;
    }
  }

  if (url.pathname.startsWith('/api/')) {
    const authPayload = requireAuth(req, res);
    if (!authPayload) return;

    if (url.pathname === '/api/planner' && req.method === 'GET') {
      const store = readStore();
      sendJson(res, 200, getPublicStoreResponse(store));
      return;
    }

    if (url.pathname === '/api/planner' && req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        const payload = safeJsonParse(body);
        if (!payload || typeof payload !== 'object') {
          sendJson(res, 400, { error: 'Invalid JSON payload', code: 'INVALID_JSON' });
          return;
        }

        const result = await withStoreLock(() => {
          const current = readStore();
          if (isConflict(current.version, payload.expectedVersion, payload.force === true)) {
            return { conflict: true, current };
          }

          const next = {
            state: payload.state && typeof payload.state === 'object' ? payload.state : {},
            version: Number(current.version || 0) + 1,
            updatedAt: new Date().toISOString(),
            updatedBy: authPayload.sub,
          };
          writeStore(next);
          return { conflict: false, next };
        });

        if (result.conflict) {
          sendJson(res, 409, {
            error: 'Version conflict detected. Load latest data before saving, or force-save.',
            code: 'VERSION_CONFLICT',
            server: getPublicStoreResponse(result.current),
          });
          return;
        }

        sendJson(res, 200, { ok: true, saved: true, ...getPublicStoreResponse(result.next) });
      } catch (error) {
        sendJson(res, 500, { error: 'Could not save planner data', code: 'SAVE_FAILED' });
      }
      return;
    }

    if (url.pathname === '/api/planner/export.xlsx' && req.method === 'GET') {
      try {
        const store = readStore();
        const workbook = buildWorkbookFromState(store.state || {});
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        sendFile(
          res,
          200,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer,
          'project-planner.xlsx',
        );
      } catch (error) {
        sendJson(res, 500, { error: 'Could not export workbook', code: 'EXCEL_EXPORT_FAILED' });
      }
      return;
    }

    if (url.pathname === '/api/planner/import.xlsx' && req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        const payload = safeJsonParse(body);
        if (!payload || typeof payload !== 'object' || typeof payload.fileBase64 !== 'string') {
          sendJson(res, 400, { error: 'Invalid import payload', code: 'INVALID_IMPORT_PAYLOAD' });
          return;
        }

        const result = await withStoreLock(() => {
          const current = readStore();
          if (isConflict(current.version, payload.expectedVersion, payload.force === true)) {
            return { conflict: true, current };
          }

          const fileBuffer = Buffer.from(payload.fileBase64, 'base64');
          const parsedState = parseWorkbookToState(fileBuffer, current.state || {});
          const next = {
            state: parsedState,
            version: Number(current.version || 0) + 1,
            updatedAt: new Date().toISOString(),
            updatedBy: authPayload.sub,
          };
          writeStore(next);
          return { conflict: false, next };
        });

        if (result.conflict) {
          sendJson(res, 409, {
            error: 'Version conflict detected while importing spreadsheet.',
            code: 'VERSION_CONFLICT',
            server: getPublicStoreResponse(result.current),
          });
          return;
        }

        sendJson(res, 200, { ok: true, imported: true, ...getPublicStoreResponse(result.next) });
      } catch (error) {
        if (error && error.code === 'EXCEL_VALIDATION_FAILED') {
          sendJson(res, 422, {
            error: 'Workbook validation failed. Fix the listed fields and import again.',
            code: 'EXCEL_VALIDATION_FAILED',
            validationErrors: error.validationErrors || [],
          });
          return;
        }
        sendJson(res, 500, { error: 'Could not import workbook', code: 'EXCEL_IMPORT_FAILED' });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const targetPath = url.pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, url.pathname.replace(/^\//, ''));
  const resolvedPath = path.resolve(targetPath);

  if (isWithinRoot(resolvedPath) && fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    serveStaticFile(res, resolvedPath);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Project Planner backend running at http://localhost:${PORT}`);
});
