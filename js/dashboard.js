import { getState, scheduleSave, uid } from './state.js?v=dashboard-simple-20261010g';
import { parseDate, daysBetween, renderPieChart, renderLegend, renderGanttChart } from './charts.js?v=dashboard-simple-20261010g';

const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Complete', 'Overdue', 'On Hold'];
const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];
const DELETE_ICON = '\uD83D\uDDD1';
const REORDER_ICON = '\u2195';

const STATUS_COLORS = {
  'Not Started': '#bfdbfe',
  'In Progress': '#bbf7d0',
  Complete: '#16a34a',
  Overdue: '#f59e0b',
  'On Hold': '#cbd5e1',
};
const PRIORITY_COLORS = { High: '#ef4444', Medium: '#f59e0b', Low: '#22c55e' };

const BADGE_COLORS = {
  'ON TRACK': ['#bbf7d0', '#14532d'],
  'AT RISK': ['#fde68a', '#78350f'],
  'OFF TRACK': ['#fecaca', '#7f1d1d'],
};

function slug(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '-');
}

function effectiveStatus(task) {
  const base = task?.status || 'Not Started';
  return STATUS_OPTIONS.includes(base) ? base : 'Not Started';
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('data-')) node.setAttribute(key, value);
    else node[key] = value;
  });
  children.forEach((child) => node.appendChild(child));
  return node;
}

function findById(list, id) {
  return list.find((item) => item.id === id);
}

function rowIdOf(target) {
  return target.closest('tr')?.dataset.id;
}

// ---------- Header ----------

export function renderDashHeader() {
  const state = getState();
  const badge = document.getElementById('dash-status-badge');
  const status = state.dashStatus || 'ON TRACK';
  badge.textContent = status;
  const [bg, fg] = BADGE_COLORS[status.toUpperCase()] || ['#e2e8f0', '#334155'];
  badge.style.background = bg;
  badge.style.color = fg;

  const total = state.dashTasks.length;
  const complete = state.dashTasks.filter((t) => effectiveStatus(t) === 'Complete').length;
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
  document.getElementById('dash-pct-complete').textContent = `${pct}%`;
  const formulaEl = document.getElementById('dash-summary-formula');
  if (formulaEl) formulaEl.textContent = `${pct}% complete`;
}

function renderDashboardMetrics() {
  const state = getState();
  const container = document.getElementById('dashboard-kpis');
  if (!container) return;

  const tasks = state.dashTasks || [];
  const total = tasks.length;
  const complete = tasks.filter((t) => effectiveStatus(t) === 'Complete').length;
  const inProgress = tasks.filter((t) => effectiveStatus(t) === 'In Progress').length;
  const overdue = tasks.filter((t) => effectiveStatus(t) === 'Overdue').length;
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
  const health = (state.dashStatus || 'ON TRACK').toUpperCase();

  const cards = [
    { label: 'Completion', value: `${pct}%`, tone: 'primary' },
    { label: 'In progress', value: String(inProgress), tone: 'success' },
    { label: 'Overdue', value: String(overdue), tone: 'warning' },
    { label: 'Health', value: health, tone: 'neutral' },
  ];

  container.innerHTML = '';
  cards.forEach((card) => {
    const value = el('strong', { class: 'dashboard-kpi__value', text: card.value });
    const label = el('span', { class: 'dashboard-kpi__label', text: card.label });
    container.appendChild(el('div', { class: `dashboard-kpi dashboard-kpi--${card.tone}` }, [value, label]));
  });
}

// ---------- Gantt ----------

function renderDashGantt() {
  const state = getState();
  const items = state.dashTasks.map((t) => {
    const start = parseDate(t.start);
    const end = parseDate(t.end);
    const days = start && end ? daysBetween(start, end) + 1 : null;
    const status = effectiveStatus(t);
    return {
      label: t.name || '(untitled task)',
      start,
      end,
      color: STATUS_COLORS[status] || '#94a3b8',
      durationLabel: days ? `${days}d` : '',
    };
  });
  renderGanttChart(document.getElementById('dash-gantt'), items);
}

// ---------- Pies ----------

function renderPies() {
  const state = getState();
  const total = state.dashTasks.length;

  const statusSlices = STATUS_OPTIONS.map((s) => ({
    label: s,
    value: state.dashTasks.filter((t) => effectiveStatus(t) === s).length,
    color: STATUS_COLORS[s],
  }));
  renderPieChart(document.getElementById('status-pie'), statusSlices);
  renderLegend(document.getElementById('status-legend'), statusSlices, total);

  const prioSlices = PRIORITY_OPTIONS.map((p) => ({
    label: p,
    value: state.dashTasks.filter((t) => t.prio === p).length,
    color: PRIORITY_COLORS[p],
  }));
  renderPieChart(document.getElementById('priority-pie'), prioSlices);
  renderLegend(document.getElementById('priority-legend'), prioSlices, total);
}

// ---------- Budget / pending charts ----------

function renderBudgetChart() {
  const state = getState();
  const container = document.getElementById('budget-chart');
  container.innerHTML = '';
  const max = Math.max(state.budgetPlanned || 0, state.budgetActual || 0, 1);

  [
    { label: 'Planned', value: state.budgetPlanned || 0, color: 'var(--color-primary-light)' },
    { label: 'Actual', value: state.budgetActual || 0, color: 'var(--color-primary)' },
  ].forEach((row) => {
    const pct = Math.min(100, (row.value / max) * 100);
    container.appendChild(el('div', { class: 'bar-row' }, [
      el('span', { text: row.label }),
      el('div', { class: 'bar-row__track' }, [
        el('div', { class: 'bar-row__fill', style: `width:${pct}%;background:${row.color}` }),
      ]),
      el('span', { text: `$${row.value.toLocaleString()}` }),
    ]));
  });
}

function renderPendingChart() {
  const state = getState();
  const container = document.getElementById('pending-chart');
  container.innerHTML = '';
  const items = [
    { label: 'Decisions', value: state.pending.decisions || 0 },
    { label: 'Actions', value: state.pending.actions || 0 },
    { label: 'Change Requests', value: state.pending.changeRequests || 0 },
  ];
  const max = Math.max(...items.map((i) => i.value), 1);

  items.forEach((item) => {
    const heightPct = Math.max(2, (item.value / max) * 100);
    container.appendChild(el('div', { class: 'bar-col' }, [
      el('span', { class: 'bar-col__value', text: String(item.value) }),
      el('div', { class: 'bar-col__bar', style: `height:${heightPct}%` }),
      el('span', { class: 'bar-col__label', text: item.label }),
    ]));
  });
}

// ---------- Summary tables ----------

function renderSummaryTable(tableEl, options, counterField) {
  const state = getState();
  const total = state.dashTasks.length;
  tableEl.innerHTML = '';

  const thead = el('tr', {}, [el('th', { text: 'Value' }), el('th', { text: 'Count' }), el('th', { text: '%' })]);
  tableEl.appendChild(el('thead', {}, [thead]));

  const tbody = el('tbody');
  options.forEach((opt) => {
    const count = state.dashTasks.filter((t) => (counterField === 'status' ? effectiveStatus(t) : t[counterField]) === opt).length;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    tbody.appendChild(el('tr', {}, [el('td', { text: opt }), el('td', { text: String(count) }), el('td', { text: `${pct}%` })]));
  });
  tableEl.appendChild(tbody);

  const tfoot = el('tr', {}, [
    el('td', { class: 'total-row', text: 'Total' }),
    el('td', { class: 'total-row', text: String(total) }),
    el('td', { class: 'total-row', text: '100%' }),
  ]);
  tableEl.appendChild(el('tfoot', {}, [tfoot]));
}

function renderSummaries() {
  renderSummaryTable(document.getElementById('status-summary-table'), STATUS_OPTIONS, 'status');
  renderSummaryTable(document.getElementById('priority-summary-table'), PRIORITY_OPTIONS, 'prio');
}

// Recomputes everything derived from dashTasks (called after any dashboard edit).
function renderComputed() {
  renderDashHeader();
  renderDashboardMetrics();
  renderDashGantt();
  renderPies();
  renderSummaries();
}

// ---------- Dashboard task table ----------

function durationLabel(start, end) {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e) return '';
  const days = daysBetween(s, e) + 1;
  return days > 0 ? `${days}d` : '';
}

function buildSelect(options, value, dataField, classPrefix) {
  const select = el('select', { class: `${classPrefix}-select ${classPrefix}-${slug(value)}`, 'data-field': dataField });
  options.forEach((opt) => {
    select.appendChild(el('option', { value: opt, text: opt, selected: opt === value }));
  });
  return select;
}

function getPlannerTaskFilters() {
  return {
    query: (document.getElementById('planner-task-search')?.value || '').trim().toLowerCase(),
    status: document.getElementById('planner-task-filter-status')?.value || 'all',
    prio: document.getElementById('planner-task-filter-prio')?.value || 'all',
    sort: document.getElementById('planner-task-sort')?.value || 'manual',
  };
}

function compareIsoDate(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return String(a).localeCompare(String(b));
}

function getFilteredDashTasks() {
  const { query, status, prio, sort } = getPlannerTaskFilters();
  const list = [...getState().dashTasks];
  const filtered = list.filter((task) => {
    if (status !== 'all' && effectiveStatus(task) !== status) return false;
    if (prio !== 'all' && (task.prio || '') !== prio) return false;
    if (query) {
      const haystack = [
        task.name,
        task.assigned,
        task.comments,
        task.status,
        task.prio,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  if (sort === 'status') {
    filtered.sort((a, b) => STATUS_OPTIONS.indexOf(effectiveStatus(a)) - STATUS_OPTIONS.indexOf(effectiveStatus(b)));
  } else if (sort === 'priority') {
    filtered.sort((a, b) => PRIORITY_OPTIONS.indexOf(a.prio || 'Medium') - PRIORITY_OPTIONS.indexOf(b.prio || 'Medium'));
  } else if (sort === 'start') {
    filtered.sort((a, b) => compareIsoDate(a.start, b.start));
  } else if (sort === 'end') {
    filtered.sort((a, b) => compareIsoDate(a.end, b.end));
  } else if (sort === 'name') {
    filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  return filtered;
}

function renderDashTaskRow(t, index, canReorder) {
  const durationCell = el('td', { class: 'col-days', 'data-role': 'duration', text: durationLabel(t.start, t.end) });
  const effective = effectiveStatus(t);
  const overdue = effective === 'Overdue';

  return el('tr', { 'data-id': t.id, class: overdue ? 'drag-row is-overdue' : 'drag-row', draggable: canReorder }, [
    el('td', { class: 'col-num', text: String(index + 1) }),
    el('td', {}, [el('button', { type: 'button', class: 'drag-handle', 'data-action': 'drag-task', 'aria-label': 'Drag to reorder task', text: REORDER_ICON, disabled: !canReorder })]),
    el('td', {}, [el('input', { class: 'row-input', 'data-field': 'name', value: t.name || '', placeholder: 'Task name' })]),
    el('td', {}, [el('input', { class: 'row-input', 'data-field': 'assigned', value: t.assigned || '', placeholder: 'Assignee' })]),
    el('td', { class: 'col-date' }, [el('input', { type: 'date', class: 'row-input', 'data-field': 'start', value: t.start || '' })]),
    el('td', { class: 'col-date' }, [el('input', { type: 'date', class: 'row-input', 'data-field': 'end', value: t.end || '' })]),
    durationCell,
    el('td', { class: 'col-status' }, [buildSelect(STATUS_OPTIONS, effective, 'status', 'status')]),
    el('td', { class: 'col-prio' }, [buildSelect(PRIORITY_OPTIONS, t.prio, 'prio', 'prio')]),
    el('td', {}, [el('input', { class: 'row-input', 'data-field': 'comments', value: t.comments || '', placeholder: 'Comments' })]),
    el('td', { class: 'col-action no-print' }, [el('button', { type: 'button', class: 'icon-btn', 'data-action': 'delete-dash-task', 'aria-label': 'Delete task', text: DELETE_ICON })]),
  ]);
}

function renderDashTasks() {
  const tbody = document.getElementById('dash-tasks-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  const { sort } = getPlannerTaskFilters();
  const canReorder = sort === 'manual';
  getFilteredDashTasks().forEach((t, i) => tbody.appendChild(renderDashTaskRow(t, i, canReorder)));
}

function bindDashTasks() {
  const tbody = document.getElementById('dash-tasks-body');
  if (!tbody) return;
  let dragId = null;

  function reorderDashTasks(fromId, toId) {
    const state = getState();
    const fromIndex = state.dashTasks.findIndex((t) => t.id === fromId);
    const toIndex = state.dashTasks.findIndex((t) => t.id === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    const [item] = state.dashTasks.splice(fromIndex, 1);
    state.dashTasks.splice(toIndex, 0, item);
    scheduleSave();
    renderDashTasks();
    renderComputed();
  }

  tbody.addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const item = findById(getState().dashTasks, rowIdOf(e.target));
    if (!item) return;
    item[field] = e.target.value;
    scheduleSave();

    if (field === 'start' || field === 'end') {
      const row = e.target.closest('tr');
      row.querySelector('[data-role="duration"]').textContent = durationLabel(item.start, item.end);
      renderDashGantt();
      renderComputed();
    }
  });

  tbody.addEventListener('change', (e) => {
    const field = e.target.dataset.field;
    if (field !== 'status' && field !== 'prio') return;
    const item = findById(getState().dashTasks, rowIdOf(e.target));
    if (!item) return;
    item[field] = e.target.value;
    scheduleSave();
    e.target.className = `${field}-select ${field}-${slug(e.target.value)}`;
    renderComputed();
  });

  tbody.addEventListener('dragstart', (e) => {
    if (getPlannerTaskFilters().sort !== 'manual') return;
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    dragId = row.dataset.id;
    row.classList.add('is-dragging');
  });

  tbody.addEventListener('dragover', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row || row.dataset.id === dragId) return;
    e.preventDefault();
  });

  tbody.addEventListener('drop', (e) => {
    if (getPlannerTaskFilters().sort !== 'manual') return;
    const row = e.target.closest('tr[data-id]');
    if (!row || !dragId) return;
    e.preventDefault();
    reorderDashTasks(dragId, row.dataset.id);
    dragId = null;
  });

  tbody.addEventListener('dragend', () => {
    dragId = null;
    tbody.querySelectorAll('tr').forEach((row) => row.classList.remove('is-dragging'));
  });

  tbody.addEventListener('click', (e) => {
    if (!e.target.closest('[data-action="delete-dash-task"]')) return;
    const id = rowIdOf(e.target);
    const state = getState();
    state.dashTasks = state.dashTasks.filter((t) => t.id !== id);
    scheduleSave();
    renderDashTasks();
    renderComputed();
  });

  const addBtn = document.querySelector('#page-planner [data-action="add-dash-task"]');
  addBtn?.addEventListener('click', () => {
    getState().dashTasks.push({ id: uid(), name: '', assigned: '', start: '', end: '', status: 'Not Started', prio: 'Medium', comments: '' });
    scheduleSave();
    renderDashTasks();
    renderDashboardReadonlyTasks();
    renderComputed();
  });

  ['planner-task-filter-status', 'planner-task-filter-prio', 'planner-task-sort'].forEach((id) => {
    const control = document.getElementById(id);
    control?.addEventListener('change', renderDashTasks);
  });
  document.getElementById('planner-task-search')?.addEventListener('input', renderDashTasks);
}

function renderDashboardReadonlyTaskRow(t) {
  const status = effectiveStatus(t);
  return el('tr', {}, [
    el('td', { class: 'col-num', text: String(getState().dashTasks.findIndex((task) => task.id === t.id) + 1) }),
    el('td', { text: t.name || '' }),
    el('td', { text: t.assigned || '' }),
    el('td', { text: t.start || '' }),
    el('td', { text: t.end || '' }),
    el('td', { text: durationLabel(t.start, t.end) }),
    el('td', { text: status }),
    el('td', { text: t.prio || '' }),
    el('td', { text: t.comments || '' }),
  ]);
}

function renderDashboardReadonlyTasks() {
  const tbody = document.getElementById('dash-readonly-tasks-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  getState().dashTasks.forEach((task) => tbody.appendChild(renderDashboardReadonlyTaskRow(task)));
}

function bindBudgetAndPending() {
  ['budgetPlanned', 'budgetActual'].forEach((field) => {
    document.querySelector(`#page-dashboard [data-field="${field}"]`).addEventListener('input', renderBudgetChart);
  });
  ['pending.decisions', 'pending.actions', 'pending.changeRequests'].forEach((field) => {
    document.querySelector(`#page-dashboard [data-field="${field}"]`).addEventListener('input', renderPendingChart);
  });
}

export function renderDashboard() {
  renderDashTasks();
  renderDashboardReadonlyTasks();
  renderComputed();
  renderBudgetChart();
  renderPendingChart();
}

export function initDashboard() {
  renderDashboard();
  bindDashTasks();
  bindBudgetAndPending();
}

