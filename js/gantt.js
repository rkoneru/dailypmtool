import { getState, scheduleSave } from './state.js?v=dashboard-simple-20261010g';
import { parseDate, daysBetween } from './charts.js?v=dashboard-simple-20261010g';

const STATUS_ORDER = ['Not Started', 'In Progress', 'On Hold', 'Overdue', 'Complete'];
const LANE_DEFS = [
  { key: 'Not Started', title: 'Backlog' },
  { key: 'In Progress', title: 'In Progress' },
  { key: 'On Hold', title: 'Review' },
  { key: 'Overdue', title: 'At Risk' },
  { key: 'Complete', title: 'Done' },
];
const PRIO_ORDER = ['High', 'Medium', 'Low'];
const STATUS_COLORS = {
  'Not Started': '#bfdbfe',
  'In Progress': '#bbf7d0',
  Complete: '#16a34a',
  Overdue: '#f59e0b',
  'On Hold': '#cbd5e1',
};
const STATUS_GRADIENTS = {
  'Not Started': 'linear-gradient(90deg, #bfdbfe 0%, #60a5fa 100%)',
  'In Progress': 'linear-gradient(90deg, #86efac 0%, #22c55e 100%)',
  Complete: 'linear-gradient(90deg, #4ade80 0%, #16a34a 100%)',
  Overdue: 'linear-gradient(90deg, #fdba74 0%, #f97316 100%)',
  'On Hold': 'linear-gradient(90deg, #d4d4d8 0%, #a1a1aa 100%)',
};
const PRIO_ACCENTS = {
  High: '#ef4444',
  Medium: '#f59e0b',
  Low: '#22c55e',
};

function escapeHtmlAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function effectiveStatus(task) {
  const base = task.status || 'Not Started';
  return STATUS_ORDER.includes(base) ? base : 'Not Started';
}

function progressForStatus(status) {
  if (status === 'Complete') return 100;
  if (status === 'In Progress') return 65;
  if (status === 'On Hold') return 45;
  if (status === 'Overdue') return 80;
  return 20;
}

function toViewTask(task) {
  return {
    id: task.id,
    name: task.name || '(untitled task)',
    assigned: task.assigned || 'Unassigned',
    start: parseDate(task.start),
    end: parseDate(task.end),
    status: effectiveStatus(task),
    prio: task.prio || 'Medium',
    dependsOn: task.dependsOn || '',
    comments: task.comments || '',
  };
}

function statusWeight(status) {
  const index = STATUS_ORDER.indexOf(status);
  return index === -1 ? 999 : index;
}

function prioWeight(prio) {
  const index = PRIO_ORDER.indexOf(prio);
  return index === -1 ? 999 : index;
}

function sortTimelineTasks(tasks, mode) {
  const copy = [...tasks];
  if (mode === 'priority') {
    copy.sort((a, b) => prioWeight(a.prio) - prioWeight(b.prio) || (a.start?.getTime() || 0) - (b.start?.getTime() || 0));
    return copy;
  }
  if (mode === 'status') {
    copy.sort((a, b) => statusWeight(a.status) - statusWeight(b.status) || (a.start?.getTime() || 0) - (b.start?.getTime() || 0));
    return copy;
  }
  copy.sort((a, b) => (a.start?.getTime() || 0) - (b.start?.getTime() || 0));
  return copy;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function dateToISO(date) {
  return date.toISOString().slice(0, 10);
}

function renderBoard(tasks) {
  const board = document.getElementById('gantt-board-lanes');
  if (!board) return;
  board.innerHTML = '';

  LANE_DEFS.forEach((lane) => {
    const laneTasks = tasks.filter((task) => task.status === lane.key);
    const laneEl = document.createElement('section');
    laneEl.className = 'gantt-lane';
    laneEl.dataset.status = lane.key;
    laneEl.innerHTML = `<header class="gantt-lane__head"><h3>${lane.title}</h3><span>${laneTasks.length}</span></header>`;

    const list = document.createElement('div');
    list.className = 'gantt-lane__list';
    if (laneTasks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No tasks';
      list.appendChild(empty);
    } else {
      laneTasks.forEach((task) => {
        const card = document.createElement('article');
        card.className = 'gantt-card';
        card.draggable = true;
        card.dataset.taskId = task.id;
        card.dataset.taskStatus = task.status;

        const progress = progressForStatus(task.status);
        const dateLabel = task.start && task.end
          ? `${task.start.toLocaleDateString()} - ${task.end.toLocaleDateString()}`
          : 'Dates not set';
        const prioOptions = PRIO_ORDER
          .map((prio) => `<option value="${prio}"${prio === task.prio ? ' selected' : ''}>${prio}</option>`)
          .join('');

        card.innerHTML = `
          <h4>${escapeHtmlText(task.name)}</h4>
          <div class="gantt-card__controls">
            <label class="gantt-card__field">
              <span>Priority</span>
              <select class="gantt-card__prio" data-field="prio">
                ${prioOptions}
              </select>
            </label>
            <label class="gantt-card__field">
              <span>Assignee</span>
              <input type="text" class="gantt-card__assignee" data-field="assigned" value="${escapeHtmlAttr(task.assigned)}">
            </label>
          </div>
          <p class="gantt-card__dates">${dateLabel}</p>
          <div class="gantt-card__progress">
            <span style="width:${progress}%"></span>
          </div>
        `;
        list.appendChild(card);
      });
    }

    laneEl.appendChild(list);
    board.appendChild(laneEl);
  });
}

function updateTaskStatus(taskId, nextStatus) {
  const state = getState();
  const task = (state.dashTasks || []).find((item) => item.id === taskId);
  if (!task || task.status === nextStatus) return;
  task.status = nextStatus;
  scheduleSave();
  renderGanttPage();
}

function updateTaskField(taskId, field, value) {
  const state = getState();
  const task = (state.dashTasks || []).find((item) => item.id === taskId);
  if (!task) return;
  if (task[field] === value) return;
  task[field] = value;
  scheduleSave();
  renderGanttPage();
}

function bindEditableBoard() {
  const board = document.getElementById('gantt-board-lanes');
  if (!board) return;

  let dragTaskId = null;

  const clearDropTargets = () => {
    board.querySelectorAll('.gantt-lane.is-drop-target').forEach((lane) => lane.classList.remove('is-drop-target'));
    board.querySelectorAll('.gantt-card.is-dragging').forEach((card) => card.classList.remove('is-dragging'));
  };

  board.querySelectorAll('.gantt-card').forEach((card) => {
    card.querySelectorAll('input, select').forEach((control) => {
      control.addEventListener('pointerdown', (event) => event.stopPropagation());
      control.addEventListener('dragstart', (event) => event.preventDefault());
    });

    card.querySelector('.gantt-card__prio')?.addEventListener('change', (event) => {
      updateTaskField(card.dataset.taskId, 'prio', event.target.value);
    });

    card.querySelector('.gantt-card__assignee')?.addEventListener('input', (event) => {
      updateTaskField(card.dataset.taskId, 'assigned', event.target.value);
    });

    card.addEventListener('dragstart', (event) => {
      dragTaskId = card.dataset.taskId;
      card.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragTaskId || '');
    });

    card.addEventListener('dragend', () => {
      dragTaskId = null;
      clearDropTargets();
    });
  });

  board.querySelectorAll('.gantt-lane').forEach((lane) => {
    lane.addEventListener('dragover', (event) => {
      if (!dragTaskId) return;
      event.preventDefault();
      lane.classList.add('is-drop-target');
    });

    lane.addEventListener('dragleave', (event) => {
      if (!lane.contains(event.relatedTarget)) lane.classList.remove('is-drop-target');
    });

    lane.addEventListener('drop', (event) => {
      if (!dragTaskId) return;
      event.preventDefault();
      const nextStatus = lane.dataset.status;
      clearDropTargets();
      updateTaskStatus(dragTaskId, nextStatus);
      dragTaskId = null;
    });
  });
}

function updateBarVisual(rowEl, minDate, totalDays, startDate, endDate, taskName) {
  const bar = rowEl.querySelector('.gantt-page-row__bar');
  const dateLabel = rowEl.querySelector('.gantt-page-row__dates');
  const startOffset = daysBetween(minDate, startDate);
  const duration = Math.max(1, daysBetween(startDate, endDate) + 1);
  const leftPct = (startOffset / totalDays) * 100;
  const widthPct = (duration / totalDays) * 100;

  bar.style.left = `${leftPct}%`;
  bar.style.width = `${widthPct}%`;
  bar.title = `${taskName} (${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()})`;
  dateLabel.textContent = `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
}

function bindEditableTimeline(body, context) {
  const { minDate, totalDays } = context;
  let dragState = null;

  const onPointerMove = (event) => {
    if (!dragState) return;
    event.preventDefault();

    const pxPerDay = dragState.trackWidth / totalDays;
    if (!Number.isFinite(pxPerDay) || pxPerDay <= 0) return;
    const deltaDays = Math.round((event.clientX - dragState.startX) / pxPerDay);

    let nextStart = dragState.initialStart;
    let nextEnd = dragState.initialEnd;

    if (dragState.mode === 'move') {
      nextStart = addDays(dragState.initialStart, deltaDays);
      nextEnd = addDays(dragState.initialEnd, deltaDays);
    } else if (dragState.mode === 'resize-start') {
      nextStart = addDays(dragState.initialStart, deltaDays);
      if (nextStart > nextEnd) nextStart = nextEnd;
    } else {
      nextEnd = addDays(dragState.initialEnd, deltaDays);
      if (nextEnd < nextStart) nextEnd = nextStart;
    }

    dragState.previewStart = nextStart;
    dragState.previewEnd = nextEnd;
    updateBarVisual(dragState.rowEl, minDate, totalDays, nextStart, nextEnd, dragState.taskName);
  };

  const onPointerUp = () => {
    if (!dragState) return;
    const state = getState();
    const task = (state.dashTasks || []).find((item) => item.id === dragState.taskId);
    if (task && dragState.previewStart && dragState.previewEnd) {
      task.start = dateToISO(dragState.previewStart);
      task.end = dateToISO(dragState.previewEnd);
      scheduleSave();
    }

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    dragState = null;
    renderGanttPage();
  };

  body.addEventListener('pointerdown', (event) => {
    const row = event.target.closest('.gantt-page-row');
    if (!row) return;
    const bar = row.querySelector('.gantt-page-row__bar');
    const handle = event.target.closest('.gantt-bar-handle');
    if (!bar) return;

    const mode = handle
      ? (handle.dataset.edge === 'start' ? 'resize-start' : 'resize-end')
      : (event.target.closest('.gantt-page-row__bar') ? 'move' : null);
    if (!mode) return;

    const taskId = row.dataset.taskId;
    const stateTask = (getState().dashTasks || []).find((task) => task.id === taskId);
    const start = parseDate(stateTask?.start);
    const end = parseDate(stateTask?.end);
    if (!stateTask || !start || !end) return;

    event.preventDefault();
    dragState = {
      mode,
      taskId,
      taskName: stateTask.name || '(untitled task)',
      rowEl: row,
      trackWidth: row.querySelector('.gantt-page-row__track').clientWidth || 1,
      startX: event.clientX,
      initialStart: start,
      initialEnd: end,
      previewStart: start,
      previewEnd: end,
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  });
}

function renderTimeline(tasks) {
  const container = document.getElementById('gantt-page-timeline');
  if (!container) return;
  container.innerHTML = '';

  const valid = tasks.filter((task) => task.start && task.end);
  if (valid.length === 0) {
    container.innerHTML = '<p class="hint">Add start and end dates to dashboard tasks to populate this Gantt timeline.</p>';
    return;
  }

  const minDate = new Date(Math.min(...valid.map((task) => task.start.getTime())));
  const maxDate = new Date(Math.max(...valid.map((task) => task.end.getTime())));
  const totalDays = Math.max(1, daysBetween(minDate, maxDate) + 1);

  const ruler = document.createElement('div');
  ruler.className = 'gantt-page-timeline__ruler';
  const ticks = 6;
  for (let i = 0; i <= ticks; i += 1) {
    const pct = (i / ticks) * 100;
    const date = new Date(minDate.getTime());
    date.setDate(minDate.getDate() + Math.round((totalDays - 1) * (i / ticks)));
    const tick = document.createElement('span');
    tick.style.left = `${pct}%`;
    tick.textContent = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    ruler.appendChild(tick);
  }
  container.appendChild(ruler);

  const help = document.createElement('p');
  help.className = 'hint gantt-edit-hint';
  help.textContent = 'Editable Gantt: drag a bar to move task dates; drag left/right handles to adjust start or end.';
  container.appendChild(help);

  const body = document.createElement('div');
  body.className = 'gantt-page-timeline__body';
  valid.forEach((task) => {
    const row = document.createElement('div');
    row.className = 'gantt-page-row';
    row.dataset.taskId = task.id;

    const label = document.createElement('div');
    label.className = 'gantt-page-row__label';
    label.textContent = task.name;
    label.title = task.name;

    const track = document.createElement('div');
    track.className = 'gantt-page-row__track';

    const startOffset = daysBetween(minDate, task.start);
    const duration = Math.max(1, daysBetween(task.start, task.end) + 1);
    const leftPct = (startOffset / totalDays) * 100;
    const widthPct = (duration / totalDays) * 100;

    const bar = document.createElement('div');
    bar.className = `gantt-page-row__bar prio-${String(task.prio || '').toLowerCase()}`;
    bar.style.left = `${leftPct}%`;
    bar.style.width = `${widthPct}%`;
    bar.textContent = task.assigned;
    bar.title = `${task.name} (${task.start.toLocaleDateString()} - ${task.end.toLocaleDateString()})`;
    const startHandle = document.createElement('span');
    startHandle.className = 'gantt-bar-handle gantt-bar-handle--start';
    startHandle.dataset.edge = 'start';
    const endHandle = document.createElement('span');
    endHandle.className = 'gantt-bar-handle gantt-bar-handle--end';
    endHandle.dataset.edge = 'end';
    bar.appendChild(startHandle);
    bar.appendChild(endHandle);

    const dates = document.createElement('div');
    dates.className = 'gantt-page-row__dates';
    dates.textContent = `${task.start.toLocaleDateString()} - ${task.end.toLocaleDateString()}`;

    track.appendChild(bar);
    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(dates);
    body.appendChild(row);
  });

  container.appendChild(body);
  bindEditableTimeline(body, { minDate, totalDays });
}

function createsDependencyCycle(taskId, nextDependencyId, taskById) {
  if (!nextDependencyId) return false;
  let current = nextDependencyId;
  const seen = new Set();

  while (current) {
    if (current === taskId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = taskById.get(current)?.dependsOn || '';
  }
  return false;
}

function enforceDependencyWindow(task) {
  const state = getState();
  const taskById = new Map((state.dashTasks || []).map((item) => [item.id, item]));
  if (!task.dependsOn) return;
  const blocker = taskById.get(task.dependsOn);
  if (!blocker) return;

  const blockerEnd = parseDate(blocker.end);
  const taskStart = parseDate(task.start);
  const taskEnd = parseDate(task.end);
  if (!blockerEnd || !taskStart || !taskEnd) return;

  if (taskStart < blockerEnd) {
    task.start = dateToISO(blockerEnd);
    if (taskEnd < blockerEnd) task.end = dateToISO(blockerEnd);
  }
}

function bindGanttOverviewEditors(host) {
  host.querySelectorAll('.gantt-overview__field').forEach((control) => {
    control.addEventListener('change', (event) => {
      const taskId = event.target.dataset.taskId;
      const field = event.target.dataset.field;
      if (!taskId || !field) return;

      const state = getState();
      const task = (state.dashTasks || []).find((item) => item.id === taskId);
      if (!task) return;

      if (field === 'dependsOn') {
        const nextDependency = event.target.value || '';
        const taskById = new Map((state.dashTasks || []).map((item) => [item.id, item]));
        if (createsDependencyCycle(taskId, nextDependency, taskById)) {
          window.alert('Dependency not saved: that link creates a circular dependency.');
          event.target.value = task.dependsOn || '';
          return;
        }
        task.dependsOn = nextDependency;
        enforceDependencyWindow(task);
        scheduleSave();
        renderGanttPage();
        return;
      }

      if (field === 'start' || field === 'end') {
        task[field] = event.target.value || '';
        const start = parseDate(task.start);
        const end = parseDate(task.end);
        if (start && end && end < start) {
          if (field === 'start') task.end = task.start;
          else task.start = task.end;
        }
        enforceDependencyWindow(task);
        scheduleSave();
        renderGanttPage();
        return;
      }

      if (field === 'status' || field === 'prio') {
        task[field] = event.target.value;
        scheduleSave();
        renderGanttPage();
      }
    });
  });
}

function bindEditableGanttOverviewTimeline(host, context) {
  const { minDate, totalDays } = context;
  let dragState = null;

  const updatePreview = (stateRef, startDate, endDate) => {
    const bar = stateRef.rowEl.querySelector('.gantt-overview__bar');
    const dates = stateRef.rowEl.querySelector('.gantt-overview__dates');
    const startOffset = daysBetween(minDate, startDate);
    const duration = Math.max(1, daysBetween(startDate, endDate) + 1);
    bar.style.left = `${(startOffset / totalDays) * 100}%`;
    bar.style.width = `${Math.max((duration / totalDays) * 100, 1.8)}%`;
    dates.textContent = `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()} (${duration}d)`;
    const durationEl = bar.querySelector('.gantt-overview__bar-days');
    if (durationEl) durationEl.textContent = `${duration}d`;
  };

  const onPointerMove = (event) => {
    if (!dragState) return;
    event.preventDefault();
    const pxPerDay = dragState.trackWidth / totalDays;
    if (!Number.isFinite(pxPerDay) || pxPerDay <= 0) return;

    const deltaDays = Math.round((event.clientX - dragState.startX) / pxPerDay);
    let nextStart = dragState.initialStart;
    let nextEnd = dragState.initialEnd;

    if (dragState.mode === 'move') {
      nextStart = addDays(dragState.initialStart, deltaDays);
      nextEnd = addDays(dragState.initialEnd, deltaDays);
    } else if (dragState.mode === 'resize-start') {
      nextStart = addDays(dragState.initialStart, deltaDays);
      if (nextStart > nextEnd) nextStart = nextEnd;
    } else {
      nextEnd = addDays(dragState.initialEnd, deltaDays);
      if (nextEnd < nextStart) nextEnd = nextStart;
    }

    dragState.previewStart = nextStart;
    dragState.previewEnd = nextEnd;
    updatePreview(dragState, nextStart, nextEnd);
  };

  const onPointerUp = () => {
    if (!dragState) return;
    const state = getState();
    const task = (state.dashTasks || []).find((item) => item.id === dragState.taskId);
    if (task && dragState.previewStart && dragState.previewEnd) {
      task.start = dateToISO(dragState.previewStart);
      task.end = dateToISO(dragState.previewEnd);
      enforceDependencyWindow(task);
      scheduleSave();
    }

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    dragState = null;
    renderGanttPage();
  };

  host.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.gantt-overview__field, .gantt-overview__field-label')) return;
    const row = event.target.closest('.gantt-overview__row');
    if (!row) return;

    const bar = event.target.closest('.gantt-overview__bar');
    if (!bar) return;
    const handle = event.target.closest('.gantt-overview__handle');
    const mode = handle
      ? (handle.dataset.edge === 'start' ? 'resize-start' : 'resize-end')
      : 'move';

    const taskId = row.dataset.taskId;
    const stateTask = (getState().dashTasks || []).find((task) => task.id === taskId);
    const start = parseDate(stateTask?.start);
    const end = parseDate(stateTask?.end);
    if (!stateTask || !start || !end) return;

    event.preventDefault();
    dragState = {
      mode,
      taskId,
      rowEl: row,
      trackWidth: row.querySelector('.gantt-overview__track').clientWidth || 1,
      startX: event.clientX,
      initialStart: start,
      initialEnd: end,
      previewStart: start,
      previewEnd: end,
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  });
}

function renderDependencyConnectors(body) {
  body.querySelector('.gantt-overview__deps')?.remove();
  const rows = Array.from(body.querySelectorAll('.gantt-overview__row[data-task-id]'));
  if (rows.length === 0) return;

  const rowById = new Map(rows.map((row) => [row.dataset.taskId, row]));
  const bodyRect = body.getBoundingClientRect();
  const depsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  depsSvg.classList.add('gantt-overview__deps');
  depsSvg.setAttribute('viewBox', `0 0 ${Math.max(1, bodyRect.width)} ${Math.max(1, bodyRect.height)}`);
  depsSvg.setAttribute('preserveAspectRatio', 'none');

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'gantt-dep-arrow');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('refX', '6');
  marker.setAttribute('refY', '3.5');
  marker.setAttribute('orient', 'auto');
  const tip = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tip.setAttribute('d', 'M0,0 L7,3.5 L0,7 Z');
  tip.setAttribute('fill', '#334155');
  marker.appendChild(tip);
  defs.appendChild(marker);
  depsSvg.appendChild(defs);

  rows.forEach((row) => {
    const depSelect = row.querySelector('.gantt-overview__field[data-field="dependsOn"]');
    const dependsOn = depSelect?.value || '';
    if (!dependsOn) return;

    const sourceRow = rowById.get(dependsOn);
    if (!sourceRow) return;
    const sourceBar = sourceRow.querySelector('.gantt-overview__bar');
    const targetBar = row.querySelector('.gantt-overview__bar');
    if (!sourceBar || !targetBar) return;

    const sourceRect = sourceBar.getBoundingClientRect();
    const targetRect = targetBar.getBoundingClientRect();
    const x1 = sourceRect.right - bodyRect.left;
    const y1 = sourceRect.top + (sourceRect.height / 2) - bodyRect.top;
    const x4 = targetRect.left - bodyRect.left;
    const y4 = targetRect.top + (targetRect.height / 2) - bodyRect.top;
    const bend = Math.max(10, (x4 - x1) / 2);
    const x2 = x1 + bend;
    const x3 = x2;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'gantt-overview__dep-line');
    path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y1} L ${x3} ${y4} L ${x4 - 6} ${y4}`);
    path.setAttribute('marker-end', 'url(#gantt-dep-arrow)');
    depsSvg.appendChild(path);

    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'gantt-overview__dep-origin');
    dot.setAttribute('cx', String(x1));
    dot.setAttribute('cy', String(y1));
    dot.setAttribute('r', '2.2');
    depsSvg.appendChild(dot);
  });

  body.prepend(depsSvg);
}

function renderGanttOverview(tasks, allTasks) {
  const host = document.getElementById('gantt-page-gantt-chart');
  if (!host) return;
  host.innerHTML = '';

  const valid = tasks.filter((task) => task.start && task.end);
  if (valid.length === 0) {
    host.innerHTML = '<p class="hint">Add start/end dates to tasks to see the detailed Gantt chart.</p>';
    return;
  }

  const minDate = new Date(Math.min(...valid.map((task) => task.start.getTime())));
  const maxDate = new Date(Math.max(...valid.map((task) => task.end.getTime())));
  const totalDays = Math.max(1, daysBetween(minDate, maxDate) + 1);
  const complete = valid.filter((task) => task.status === 'Complete').length;
  const inProgress = valid.filter((task) => task.status === 'In Progress').length;
  const overdue = valid.filter((task) => task.status === 'Overdue').length;
  const progressPct = Math.round((complete / valid.length) * 100);

  const meta = document.createElement('div');
  meta.className = 'gantt-overview__meta';
  meta.innerHTML = `
    <div class="gantt-overview__summary">
      <span>Tasks: <strong>${valid.length}</strong></span>
      <span>Active: <strong>${inProgress}</strong></span>
      <span>Complete: <strong>${complete}</strong></span>
      <span>At Risk: <strong>${overdue}</strong></span>
      <span>Progress: <strong>${progressPct}%</strong></span>
    </div>
    <div class="gantt-overview__legend"></div>
  `;
  host.appendChild(meta);

  const legend = meta.querySelector('.gantt-overview__legend');
  STATUS_ORDER.forEach((status) => {
    if (!STATUS_COLORS[status]) return;
    const item = document.createElement('span');
    item.className = 'gantt-overview__legend-item';
    item.innerHTML = `<i style="background:${STATUS_COLORS[status]}"></i>${status}`;
    legend.appendChild(item);
  });

  const ruler = document.createElement('div');
  ruler.className = 'gantt-overview__ruler';
  ruler.style.setProperty('--gantt-days', String(totalDays));
  for (let dayOffset = 0; dayOffset < totalDays; dayOffset += 1) {
    const pct = (dayOffset / totalDays) * 100;
    const date = addDays(minDate, dayOffset);
    const showLabel = dayOffset === 0 || dayOffset === totalDays - 1 || date.getDay() === 1;
    const tick = document.createElement('span');
    tick.className = `gantt-overview__ruler-tick${showLabel ? ' is-labeled' : ''}`;
    tick.style.left = `${pct}%`;
    if (showLabel) {
      tick.textContent = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      tick.title = date.toLocaleDateString();
    }
    ruler.appendChild(tick);
  }
  host.appendChild(ruler);

  const body = document.createElement('div');
  body.className = 'gantt-overview__body';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const showToday = today >= minDate && today <= maxDate;
  const todayLeft = showToday ? `${(daysBetween(minDate, today) / totalDays) * 100}%` : null;

  valid.forEach((task) => {
    const durationDays = Math.max(1, daysBetween(task.start, task.end) + 1);
    const leftPct = (daysBetween(minDate, task.start) / totalDays) * 100;
    const widthPct = (durationDays / totalDays) * 100;

    const row = document.createElement('div');
    row.className = 'gantt-overview__row';
    row.dataset.taskId = task.id;

    const dependencyOptions = allTasks
      .filter((candidate) => candidate.id !== task.id)
      .map((candidate) => `<option value="${candidate.id}"${candidate.id === task.dependsOn ? ' selected' : ''}>${escapeHtmlAttr(candidate.name)}</option>`)
      .join('');

    const statusOptions = STATUS_ORDER
      .map((status) => `<option value="${status}"${status === task.status ? ' selected' : ''}>${status}</option>`)
      .join('');

    const prioOptions = PRIO_ORDER
      .map((prio) => `<option value="${prio}"${prio === task.prio ? ' selected' : ''}>${prio}</option>`)
      .join('');

    const details = document.createElement('div');
    details.className = 'gantt-overview__details';
    details.innerHTML = `
      <h4 title="${escapeHtmlAttr(task.name)}">${escapeHtmlText(task.name)}</h4>
      <div class="gantt-overview__chips">
        <span class="gantt-overview__chip status">${task.status}</span>
        <span class="gantt-overview__chip prio prio-${String(task.prio).toLowerCase()}">${task.prio}</span>
        <span class="gantt-overview__chip owner">${escapeHtmlText(task.assigned)}</span>
      </div>
      <p class="gantt-overview__dates">${task.start.toLocaleDateString()} - ${task.end.toLocaleDateString()} (${durationDays}d)</p>
      <details class="gantt-overview__editor">
        <summary>Edit task</summary>
        <div class="gantt-overview__edit">
          <label class="gantt-overview__field-label">Start
            <input type="date" class="gantt-overview__field" data-task-id="${task.id}" data-field="start" value="${dateToISO(task.start)}">
          </label>
          <label class="gantt-overview__field-label">End
            <input type="date" class="gantt-overview__field" data-task-id="${task.id}" data-field="end" value="${dateToISO(task.end)}">
          </label>
          <label class="gantt-overview__field-label">Status
            <select class="gantt-overview__field" data-task-id="${task.id}" data-field="status">${statusOptions}</select>
          </label>
          <label class="gantt-overview__field-label">Priority
            <select class="gantt-overview__field" data-task-id="${task.id}" data-field="prio">${prioOptions}</select>
          </label>
          <label class="gantt-overview__field-label gantt-overview__field-label--wide">Depends on
            <select class="gantt-overview__field gantt-overview__dependency" data-task-id="${task.id}" data-field="dependsOn">
              <option value="">No dependency</option>
              ${dependencyOptions}
            </select>
          </label>
        </div>
      </details>
    `;

    const track = document.createElement('div');
    track.className = 'gantt-overview__track';
    track.style.setProperty('--gantt-days', String(totalDays));

    if (showToday) {
      const todayLine = document.createElement('span');
      todayLine.className = 'gantt-overview__today-line';
      todayLine.style.left = todayLeft;
      track.appendChild(todayLine);
    }

    const bar = document.createElement('div');
    bar.className = `gantt-overview__bar status-${String(task.status).toLowerCase().replace(/\s+/g, '-')} prio-${String(task.prio).toLowerCase()}`;
    bar.style.left = `${leftPct}%`;
    bar.style.width = `${Math.max(widthPct, 1.8)}%`;
    bar.style.background = STATUS_GRADIENTS[task.status] || 'linear-gradient(90deg, #94a3b8 0%, #64748b 100%)';
    bar.style.borderColor = PRIO_ACCENTS[task.prio] || '#64748b';
    bar.title = `${task.name} - ${task.status} - ${task.assigned}`;
    bar.innerHTML = `
      <span class="gantt-overview__bar-days">${durationDays}d</span>
      <span class="gantt-overview__handle gantt-overview__handle--start" data-edge="start"></span>
      <span class="gantt-overview__handle gantt-overview__handle--end" data-edge="end"></span>
    `;

    track.appendChild(bar);
    row.appendChild(details);
    row.appendChild(track);
    body.appendChild(row);
  });

  host.appendChild(body);
  renderDependencyConnectors(body);
  bindGanttOverviewEditors(host);
  bindEditableGanttOverviewTimeline(host, { minDate, totalDays });
}

function renderKpis(tasks) {
  const host = document.getElementById('gantt-kpis');
  if (!host) return;
  const total = tasks.length;
  const complete = tasks.filter((task) => task.status === 'Complete').length;
  const inProgress = tasks.filter((task) => task.status === 'In Progress').length;
  const overdue = tasks.filter((task) => task.status === 'Overdue').length;
  const progress = total > 0 ? Math.round((complete / total) * 100) : 0;
  const stats = [
    { label: 'Total Tasks', value: total },
    { label: 'In Progress', value: inProgress },
    { label: 'Completed', value: complete },
    { label: 'Overdue', value: overdue },
    { label: 'Progress', value: `${progress}%` },
  ];

  host.innerHTML = '';
  stats.forEach((stat) => {
    const card = document.createElement('article');
    card.className = 'gantt-kpi';
    card.innerHTML = `<span>${stat.label}</span><strong>${stat.value}</strong>`;
    host.appendChild(card);
  });
}

export function renderGanttPage() {
  const state = getState();
  const statusFilter = document.getElementById('gantt-filter-status')?.value || 'all';
  const sortMode = document.getElementById('gantt-sort-mode')?.value || 'start';

  const allTasks = (Array.isArray(state.dashTasks) ? state.dashTasks : []).map(toViewTask);
  let tasks = [...allTasks];
  if (statusFilter !== 'all') tasks = tasks.filter((task) => task.status === statusFilter);
  tasks = sortTimelineTasks(tasks, sortMode);

  renderBoard(tasks);
  bindEditableBoard();
  renderTimeline(tasks);
  renderGanttOverview(tasks, allTasks);
  renderKpis(tasks);
}

export function initGanttPage() {
  const statusSelect = document.getElementById('gantt-filter-status');
  const sortSelect = document.getElementById('gantt-sort-mode');
  statusSelect?.addEventListener('change', renderGanttPage);
  sortSelect?.addEventListener('change', renderGanttPage);
  renderGanttPage();
}


