// Home page: live list of papers and the attempts taken on this device.
import { rpc, el, $, $$, savedAttempts, forgetAttempt, fmtDate, num, clock } from './common.js';

const dot = $('#dot');
const statusText = $('#status-text');
const setStatus = (state, msg) => { dot.className = `dot ${state}`; statusText.textContent = msg; };
$('#year').textContent = new Date().getFullYear();

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

  // attempts saved on this device (each one is opened by its secret key)
  const saved = savedAttempts();
  let mine = [];
  if (saved.length) {
    try {
      mine = await rpc('ceed_my_attempts', { p_tokens: saved.map((s) => s.token) });
      const alive = new Set(mine.map((m) => m.token));
      saved.filter((s) => !alive.has(s.token)).forEach((s) => forgetAttempt(s.token)); // deleted by the admin
    } catch (_) {
      mine = [];
    }
  }
  renderPapers(papers, mine);
  renderMine(mine, papers);
})();

function renderPapers(papers, mine) {
  const box = $('#paper-list');
  box.innerHTML = '';
  box.classList.toggle('many', papers.length > 1);
  if (!papers.length) {
    box.append(el('div', { class: 'card note-card' }, 'No paper is published yet. Please check again soon.'));
    return;
  }
  let firstHref = null;
  for (const p of papers) {
    const mineHere = mine.filter((m) => m.paper_id === p.id);
    const open = mineHere.find((m) => m.status === 'in_progress');
    const done = mineHere.filter((m) => m.status === 'submitted').sort((a, b) => (b.submitted_at || 0) - (a.submitted_at || 0));
    const acts = el('div', { class: 'acts' });
    let href;
    if (open) {
      href = `exam.html#t=${open.token}`;
      acts.append(el('a', { class: 'btn btn-primary', href }, `Resume test · ${clock(open.remaining_ms)} left`));
    } else if (done.length && !p.allow_reattempt) {
      acts.append(el('a', { class: 'btn btn-primary', 'aria-disabled': 'true', tabindex: '-1' }, 'Already attempted'));
    } else {
      href = `exam.html?paper=${encodeURIComponent(p.id)}`;
      acts.append(el('a', { class: 'btn btn-primary', href }, done.length ? 'Reattempt →' : `Attempt ${p.title.replace(/\s+—.*$/, '')} →`));
    }
    if (done.length) {
      acts.append(el('a', { class: 'btn btn-outline', href: `result.html#t=${done[0].token}` }, 'Last result'),
        el('span', { class: 'last' }, `${num(done[0].score)} / ${num(done[0].max_score)} · ${fmtDate(done[0].submitted_at, false)}`));
    }
    if (!firstHref && href) firstHref = href;
    box.append(el('article', { class: 'card paper' },
      el('div', { class: 'top' },
        el('div', {}, el('h3', {}, p.title), p.description ? el('p', { class: 'desc' }, p.description) : null),
        el('span', { class: `tag ${open ? 'amber' : ''}` }, open ? 'In progress' : 'Live')),
      el('div', { class: 'chips' },
        el('span', { class: 'chip' }, `${p.questions} questions`),
        el('span', { class: 'chip' }, `${p.sections} section${p.sections === 1 ? '' : 's'}`),
        el('span', { class: 'chip' }, `${p.duration_min} minutes`),
        el('span', { class: 'chip' }, `${num(p.max_marks)} marks`)),
      acts));
  }
  if (papers.length === 1) {
    box.append(el('aside', { class: 'card soon' }, el('h3', {}, 'More years coming'),
      el('p', {}, 'Further previous-year papers are being added. They will appear here as soon as they are ready.')));
  }
  if (firstHref) $$('[data-start]').forEach((a) => { a.href = firstHref; });
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
