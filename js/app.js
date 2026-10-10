import { getState, getPath, setPath, scheduleSave, onSaveStatusChange, resetToSampleData, replaceState } from './state.js?v=dashboard-simple-20261010g';
import { initPlanner, renderPlanner } from './planner.js?v=dashboard-simple-20261010g';
import { initDashboard, renderDashboard, renderDashHeader } from './dashboard.js?v=dashboard-simple-20261010g';
import { initGanttPage, renderGanttPage } from './gantt.js?v=dashboard-simple-20261010g';
import { exportAsPDF, exportAsPNG, buildMailtoUrl, exportAsCSV } from './export.js?v=dashboard-simple-20261010g';
import { createApiClient, ApiError } from './apiClient.js?v=dashboard-simple-20261010g';

const api = createApiClient();
const syncMeta = { version: 0, updatedAt: null };

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

function initTabs() {
  const tabs = [
    { btn: document.getElementById('tab-planner'), page: document.getElementById('page-planner'), onActivate: renderPlanner },
    { btn: document.getElementById('tab-dashboard'), page: document.getElementById('page-dashboard'), onActivate: renderDashboard },
    { btn: document.getElementById('tab-gantt'), page: document.getElementById('page-gantt'), onActivate: renderGanttPage },
  ];

  const activateTab = (nextTab) => {
    tabs.forEach(({ btn: b, page: p }, index) => {
      const active = index === nextTab;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
      p.classList.toggle('is-active', active);
    });
    tabs[nextTab].onActivate?.();
  };

  tabs.forEach(({ btn }, index) => {
    btn.addEventListener('click', () => activateTab(index));
    btn.addEventListener('keydown', (event) => {
      const key = event.key;
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(key)) return;
      event.preventDefault();

      let nextIndex = index;
      if (key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (key === 'Home') nextIndex = 0;
      if (key === 'End') nextIndex = tabs.length - 1;

      tabs[nextIndex].btn.focus();
      activateTab(nextIndex);
    });
  });
}

function topLevelFieldEls() {
  return Array.from(document.querySelectorAll('[data-field]')).filter((el) => !el.closest('table'));
}

function readFieldValue(el) {
  if (el.isContentEditable) return el.textContent;
  if (el.type === 'number') return el.value === '' ? 0 : Number(el.value);
  return el.value;
}

function writeFieldValue(el, value) {
  if (el.isContentEditable) {
    if (el.textContent !== (value ?? '')) el.textContent = value ?? '';
  } else if (document.activeElement !== el) {
    el.value = value ?? '';
  }
}

function hydrateTopLevelFields() {
  const state = getState();
  topLevelFieldEls().forEach((el) => {
    writeFieldValue(el, getPath(state, el.dataset.field));
  });
}

function bindTopLevelFields() {
  topLevelFieldEls().forEach((el) => {
    el.addEventListener('input', () => {
      const field = el.dataset.field;
      const value = readFieldValue(el);
      setPath(getState(), field, value);
      scheduleSave();

      topLevelFieldEls().forEach((other) => {
        if (other !== el && other.dataset.field === field) writeFieldValue(other, value);
      });

      if (field === 'dashStatus') renderDashHeader();
    });
  });
}

function hydrateAndRenderAll() {
  hydrateTopLevelFields();
  renderPlanner();
  renderDashboard();
  renderGanttPage();
}

function activeTabId() {
  return document.querySelector('.tab-btn[aria-selected="true"]')?.id || 'tab-planner';
}

function renderNonActiveTaskSurfaces() {
  const active = activeTabId();
  if (active !== 'tab-planner') renderPlanner();
  if (active !== 'tab-dashboard') renderDashboard();
  if (active !== 'tab-gantt') renderGanttPage();
}

function initRealtimeCrossTabSync() {
  let rafId = null;
  onSaveStatusChange((status) => {
    if (status !== 'saving') return;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      renderNonActiveTaskSurfaces();
    });
  });
}

function initSaveIndicator() {
  const indicator = document.getElementById('save-indicator');
  onSaveStatusChange((status) => {
    indicator.textContent = status === 'saving' ? 'Saving...' : 'Saved';
    indicator.classList.toggle('is-saving', status === 'saving');
    indicator.classList.toggle('is-saved', status === 'saved');
  });
}

function initResetButton() {
  const handleReset = () => {
    const confirmed = window.confirm('Reset to the sample dataset? This discards all of your local edits and cannot be undone.');
    if (!confirmed) return;
    resetToSampleData();
    hydrateAndRenderAll();
  };
  document.getElementById('btn-reset')?.addEventListener('click', handleReset);
  document.getElementById('btn-reset-panel')?.addEventListener('click', handleReset);
}

function initInstallPrompt() {
  const installBtn = document.getElementById('btn-install');
  if (!installBtn) return;
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    installBtn.hidden = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });

  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
    deferredPrompt = null;
  });
}

function updateBackendStatus(message) {
  const node = document.getElementById('api-auth-status');
  if (node) node.textContent = message;
}

function applyRemotePayload(payload) {
  const remoteState = payload && typeof payload === 'object' && payload.state ? payload.state : payload;
  replaceState(remoteState || {});
  syncMeta.version = Number(payload?.version ?? 0);
  syncMeta.updatedAt = payload?.updatedAt ?? null;
  hydrateAndRenderAll();
}

async function withApiErrorHandling(action) {
  try {
    return await action();
  } catch (error) {
    console.error(error);
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
      updateBackendStatus('Signed out (token missing or expired)');
      window.alert('You must sign in to the backend first.');
      return null;
    }
    throw error;
  }
}

async function saveWithConflictResolution(force = false) {
  return withApiErrorHandling(async () => api.savePlanner(getState(), syncMeta.version, force));
}

async function syncPlannerToBackend({ load = false } = {}) {
  try {
    if (load) {
      const payload = await withApiErrorHandling(() => api.getPlanner());
      if (!payload) return;
      applyRemotePayload(payload);
      updateBackendStatus(`Loaded version ${syncMeta.version}${payload?.source === 'mock' ? ' (mock)' : ''}`);
      window.alert('Planner loaded from backend.');
      return;
    }

    let saved = await saveWithConflictResolution(false);
    if (!saved) return;

    syncMeta.version = Number(saved.version ?? syncMeta.version);
    syncMeta.updatedAt = saved.updatedAt ?? syncMeta.updatedAt;
    updateBackendStatus(`Saved version ${syncMeta.version}${saved?.source === 'mock' ? ' (mock)' : ''}`);
    window.alert('Planner saved to backend.');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
      const overwrite = window.confirm(
        'Conflict detected: the server has a newer version. Press OK to overwrite the server with your local version, or Cancel to load the server copy.',
      );
      if (overwrite) {
        const forcedSave = await saveWithConflictResolution(true);
        if (forcedSave) {
          syncMeta.version = Number(forcedSave.version ?? syncMeta.version);
          syncMeta.updatedAt = forcedSave.updatedAt ?? syncMeta.updatedAt;
          updateBackendStatus(`Force-saved version ${syncMeta.version}`);
          window.alert('Conflict resolved by overwriting server data.');
        }
      } else if (error.data?.server) {
        applyRemotePayload(error.data.server);
        updateBackendStatus(`Loaded server version ${syncMeta.version} after conflict`);
        window.alert('Loaded newer server data.');
      }
      return;
    }

    window.alert(`Could not ${load ? 'load' : 'save'} planner data from backend: ${error.message}`);
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function exportExcelFromBackend() {
  try {
    const blob = await withApiErrorHandling(() => api.exportExcel());
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(getState().projectName || 'project-planner').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'project-planner'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    window.alert(`Could not export Excel: ${error.message}`);
  }
}

async function exportExcelTemplateFromBackend() {
  try {
    const blob = await withApiErrorHandling(() => api.exportExcelTemplate());
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project-planner-template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    window.alert(`Could not export Excel template: ${error.message}`);
  }
}

async function importExcelToBackend(file) {
  try {
    const buffer = await file.arrayBuffer();
    const payload = await withApiErrorHandling(() => api.importExcel(arrayBufferToBase64(buffer), syncMeta.version, false));
    if (!payload) return;
    applyRemotePayload(payload);
    updateBackendStatus(`Imported Excel into version ${syncMeta.version}`);
    window.alert('Excel imported successfully.');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
      const overwrite = window.confirm(
        'Conflict detected while importing Excel. Press OK to overwrite server data with the spreadsheet contents, or Cancel to keep server data.',
      );
      if (!overwrite) return;
      try {
        const buffer = await file.arrayBuffer();
        const forcedPayload = await withApiErrorHandling(() => api.importExcel(arrayBufferToBase64(buffer), syncMeta.version, true));
        if (!forcedPayload) return;
        applyRemotePayload(forcedPayload);
        updateBackendStatus(`Force-imported Excel into version ${syncMeta.version}`);
        window.alert('Excel imported by overwriting server data.');
      } catch (forcedError) {
        window.alert(`Could not force-import Excel: ${forcedError.message}`);
      }
      return;
    }

    if (error instanceof ApiError && error.code === 'EXCEL_VALIDATION_FAILED') {
      const issues = Array.isArray(error.data?.validationErrors) ? error.data.validationErrors : [];
      if (issues.length === 0) {
        window.alert('Excel validation failed. Please verify the workbook format and try again.');
        return;
      }

      const issueLines = issues.slice(0, 12).map((issue, index) => `${index + 1}. ${issue.field}: ${issue.message}`);
      const hiddenCount = issues.length - issueLines.length;
      const suffix = hiddenCount > 0 ? `\n...and ${hiddenCount} more issue(s).` : '';
      window.alert(`Excel validation failed:\n\n${issueLines.join('\n')}${suffix}`);
      return;
    }

    window.alert(`Could not import Excel: ${error.message}`);
  }
}

function initBackendControls() {
  const modeSelect = document.getElementById('api-mode-select');
  const signInBtn = document.getElementById('btn-api-signin');
  const signOutBtn = document.getElementById('btn-api-signout');
  const healthBtn = document.getElementById('btn-api-health');
  const baseUrlInput = document.getElementById('api-base-url');
  const userInput = document.getElementById('api-username');
  const passInput = document.getElementById('api-password');

  modeSelect.value = api.getMode();
  baseUrlInput.value = api.getBaseUrl();
  updateBackendStatus(`Mode: ${modeSelect.value} | URL: ${api.getBaseUrl() || 'same-origin'} | Auth: ${api.hasToken() ? 'signed in' : 'signed out'}`);

  modeSelect.addEventListener('change', () => {
    api.setMode(modeSelect.value);
    updateBackendStatus(`Mode: ${modeSelect.value} | URL: ${api.getBaseUrl() || 'same-origin'} | Auth: ${api.hasToken() ? 'signed in' : 'signed out'}`);
  });

  baseUrlInput.addEventListener('change', () => {
    api.setBaseUrl(baseUrlInput.value);
    baseUrlInput.value = api.getBaseUrl();
    updateBackendStatus(`Mode: ${api.getMode()} | URL: ${api.getBaseUrl() || 'same-origin'} | Auth: ${api.hasToken() ? 'signed in' : 'signed out'}`);
  });

  signInBtn.addEventListener('click', async () => {
    const username = userInput.value.trim();
    const password = passInput.value;
    if (!username || !password) {
      window.alert('Enter backend username and password first.');
      return;
    }

    try {
      const payload = await api.login(username, password);
      passInput.value = '';
      updateBackendStatus(`Signed in (${payload.mode || modeSelect.value} mode)`);
      window.alert('Backend sign-in successful.');
    } catch (error) {
      window.alert(`Sign-in failed: ${error.message}`);
    }
  });

  signOutBtn.addEventListener('click', () => {
    api.logout();
    updateBackendStatus(`Mode: ${api.getMode()} | URL: ${api.getBaseUrl() || 'same-origin'} | Auth: signed out`);
  });

  healthBtn.addEventListener('click', async () => {
    try {
      const payload = await api.health();
      updateBackendStatus(`Health: ${payload.service} (${payload.mode}) @ ${payload.timestamp}`);
      window.alert(`Backend health is OK (${payload.mode}).`);
    } catch (error) {
      window.alert(`Health check failed: ${error.message}`);
    }
  });
}

function initExportPanel() {
  const overlay = document.getElementById('export-overlay');
  const exportButtons = [
    ...overlay.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ];
  let lastFocusedElement = null;

  const focusFirst = () => {
    const first = exportButtons.find((el) => !el.disabled && el.offsetParent !== null);
    first?.focus();
  };

  const open = () => {
    lastFocusedElement = document.activeElement;
    overlay.hidden = false;
    const state = getState();
    document.getElementById('share-subject').value ||= `${state.projectName || 'Project'} update`;
    document.getElementById('share-body').value ||=
      `Hi,\n\nSharing the latest on ${state.projectName || 'the project'}.\n\n` +
      `I've downloaded a PDF/PNG of the plan - please see the attached file.\n\n` +
      'Thanks!';
    requestAnimationFrame(focusFirst);
  };

  const close = () => {
    overlay.hidden = true;
    lastFocusedElement?.focus?.();
  };

  document.getElementById('btn-export-panel')?.addEventListener('click', open);
  document.getElementById('btn-close-panel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = exportButtons.filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });

  document.getElementById('btn-export-pdf').addEventListener('click', exportAsPDF);
  document.getElementById('btn-export-csv').addEventListener('click', exportAsCSV);
  document.getElementById('btn-export-excel-template').addEventListener('click', exportExcelTemplateFromBackend);
  document.getElementById('btn-export-excel').addEventListener('click', exportExcelFromBackend);

  document.getElementById('btn-export-png').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.textContent = 'Generating...';
    btn.disabled = true;
    try {
      await exportAsPNG();
    } catch (err) {
      console.error(err);
      window.alert('Could not generate the PNG. Check your connection for the first-time library download and try again.');
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  });

  document.getElementById('btn-share-email').addEventListener('click', () => {
    const to = document.getElementById('share-to').value;
    const subject = document.getElementById('share-subject').value;
    const body = document.getElementById('share-body').value;
    window.location.href = buildMailtoUrl({ to, subject, body });
  });

  document.getElementById('btn-export-json').addEventListener('click', () => {
    const state = getState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.projectName || 'project-planner').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'project-planner'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-sync-save')?.addEventListener('click', () => syncPlannerToBackend({ load: false }));
  document.getElementById('btn-sync-save-panel').addEventListener('click', () => syncPlannerToBackend({ load: false }));
  document.getElementById('btn-sync-load')?.addEventListener('click', () => syncPlannerToBackend({ load: true }));
  document.getElementById('btn-sync-load-panel').addEventListener('click', () => syncPlannerToBackend({ load: true }));

  document.getElementById('file-import-json').addEventListener('change', (event) => {
    const [file] = event.target.files || [];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        replaceState(parsed);
        hydrateAndRenderAll();
        window.alert('Backup restored successfully.');
      } catch (err) {
        console.error(err);
        window.alert('Could not import that backup file. Please choose a valid project JSON export.');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('file-import-excel').addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    try {
      await importExcelToBackend(file);
    } finally {
      event.target.value = '';
    }
  });
}

function init() {
  hydrateTopLevelFields();
  bindTopLevelFields();
  initTabs();
  initSaveIndicator();
  initResetButton();
  initInstallPrompt();
  initBackendControls();
  initExportPanel();
  initPlanner();
  initDashboard();
  initGanttPage();
  initRealtimeCrossTabSync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

