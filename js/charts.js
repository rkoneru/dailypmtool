// Small dependency-free SVG chart helpers shared by the dashboard.

export function parseDate(str) {
  if (!str) return null;
  const d = new Date(`${str}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysBetween(a, b) {
  const MS_PER_DAY = 86400000;
  return Math.round((b - a) / MS_PER_DAY);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Renders a pie chart into `container` from `slices`: [{ label, value, color }].
 * Pure SVG, no dependency. Slices with value 0 are skipped.
 */
export function renderPieChart(container, slices, size = 140) {
  container.innerHTML = '';
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = size / 2;
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img' });

  if (total <= 0) {
    svg.appendChild(svgEl('circle', { cx: radius, cy: radius, r: radius - 2, fill: 'none', stroke: '#cbd5e1', 'stroke-width': 2 }));
    const label = document.createElement('div');
    label.className = 'hint';
    label.style.margin = '8px 0 0';
    label.textContent = 'No data yet';
    container.appendChild(svg);
    container.appendChild(label);
    return;
  }

  let cumulative = 0;
  slices.filter((s) => s.value > 0).forEach((slice) => {
    const startAngle = (cumulative / total) * 2 * Math.PI;
    cumulative += slice.value;
    const endAngle = (cumulative / total) * 2 * Math.PI;
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    const x1 = radius + radius * Math.sin(startAngle);
    const y1 = radius - radius * Math.cos(startAngle);
    const x2 = radius + radius * Math.sin(endAngle);
    const y2 = radius - radius * Math.cos(endAngle);

    // Full circle (single-slice) case: two arcs, since one arc path can't close on itself.
    if (total === slice.value) {
      svg.appendChild(svgEl('circle', { cx: radius, cy: radius, r: radius, fill: slice.color }));
      return;
    }

    const d = `M ${radius} ${radius} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    svg.appendChild(svgEl('path', { d, fill: slice.color }));
  });

  container.appendChild(svg);
}

export function renderLegend(listEl, slices, total) {
  listEl.innerHTML = '';
  slices.forEach((slice) => {
    const li = document.createElement('li');
    const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0;
    li.innerHTML = `<span class="swatch" style="background:${slice.color}"></span>${slice.label}: ${slice.value} (${pct}%)`;
    listEl.appendChild(li);
  });
}

/**
 * Renders a simple date-proportional Gantt chart into `container`.
 * `items`: [{ label, start: Date, end: Date, color }]
 */
export function renderGanttChart(container, items) {
  container.innerHTML = '';
  const valid = items.filter((i) => i.start && i.end);
  if (valid.length === 0) {
    container.innerHTML = '<p class="hint">Add start/end dates to tasks to see the timeline.</p>';
    return;
  }

  const minStart = new Date(Math.min(...valid.map((i) => i.start.getTime())));
  const maxEnd = new Date(Math.max(...valid.map((i) => i.end.getTime())));
  const totalDays = Math.max(1, daysBetween(minStart, maxEnd));
  // Small padding so bars starting/ending at the edges aren't flush with the track.
  const padDays = Math.max(1, Math.round(totalDays * 0.03));
  const spanDays = totalDays + padDays * 2;

  const ruler = document.createElement('div');
  ruler.className = 'gantt-chart__ruler';
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  ruler.innerHTML = `<span>${fmt(minStart)}</span><span>${fmt(maxEnd)}</span>`;
  container.appendChild(ruler);

  valid.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'gantt-chart__row';

    const label = document.createElement('div');
    label.className = 'gantt-chart__label';
    label.textContent = item.label;
    label.title = item.label;

    const track = document.createElement('div');
    track.className = 'gantt-chart__track';

    const offsetDays = daysBetween(minStart, item.start) + padDays;
    const durationDays = Math.max(1, daysBetween(item.start, item.end) + 1);
    const leftPct = (offsetDays / spanDays) * 100;
    const widthPct = (durationDays / spanDays) * 100;

    const bar = document.createElement('div');
    bar.className = 'gantt-chart__bar';
    bar.style.left = `${leftPct}%`;
    bar.style.width = `${widthPct}%`;
    bar.style.background = item.color;
    bar.textContent = item.durationLabel || '';
    bar.title = `${item.label}: ${item.start.toLocaleDateString()} – ${item.end.toLocaleDateString()}`;

    track.appendChild(bar);
    row.appendChild(label);
    row.appendChild(track);
    container.appendChild(row);
  });
}
