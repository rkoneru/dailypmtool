import { sampleData } from './sampleData.js?v=dashboard-simple-20261010g';

const STORAGE_KEY = 'projectPlannerData_v1';
const SAVE_DEBOUNCE_MS = 400;

let state = null;
let saveTimer = null;
const saveStatusListeners = new Set();

function clone(obj) {
  return typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
}

function mergeState(base, incoming) {
  if (!incoming || typeof incoming !== 'object') return clone(base);

  const output = clone(base);

  Object.entries(incoming).forEach(([key, value]) => {
    const existing = output[key];

    if (Array.isArray(value)) {
      output[key] = value.map((item, index) => {
        if (existing && Array.isArray(existing) && typeof existing[index] === 'object' && existing[index] && !Array.isArray(existing[index])) {
          return mergeState(existing[index], item);
        }
        return clone(item);
      });
      return;
    }

    if (value && typeof value === 'object' && existing && typeof existing === 'object' && !Array.isArray(existing)) {
      output[key] = mergeState(existing, value);
      return;
    }

    output[key] = clone(value);
  });

  return output;
}

function normalizeState(value) {
  if (!value || typeof value !== 'object') return clone(sampleData);
  return mergeState(sampleData, value);
}

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (err) {
    console.warn('Failed to read saved data, falling back to sample data.', err);
    return null;
  }
}

function writeToStorage(data) {
  try {
    const payload = JSON.stringify(normalizeState(data));
    localStorage.setItem(STORAGE_KEY, payload);
    return true;
  } catch (err) {
    console.warn('Failed to save data locally (storage full or unavailable).', err);
    return false;
  }
}

export function getState() {
  if (!state) {
    state = readFromStorage() || clone(sampleData);
  }
  return state;
}

export function replaceState(nextState) {
  state = normalizeState(nextState);
  saveImmediately();
  return state;
}

export function onSaveStatusChange(listener) {
  saveStatusListeners.add(listener);
  return () => saveStatusListeners.delete(listener);
}

function emitSaveStatus(status) {
  saveStatusListeners.forEach((fn) => fn(status));
}

// Call after any mutation to the state object. Debounces the actual
// localStorage write so rapid edits (typing, dragging) don't thrash it.
export function scheduleSave() {
  syncLegacyPlannerTasksFromDash();
  emitSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeToStorage(getState());
    emitSaveStatus('saved');
  }, SAVE_DEBOUNCE_MS);
}

export function saveImmediately() {
  clearTimeout(saveTimer);
  syncLegacyPlannerTasksFromDash();
  writeToStorage(getState());
  emitSaveStatus('saved');
}

export function resetToSampleData() {
  clearTimeout(saveTimer);
  state = clone(sampleData);
  writeToStorage(state);
  emitSaveStatus('saved');
  return state;
}

// Dot-path helpers so a single input can bind to nested fields
// (e.g. "pending.decisions") without every caller writing its own walk.
export function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = obj;

  keys.forEach((key) => {
    if (target[key] == null || typeof target[key] !== 'object') {
      target[key] = {};
    }
    target = target[key];
  });

  target[last] = value;
}

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

function syncLegacyPlannerTasksFromDash() {
  const current = getState();
  const dashTasks = Array.isArray(current.dashTasks) ? current.dashTasks : [];
  current.tasks = dashTasks.map((task) => ({
    id: task.id,
    task: task.name || '',
    start: task.start || '',
    end: task.end || '',
    prio: task.prio || '',
    done: task.status === 'Complete',
  }));
}

// Flush any pending debounced save immediately if the page is about to be
// hidden or unloaded, so edits within the debounce window aren't lost.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveTimer) {
      saveImmediately();
    }
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (saveTimer) saveImmediately();
  });
}



