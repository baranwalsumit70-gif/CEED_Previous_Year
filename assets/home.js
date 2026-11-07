// Home page: live list of papers (grouped by exam: CEED / UCEED) and the attempts taken on this device.
import { rpc, el, $, $$, savedAttempts, forgetAttempt, fmtDate, num, clock } from './common.js';

const dot = $('#dot');
const statusText = $('#status-text');
const setStatus = (state, msg) => { dot.className = `dot ${state}`; statusText.textContent = msg; };
$('#year').textContent = new Date().getFullYear();

const EXAM_FOR = { CEED: 'for M.Des', UCEED: 'for B.Des' };
const EXAM_NOTE = {
  CEED: 'CEED Part A: 60 minutes · Section I NAT, Section II MSQ, Section III MCQ.',
  UCEED: 'UCEED Part A: 2 hours (2 hours 30 minutes in 2020 to 2023). 2015 to 2019 papers are the full 3-hour computer-based exam. Every paper has NAT, MSQ and MCQ sections.',
};
const TAB_KEY = 'ceed_exam_tab';
let PAPERS = null;
let MINE = [];
let current = examFromHash() || readTab();

function readTab() { try { return localStorage.getItem(TAB_KEY) || null; } catch (_) { return null; } }
function saveTab(exam) { try { localStorage.setItem(TAB_KEY, exam); } catch (_) { /* storage unavailable */ } }
function examFromHash() {
  const h = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  return h === 'CEED' || h === 'UCEED' ? h : null;
}
const examOf = (p) => (p.exam || 'Other').trim() || 'Other';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function groups() {
  const by = new Map();
  for (const p of PAPERS) {
    const k = examOf(p);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(p);
  }
  const order = (k) => (k === 'CEED' ? 0 : k === 'UCEED' ? 1 : 2);
  return [...by.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([exam, papers]) => ({ exam, papers }));
}

function selectExam(exam, fromUser) {
  if (PAPERS) {
    const g = groups().find((x) => x.exam.toUpperCase() === String(exam).toUpperCase());
    if (g) exam = g.exam;
  }
  current = exam;
  saveTab(exam);
  if (fromUser) history.replaceState(null, '', `#${exam.toLowerCase()}`);
  if (PAPERS) renderPapers();
}

// "CEED mock" / "UCEED mock" buttons in the hero
$$('[data-exam-link]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  selectExam(a.dataset.examLink, true);
  $('#papers').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
window.addEventListener('hashchange', () => {
  const ex = examFromHash();
  if (ex) { selectExam(ex, false); $('#papers').scrollIntoView({ block: 'start' }); }
});

(async function init() {
  let papers;
  const slow = setTimeout(() => setStatus('wait', 'Connecting to the test server… please wait.'), 2500);
  try {
    papers = await rpc('ceed_papers');
  } catch (e) {
    clearTimeout(slow);
    setStatus('bad', `Couldn't reach the test server. ${e.status === 0 ? 'Check your internet and refresh the page.' : e.message}`);
    $('#paper-list').innerHTML = '';
    $('#paper-list').append(el('div', { class: 'card note-card' }, el('b', {}, 'The papers could not be loaded. '), e.message, ' ',
      el('a', { href: '', onclick: () => location.reload() }, 'Try again')));
    $('#my-list').innerHTML = '';
    return;
  }
  clearTimeout(slow);
  setStatus('ok', papers.length ? 'Test server is ready' : 'Test server is ready · no paper is published yet');
  if (papers.length) {
    $$('[data-stat="papers"]').forEach((b) => { b.textContent = papers.length; });
    $$('[data-stat="questions"]').forEach((b) => { b.textContent = papers.reduce((s, p) => s + (p.questions || 0), 0); });
  }

  // attempts saved on this device (each one is opened by its secret key)
  const saved = savedAttempts();
  if (saved.length) {
    try {
      MINE = await rpc('ceed_my_attempts', { p_tokens: saved.map((s) => s.token) });
      const alive = new Set(MINE.map((m) => m.token));
      saved.filter((s) => !alive.has(s.token)).forEach((s) => forgetAttempt(s.token)); // deleted by the admin
    } catch (_) {
      MINE = [];
    }
  }
  PAPERS = papers;
  renderPapers();
  renderMine(MINE, papers);
  // the lists above may have pushed a linked section (#uceed, #pattern, #faq, #my…) down: go back to it
  const id = decodeURIComponent(location.hash.slice(1));
  const target = examFromHash() ? $('#papers') : (id ? document.getElementById(id) : null);
  if (target) target.scrollIntoView({ block: 'start' });
})();

function renderPapers() {
  const box = $('#paper-list');
  const tabs = $('#exam-tabs');
  box.innerHTML = '';
  if (!PAPERS.length) {
    tabs.classList.add('hidden');
    box.append(el('div', { class: 'card note-card' }, 'No paper is published yet. Please check again soon.'));
    return;
  }
  const all = groups();
  let g = all.find((x) => current && x.exam.toUpperCase() === current.toUpperCase());
  if (!g) g = all[0];
  current = g.exam;

  tabs.innerHTML = '';
  tabs.classList.toggle('hidden', all.length < 2);
  for (const x of all) {
    const sel = x === g;
    tabs.append(el('button', {
      class: 'exam-tab', type: 'button', role: 'tab', id: `tab-${slug(x.exam)}`, 'aria-selected': String(sel), 'aria-controls': 'paper-list',
      tabindex: sel ? '0' : '-1',
      onclick: () => { selectExam(x.exam, true); const b = $(`#tab-${slug(x.exam)}`); if (b) b.focus(); },
    }, x.exam, EXAM_FOR[x.exam] ? el('small', {}, EXAM_FOR[x.exam]) : null,
    el('span', { class: 'count' }, `${x.papers.length} paper${x.papers.length === 1 ? '' : 's'}`)));
  }
  // arrow keys move between the exam tabs
  tabs.onkeydown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = all.indexOf(g) + (e.key === 'ArrowRight' ? 1 : -1);
    const next = all[(i + all.length) % all.length];
    selectExam(next.exam, true);
    const b = $(`#tab-${slug(next.exam)}`);
    if (b) b.focus();
  };

  box.setAttribute('aria-labelledby', `tab-${slug(g.exam)}`);
  box.classList.toggle('many', g.papers.length > 1);
  if (all.length > 1 && EXAM_NOTE[g.exam]) box.append(el('p', { class: 'exam-note' }, EXAM_NOTE[g.exam]));
  for (const p of g.papers) box.append(paperCard(p));
  if (PAPERS.length === 1) {
    box.append(el('aside', { class: 'card soon' }, el('h3', {}, 'More years coming'),
      el('p', {}, 'Further previous-year papers are being added. They will appear here as soon as they are ready.')));
  }
}

function paperCard(p) {
  const mineHere = MINE.filter((m) => m.paper_id === p.id);
  const open = mineHere.find((m) => m.status === 'in_progress');
  const done = mineHere.filter((m) => m.status === 'submitted').sort((a, b) => (b.submitted_at || 0) - (a.submitted_at || 0));
  const acts = el('div', { class: 'acts' });
  if (open) {
    acts.append(el('a', { class: 'btn btn-primary', href: `exam.html#t=${open.token}` }, `Resume test · ${clock(open.remaining_ms)} left`));
  } else if (done.length && !p.allow_reattempt) {
    acts.append(el('a', { class: 'btn btn-primary', 'aria-disabled': 'true', tabindex: '-1' }, 'Already attempted'));
  } else {
    acts.append(el('a', { class: 'btn btn-primary', href: `exam.html?paper=${encodeURIComponent(p.id)}` }, done.length ? 'Reattempt →' : `Attempt ${p.title.replace(/\s+—.*$/, '')} →`));
  }
  if (done.length) {
    acts.append(el('a', { class: 'btn btn-outline', href: `result.html#t=${done[0].token}` }, 'Last result'),
      el('span', { class: 'last' }, `${num(done[0].score)} / ${num(done[0].max_score)} · ${fmtDate(done[0].submitted_at, false)}`));
  }
  return el('article', { class: 'card paper' },
    el('div', { class: 'top' },
      el('div', {}, el('h3', {}, p.title), p.description ? el('p', { class: 'desc' }, p.description) : null),
      el('span', { class: `tag ${open ? 'amber' : ''}` }, open ? 'In progress' : 'Live')),
    el('div', { class: 'chips' },
      el('span', { class: 'chip' }, `${p.questions} questions`),
      el('span', { class: 'chip' }, `${p.sections} section${p.sections === 1 ? '' : 's'}`),
      el('span', { class: 'chip' }, `${p.duration_min} minutes`),
      el('span', { class: 'chip' }, `${num(p.max_marks)} marks`)),
    acts);
}

function renderMine(mine, papers) {
  const box = $('#my-list');
  box.innerHTML = '';
  if (!mine.length) {
    box.append(el('div', { class: 'card note-card' }, 'No attempts on this device yet. Your attempts and results will be listed here after you start a test.'));
    return;
  }
  const titles = new Map(papers.map((p) => [p.id, p.title]));
  const rows = mine.map((m) => {
    const running = m.status === 'in_progress';
    const href = running ? `exam.html#t=${m.token}` : `result.html#t=${m.token}`;
    return el('tr', {},
      el('td', {}, el('b', {}, m.title || titles.get(m.paper_id) || 'Paper'), el('span', { class: 'sub' }, `Attempt ${m.attempt_no}`)),
      el('td', {}, fmtDate(running ? m.started_at : m.submitted_at || m.started_at)),
      el('td', {}, running ? el('span', { class: 'pill run' }, `In progress · ${clock(m.remaining_ms)} left`) : el('span', { class: 'pill ok' }, 'Submitted')),
      el('td', { class: 'num' }, running ? '–' : el('b', {}, `${num(m.score)} / ${num(m.max_score)}`)),
      el('td', { class: 'num' }, running || m.correct === null || m.correct === undefined ? '–' : `${m.correct} / ${m.wrong} / ${m.unattempted}`),
      el('td', { class: 'num' }, el('a', { class: 'btn btn-sm btn-outline', href }, running ? 'Resume →' : 'Analysis →')));
  });
  box.append(el('div', { class: 'card table-card' },
    el('div', { class: 'table-scroll' }, el('table', { class: 'mine' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Paper'), el('th', {}, 'Date'), el('th', {}, 'Status'), el('th', { class: 'num' }, 'Score'),
        el('th', { class: 'num', title: 'Correct / Wrong / Unattempted' }, 'C / W / U'), el('th', {}))),
      el('tbody', {}, ...rows))),
    el('div', { class: 'mine-foot' }, 'Only attempts taken in this browser are listed here. To open a result on another device, use “Copy result link” on the result page.')));
}
