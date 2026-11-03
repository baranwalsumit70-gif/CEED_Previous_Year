// Small SVG/HTML chart helpers for the result page (no external libraries).
// Colours: status palette for outcomes, categorical slots for sections (validated reference palette).
export const OUTCOME_COLORS = { correct: '#0ca30c', wrong: '#d03b3b', partial: '#fab219', unattempted: '#a3a29b', bonus: '#2a78d6' };
export const OUTCOME_LABEL = { correct: 'Correct', wrong: 'Wrong', partial: 'Partially correct', unattempted: 'Unattempted', bonus: 'Marks to all' };
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const GRID = '#e8e7e1';
const AXIS = '#c3c2b7';
const INK = '#1b2230';
const MUTED = '#6b7385';
const NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}

export function fmtSec(ms) {
  const sec = Math.round((Number(ms) || 0) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}
export function fmtClock(ms) {
  const sec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// ---------- tooltip (one per page) ----------
let tipEl = null;
export function showTip(evt, title, rows = []) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'viz-tip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.append(tipEl);
  }
  tipEl.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'viz-tip-title';
  h.textContent = title;
  tipEl.append(h);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'viz-tip-row';
    if (r.color) {
      const key = document.createElement('span');
      key.className = 'viz-tip-key';
      key.style.background = r.color;
      row.append(key);
    }
    const v = document.createElement('b');
    v.textContent = r.value;
    row.append(v);
    if (r.label) {
      const l = document.createElement('span');
      l.textContent = r.label;
      row.append(l);
    }
    tipEl.append(row);
  }
  tipEl.style.display = 'block';
  const pad = 14;
  const w = tipEl.offsetWidth;
  const hgt = tipEl.offsetHeight;
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
  if (y + hgt > window.innerHeight - 8) y = evt.clientY - hgt - pad;
  tipEl.style.left = `${Math.max(8, x)}px`;
  tipEl.style.top = `${Math.max(8, y)}px`;
}
export function hideTip() {
  if (tipEl) tipEl.style.display = 'none';
}

function niceStep(max, count) {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

// rounded data-end on top, square at the baseline
function colPath(x, y, w, h, r) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// ---------- 1. time spent per question (columns coloured by outcome) ----------
function innerWidth(box) {
  const cs = getComputedStyle(box);
  return box.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
}

export function timePerQuestion(box, questions, sections) {
  box.innerHTML = '';
  const W = Math.max(320, innerWidth(box));
  const H = 250;
  const m = { l: 46, r: 10, t: 14, b: 52 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = questions.length;
  const maxMs = Math.max(30000, ...questions.map((q) => q.time_ms), ...questions.map((q) => (q.others ? q.others.avg_time_ms : 0)));
  const useMin = maxMs >= 120000;
  const unit = useMin ? 60000 : 1000;
  const step = niceStep(maxMs / unit, 4) * unit;
  const top = Math.ceil(maxMs / step) * step;
  const y = (v) => m.t + ih - (v / top) * ih;
  const slot = iw / n;
  const bw = Math.max(3, Math.min(24, slot - 2));
  const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Time spent on each question, coloured by result' });
  // grid + y ticks
  for (let v = 0; v <= top + 1; v += step) {
    const yy = Math.round(y(v)) + 0.5;
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: v === 0 ? AXIS : GRID, 'stroke-width': 1 }));
    svg.append(s('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end', 'font-size': 11, fill: MUTED, class: 'tnum' }, useMin ? `${v / 60000}m` : `${v / 1000}s`));
  }
  // section dividers + labels
  let start = 0;
  sections.forEach((sec, si) => {
    const cnt = questions.filter((q) => q.section_id === sec.id).length;
    if (!cnt) return;
    const x0 = m.l + start * slot;
    const x1 = m.l + (start + cnt) * slot;
    if (si > 0) svg.append(s('line', { x1: Math.round(x0) + 0.5, x2: Math.round(x0) + 0.5, y1: m.t, y2: H - m.b + 30, stroke: AXIS, 'stroke-width': 1 }));
    const label = sec.short_name || sec.name;
    svg.append(s('text', { x: (x0 + x1) / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 600, fill: INK }, `${label} (Q${start + 1}–${start + cnt})`));
    start += cnt;
  });
  const showEvery = slot >= 16 ? 1 : slot >= 9 ? 5 : 10;
  questions.forEach((q, i) => {
    const cx = m.l + i * slot + slot / 2;
    const h = Math.max(q.time_ms > 0 ? 2 : 0, ih - (y(q.time_ms) - m.t));
    const p = colPath(cx - bw / 2, m.t + ih - h, bw, h, 4);
    if (p) svg.append(s('path', { d: p, fill: OUTCOME_COLORS[q.outcome] || OUTCOME_COLORS.unattempted, class: 'viz-mark' }));
    if (q.others && q.others.n > 0) {
      const ay = Math.round(y(q.others.avg_time_ms)) + 0.5;
      svg.append(s('line', { x1: cx - bw / 2 - 2, x2: cx + bw / 2 + 2, y1: ay, y2: ay, stroke: INK, 'stroke-width': 2, 'stroke-linecap': 'round' }));
    }
    if ((i + 1) % showEvery === 0 || i === 0) {
      svg.append(s('text', { x: cx, y: m.t + ih + 15, 'text-anchor': 'middle', 'font-size': 10.5, fill: MUTED, class: 'tnum' }, String(q.number)));
    }
    const hit = s('rect', { x: m.l + i * slot, y: m.t, width: slot, height: ih + 20, fill: 'transparent', tabindex: 0, 'aria-label': `Question ${q.number}: ${fmtSec(q.time_ms)}, ${OUTCOME_LABEL[q.outcome]}` });
    const show = (e) => {
      const rows = [{ value: fmtSec(q.time_ms), label: 'your time', color: OUTCOME_COLORS[q.outcome] }];
      if (q.others && q.others.n) rows.push({ value: fmtSec(q.others.avg_time_ms), label: `others' average (${q.others.n})`, color: INK });
      rows.push({ value: OUTCOME_LABEL[q.outcome], label: q.visits ? `· opened ${q.visits}×` : '· not opened' });
      showTip(e, `Question ${q.number}`, rows);
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerleave', hideTip);
    hit.addEventListener('focus', (e) => {
      const r = hit.getBoundingClientRect();
      show({ clientX: r.left + r.width / 2, clientY: r.top + 40 });
    });
    hit.addEventListener('blur', hideTip);
    svg.append(hit);
  });
  box.append(svg);
}

// ---------- 2. exam journey: which question was on screen when ----------
export function buildSegments(events, durationMs) {
  const evs = [...(events || [])].map((e, i) => ({ ...e, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  const segs = [];
  const saves = [];
  const away = [];
  let cur = null;
  let start = 0;
  let lastVisit = null;
  let blurAt = null;
  const close = (t) => {
    if (cur && t > start) segs.push({ q: cur, start, end: t });
    cur = null;
  };
  for (const e of evs) {
    if (e.type === 'visit' && e.q) {
      if (lastVisit && lastVisit.q === e.q && Math.abs(lastVisit.t - e.t) < 400) continue; // duplicate
      close(e.t);
      cur = e.q;
      start = e.t;
      lastVisit = e;
    } else if (e.type === 'resume' || e.type === 'submit') {
      close(e.t);
      lastVisit = null;
    } else if ((e.type === 'save' || e.type === 'mark') && e.q && e.a !== null && e.a !== undefined) {
      saves.push({ q: e.q, t: e.t, a: e.a, type: e.type });
    } else if (e.type === 'blur') {
      blurAt = e.t;
    } else if (e.type === 'focus' && blurAt !== null) {
      away.push({ start: blurAt, end: e.t });
      blurAt = null;
    }
  }
  if (cur) close(Math.min(durationMs, evs.length ? evs[evs.length - 1].t : 0));
  if (blurAt !== null) away.push({ start: blurAt, end: blurAt });
  return { segs, saves, away };
}

export function journey(box, questions, sections, events, durationMs, usedMs) {
  box.innerHTML = '';
  const { segs, saves, away } = buildSegments(events, durationMs);
  const W = Math.max(360, innerWidth(box));
  const rowH = 12;
  const gapH = 22;
  const m = { l: 40, r: 18, t: 26, b: 34 };
  // row positions with a labelled gap before each section
  const rowY = new Map();
  let yy = m.t;
  const groups = [];
  for (const sec of sections) {
    const qs = questions.filter((q) => q.section_id === sec.id);
    if (!qs.length) continue;
    groups.push({ sec, y: yy, n: qs.length });
    yy += gapH;
    for (const q of qs) {
      rowY.set(q.id, yy);
      yy += rowH;
    }
  }
  const H = yy + m.b;
  const iw = W - m.l - m.r;
  const total = Math.max(durationMs, usedMs || 0, 1);
  const x = (t) => m.l + (Math.min(t, total) / total) * iw;
  const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Timeline of which question was on screen at what time' });
  const qById = new Map(questions.map((q) => [q.id, q]));
  // vertical grid every 5 / 10 minutes
  const totalMin = total / 60000;
  const stepMin = totalMin > 90 ? 15 : totalMin > 40 ? 10 : totalMin > 15 ? 5 : 2;
  for (let mnt = 0; mnt <= totalMin + 0.001; mnt += stepMin) {
    const gx = Math.round(x(mnt * 60000)) + 0.5;
    svg.append(s('line', { x1: gx, x2: gx, y1: m.t - 6, y2: H - m.b, stroke: mnt === 0 ? AXIS : GRID, 'stroke-width': 1 }));
    svg.append(s('text', { x: gx, y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': 11, fill: MUTED, class: 'tnum' }, `${mnt}m`));
  }
  svg.append(s('text', { x: W - m.r, y: H - 2, 'text-anchor': 'end', 'font-size': 11, fill: MUTED }, 'minutes into the exam'));
  // section labels + row labels
  groups.forEach((g, gi) => {
    svg.append(s('text', { x: m.l, y: g.y + 15, 'font-size': 11.5, 'font-weight': 700, fill: INK }, g.sec.name));
  });
  for (const q of questions) {
    const ry = rowY.get(q.id);
    if (ry === undefined) continue;
    svg.append(s('text', { x: m.l - 8, y: ry + rowH / 2 + 3.5, 'text-anchor': 'end', 'font-size': 9.5, fill: MUTED, class: 'tnum' }, String(q.number)));
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: ry + rowH - 0.5, y2: ry + rowH - 0.5, stroke: '#f1f0ec', 'stroke-width': 1 }));
  }
  // time away (tab switches)
  for (const a of away) {
    const ax = x(a.start);
    const mk = s('path', { d: `M${ax - 5},${m.t - 14}L${ax + 5},${m.t - 14}L${ax},${m.t - 6}Z`, fill: '#8a6d00' });
    mk.addEventListener('pointermove', (e) => showTip(e, 'Left the test window', [{ value: fmtClock(a.start), label: a.end > a.start ? `→ back at ${fmtClock(a.end)}` : '' }]));
    mk.addEventListener('pointerleave', hideTip);
    svg.append(mk);
  }
  // segments
  for (const sg of segs) {
    const q = qById.get(sg.q);
    const ry = rowY.get(sg.q);
    if (!q || ry === undefined) continue;
    const x0 = x(sg.start);
    const w = Math.max(2, x(sg.end) - x0);
    const color = OUTCOME_COLORS[q.outcome] || OUTCOME_COLORS.unattempted;
    svg.append(s('rect', { x: x0, y: ry + 2, width: w, height: rowH - 4, rx: 2, fill: color, opacity: 0.85 }));
    const hit = s('rect', { x: x0 - 2, y: ry, width: w + 4, height: rowH, fill: 'transparent' });
    hit.addEventListener('pointermove', (e) => showTip(e, `Question ${q.number}`, [
      { value: `${fmtClock(sg.start)} – ${fmtClock(sg.end)}`, label: `(${fmtSec(sg.end - sg.start)})`, color },
      { value: OUTCOME_LABEL[q.outcome], label: q.answered_ms !== null && q.answered_ms !== undefined ? `· answered at ${fmtClock(q.answered_ms)}` : '' },
    ]));
    hit.addEventListener('pointerleave', hideTip);
    svg.append(hit);
  }
  // answer saves: final save = filled dot, earlier ones = hollow
  const lastSave = new Map();
  for (const sv of saves) lastSave.set(sv.q, sv);
  for (const sv of saves) {
    const q = qById.get(sv.q);
    const ry = rowY.get(sv.q);
    if (!q || ry === undefined) continue;
    const final = lastSave.get(sv.q) === sv;
    const color = OUTCOME_COLORS[q.outcome] || OUTCOME_COLORS.unattempted;
    const dot = s('circle', { cx: x(sv.t), cy: ry + rowH / 2, r: 4.5, fill: final ? color : '#fff', stroke: final ? '#fff' : color, 'stroke-width': 2 });
    dot.addEventListener('pointermove', (e) => showTip(e, `Question ${q.number}`, [
      { value: `Answer ${Array.isArray(sv.a) ? sv.a.join(', ') : sv.a}`, label: `${final ? 'final answer' : 'changed later'} · saved at ${fmtClock(sv.t)}`, color },
    ]));
    dot.addEventListener('pointerleave', hideTip);
    svg.append(dot);
  }
  // end-of-exam line
  if (usedMs) {
    const ex = Math.round(x(usedMs)) + 0.5;
    svg.append(s('line', { x1: ex, x2: ex, y1: m.t - 6, y2: H - m.b, stroke: INK, 'stroke-width': 1.5 }));
    svg.append(s('text', { x: Math.min(ex + 4, W - m.r - 60), y: m.t - 10, 'font-size': 11, fill: INK, 'font-weight': 600 }, `Submitted ${fmtClock(usedMs)}`));
  }
  box.append(svg);
  return { segs, saves, away };
}

// ---------- 3. tall segmented bar (part-to-whole), HTML ----------
export function segmentedBar(box, parts, { unit = '' } = {}) {
  box.innerHTML = '';
  const total = parts.reduce((t, p) => t + p.value, 0) || 1;
  const bar = document.createElement('div');
  bar.className = 'segbar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', parts.map((p) => `${p.label}: ${p.display || p.value}`).join(', '));
  for (const p of parts) {
    if (!p.value) continue;
    const seg = document.createElement('div');
    seg.className = 'segbar-part';
    seg.style.flexGrow = String(p.value);
    seg.style.background = p.color;
    seg.style.color = p.dark ? '#0b0b0b' : '#fff';
    const share = p.value / total;
    if (share >= 0.07) seg.textContent = p.display || `${Math.round(share * 100)}%`;
    seg.tabIndex = 0;
    const show = (e) => showTip(e, p.label, [{ value: p.display || `${p.value}${unit}`, label: `${Math.round(share * 100)}% of total`, color: p.color }]);
    seg.addEventListener('pointermove', show);
    seg.addEventListener('pointerleave', hideTip);
    seg.addEventListener('focus', (e) => { const r = seg.getBoundingClientRect(); show({ clientX: r.left + 10, clientY: r.bottom }); });
    seg.addEventListener('blur', hideTip);
    bar.append(seg);
  }
  const legend = document.createElement('div');
  legend.className = 'legend';
  for (const p of parts) {
    const it = document.createElement('span');
    it.className = 'legend-item';
    const sw = document.createElement('i');
    sw.style.background = p.color;
    it.append(sw, document.createTextNode(`${p.label} `));
    const b = document.createElement('b');
    b.textContent = p.display || String(p.value);
    it.append(b);
    legend.append(it);
  }
  box.append(bar, legend);
}

// ---------- 4. horizontal bars (single series), HTML ----------
export function hBars(box, rows, { max = 100, color = SERIES[0], suffix = '%' } = {}) {
  box.innerHTML = '';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'hbar-row';
    const label = document.createElement('div');
    label.className = 'hbar-label';
    label.textContent = r.label;
    const track = document.createElement('div');
    track.className = 'hbar-track';
    const fill = document.createElement('div');
    fill.className = 'hbar-fill';
    fill.style.width = `${Math.max(0, Math.min(100, (r.value / max) * 100))}%`;
    fill.style.background = color;
    const val = document.createElement('div');
    val.className = 'hbar-val';
    val.textContent = `${Math.round(r.value)}${suffix}`;
    const sub = document.createElement('span');
    sub.textContent = r.sub ? ` · ${r.sub}` : '';
    val.append(sub);
    track.append(fill);
    row.append(label, track, val);
    row.addEventListener('pointermove', (e) => showTip(e, r.label, [{ value: `${Math.round(r.value)}${suffix}`, label: r.sub || '', color }]));
    row.addEventListener('pointerleave', hideTip);
    box.append(row);
  }
}
