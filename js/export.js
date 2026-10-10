import { getState } from './state.js?v=dashboard-simple-20261010g';

// PDF export uses the browser's native print-to-PDF (see @media print in
// styles.css) — zero dependencies, most robust option, no CDN to break offline.
export function exportAsPDF() {
  window.print();
}

// PNG export is the one feature that needs a canvas-based DOM screenshot
// library. It's vendored locally (vendor/html2canvas.min.js) so the service
// worker can cache it for offline use, and lazy-loaded here (a plain
// <script> tag, since it's a UMD build, not an ES module) so it never adds
// to the app's initial JS payload.
let loadPromise = null;
function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/html2canvas.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load the PNG export library.'));
      document.head.appendChild(script);
    });
  }
  return loadPromise;
}

export async function exportAsPNG() {
  await loadHtml2Canvas();
  const activePage = document.querySelector('.page.is-active');
  const target = activePage.querySelector('.print-page');
  const canvas = await window.html2canvas(target, {
    backgroundColor: '#ffffff',
    scale: window.devicePixelRatio > 1 ? 2 : 1,
  });

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activePage.id}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      resolve();
    });
  });
}

// Browsers can't attach a file to a mailto: link, so the flow is explicit:
// the caller downloads a PDF/PNG first, then this just opens the email
// client with the message pre-filled and a reminder to attach it.
export function buildMailtoUrl({ to, subject, body }) {
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  const query = params.length ? `?${params.join('&')}` : '';
  return `mailto:${(to || '').trim()}${query}`;
}

function escapeCsvValue(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function exportAsCSV() {
  const state = getState();
  const projectName = state.projectName || 'project-planner';
  const rows = [];

  rows.push(['Section', 'Field', 'Value']);
  rows.push(['Project', 'Name', projectName]);
  rows.push(['Project', 'Objective', state.objective || '']);
  rows.push(['Project', 'Due Date', state.dueDate || '']);
  rows.push(['Project', 'Reward', state.reward || '']);
  rows.push(['Project', 'Status', state.dashStatus || '']);
  rows.push(['Project', 'Date', state.dashDate || '']);
  rows.push([]);
  rows.push(['Task', 'Start', 'End', 'Priority', 'Done']);
  (state.tasks || []).forEach((task) => {
    rows.push(['Planner Task', task.task || '', task.start || '', task.end || '', task.prio || '', task.done ? 'Yes' : 'No']);
  });
  rows.push([]);
  rows.push(['Task', 'Assignee', 'Start', 'End', 'Status', 'Priority', 'Comments']);
  (state.dashTasks || []).forEach((task) => {
    rows.push(['Dashboard Task', task.name || '', task.assigned || '', task.start || '', task.end || '', task.status || '', task.prio || '', task.comments || '']);
  });

  const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(projectName).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'project-planner'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
