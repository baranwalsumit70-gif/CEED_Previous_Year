import {
  rpc, CFG, el, $, $$, renderHeader, fmtDate, num, mmss, modal, toast, confirmBox, copyText,
  getAdminPass, setAdminPass, clearAdminPass, imageSrc, imgEl, setImg,
} from './common.js';

let PASS = '';
const view = () => $('#view');
const LETTERS = 'ABCDEFGH';
const TYPE_INFO = { NAT: 'Numerical answer', MSQ: 'Multiple select', MCQ: 'Multiple choice' };
// Every admin function needs the passcode.
const A = (fn, args = {}) => rpc(fn, { p_pass: PASS, ...args });
const paperCache = new Map();

(async function init() {
  document.title = `Admin · ${CFG.SITE_NAME}`;
  PASS = getAdminPass();
  if (PASS) {
    try {
      await rpc('ceed_admin_check', { p_pass: PASS });
      return start();
    } catch (e) {
      if (!/passcode/i.test(e.message)) return showLock(e.message);
      clearAdminPass();
      PASS = '';
    }
  }
  showLock();
})();

function showLock(msg) {
  renderHeader({ active: 'admin' });
  $('.admin-tabs').classList.add('hidden');
  view().innerHTML = '';
  const input = el('input', { class: 'input', type: 'password', id: 'admin-pass', autocomplete: 'current-password', placeholder: 'Admin passcode' });
  const remember = el('input', { type: 'checkbox', id: 'admin-remember' });
  const err = el('div', { class: 'error-text', role: 'alert' }, msg || '');
  const btn = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Unlock');
  const form = el('form', { class: 'card card-pad lock-card' },
    el('div', { class: 'lock-ic', 'aria-hidden': 'true', html: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' }),
    el('h1', {}, 'Admin'),
    el('p', { class: 'muted' }, 'Enter the admin passcode to see every result and rank, and to manage papers and questions.'),
    el('div', { class: 'field' }, el('label', { for: 'admin-pass' }, 'Passcode'), input),
    el('label', { class: 'check', for: 'admin-remember' }, remember, el('span', {}, 'Remember on this device (only on your own computer)')),
    err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const v = input.value.trim();
    if (!v) return input.focus();
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      await rpc('ceed_admin_check', { p_pass: v });
      setAdminPass(v, remember.checked);
      PASS = v;
      start();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Unlock';
      input.select();
    }
  });
  view().append(form);
  input.focus();
}

let started = false;
function start() {
  renderHeader({ active: 'admin', admin: true });
  $('.admin-tabs').classList.remove('hidden');
  if (!started) window.addEventListener('hashchange', route);
  started = true;
  route();
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || 'overview';
  const [path, query] = raw.split('?');
  const [tab, id] = path.split('/');
  return { tab, id, params: new URLSearchParams(query || '') };
}

async function route() {
  const { tab, id, params } = parseHash();
  $$('.admin-tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (tab === 'paper' ? 'papers' : tab)));
  view().innerHTML = '';
  view().append(el('div', { class: 'loading' }, el('span', { class: 'spinner' })));
  try {
    if (tab === 'papers') await showPapers();
    else if (tab === 'paper' && id) await showPaper(id);
    else if (tab === 'students') await showStudents();
    else if (tab === 'attempts') await showAttempts(params);
    else await showOverview();
  } catch (e) {
    if (/passcode/i.test(e.message)) { clearAdminPass(); PASS = ''; return showLock('Your passcode was changed or is wrong. Please unlock again.'); }
    view().innerHTML = '';
    view().append(el('div', { class: 'card empty' }, e.message));
  }
}

// ---------------------------------------------------------------- CSV + paper helpers
async function paperDetail(id, fresh = false) {
  if (fresh || !paperCache.has(id)) paperCache.set(id, await A('ceed_admin_paper', { p_paper: id }));
  return paperCache.get(id);
}
const secKey = (s) => s.short_name || s.name;
function csvCell(v, text = false) {
  let s = v === null || v === undefined ? '' : String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(name, rows) {
  const blob = new Blob(['\ufeff' + rows.map((r) => r.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const isoTime = (t) => (t ? new Date(Number(t)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : '');

// Rank list: one row per student (first or best submitted attempt), equal scores share a rank.
function rankRows(attempts, mode = 'first') {
  const per = new Map();
  for (const a of attempts) {
    if (a.status !== 'submitted') continue;
    const cur = per.get(a.student_id);
    const better = !cur || (mode === 'best'
      ? (Number(a.score) > Number(cur.score) || (Number(a.score) === Number(cur.score) && a.time_used_ms < cur.time_used_ms))
      : a.attempt_no < cur.attempt_no);
    if (better) per.set(a.student_id, a);
  }
  const count = new Map();
  for (const a of attempts) if (a.status === 'submitted') count.set(a.student_id, (count.get(a.student_id) || 0) + 1);
  const list = [...per.values()].sort((x, y) => (Number(y.score) - Number(x.score)) || (x.time_used_ms - y.time_used_ms));
  let rank = 0;
  let prev = null;
  list.forEach((a, i) => {
    if (prev === null || Number(a.score) !== prev) rank = i + 1;
    prev = Number(a.score);
    a.rank = rank;
    a.tries = count.get(a.student_id) || 1;
  });
  return list;
}

async function exportResults(paperId, title, mode = 'first') {
  try {
    const [d, attempts] = await Promise.all([paperDetail(paperId), A('ceed_admin_attempts', { p_paper: paperId, p_status: 'submitted' })]);
    const secs = d.sections;
    const list = rankRows(attempts, mode);
    const head = ['Rank', 'Name', 'Email', 'Mobile', 'City', 'Attempt no', 'Attempts taken', 'Score', 'Max', 'Correct', 'Wrong', 'Partial', 'Unattempted', 'Negative marks',
      ...secs.map((s) => `${secKey(s)} score`), 'Time used', 'Started', 'Submitted', 'Submitted by', 'Tab switches'];
    const rows = [head.map((h) => csvCell(h, true))];
    for (const a of list) {
      rows.push([
        a.rank, csvCell(a.name, true), csvCell(a.email, true), csvCell(a.phone, true), csvCell(a.city, true), a.attempt_no, a.tries,
        num(a.score), num(a.max_score), a.correct, a.wrong, a.partial, a.unattempted, num(a.neg),
        ...secs.map((s) => (a.section_scores && a.section_scores[secKey(s)] !== undefined ? num(a.section_scores[secKey(s)]) : '')),
        mmss(Math.min(a.time_used_ms, a.duration_ms)), csvCell(isoTime(a.started_at)), csvCell(isoTime(a.submitted_at)),
        { timeout: 'Time up (auto)', admin: 'Admin', manual: 'Student' }[a.submit_reason] || a.submit_reason || '', a.tab_switches || 0,
      ].map((v) => (typeof v === 'string' && v.startsWith('"') ? v : csvCell(v))));
    }
    downloadCsv(`${String(title || 'results').replace(/[^\w\-]+/g, '_')}_${mode === 'best' ? 'best' : 'first'}_attempt_ranks.csv`, rows);
    toast(`Downloaded ${list.length} student${list.length === 1 ? '' : 's'}.`, 'ok');
  } catch (e) {
    toast(e.message, 'bad');
  }
}
const csvLink = (paperId, title, label = 'Download CSV') => el('a', { href: '#', onclick: (e) => { e.preventDefault(); exportResults(paperId, title); } }, label);

// ---------------------------------------------------------------- small UI helpers
const stat = (label, value) => el('div', { class: 'stat' }, el('div', { class: 'l' }, label), el('div', { class: 'v' }, String(value)));
function card(title, sub, body, headExtra) {
  return el('section', { class: 'card', style: { marginBottom: '20px' } },
    el('div', { class: 'card-head' }, el('div', {}, el('h2', { style: { fontSize: '17px' } }, title), sub ? el('p', { class: 'muted small', style: { margin: '2px 0 0' } }, sub) : null), headExtra || null),
    body);
}
function table(headers, rows, { empty = 'Nothing here yet.' } = {}) {
  const tb = el('tbody');
  if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: headers.length, class: 'empty' }, empty)));
  rows.forEach((r) => tb.append(r));
  return el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, ...headers.map((h) => (typeof h === 'string' ? el('th', {}, h) : el('th', { class: h.cls || '' }, h.label))))), tb));
}
function switchEl(label, checked, name) {
  const input = el('input', { type: 'checkbox', name });
  input.checked = Boolean(checked);
  return el('label', { class: 'switch' }, input, el('span', { class: 'track', 'aria-hidden': 'true' }), label);
}
function field(label, input, cls = '') {
  return el('div', { class: `field ${cls}` }, el('label', {}, label), input);
}
function contact(u) {
  return [u.email, u.phone ? `+91 ${u.phone}` : null].filter(Boolean).join(' · ');
}
function statusBadge(a) {
  if (a.status === 'submitted') return el('span', { class: 'badge badge-ok' }, a.submit_reason === 'timeout' ? 'Submitted (time up)' : 'Submitted');
  return el('span', { class: 'badge badge-blue' }, 'In progress');
}

// ---------------------------------------------------------------- overview
async function showOverview() {
  const d = await A('ceed_admin_overview');
  const c = d.counts;
  view().innerHTML = '';
  view().append(el('div', { class: 'stat-grid' },
    stat('Students', c.students), stat('New this week', c.new_students_7d), stat('Tests submitted', c.submitted),
    stat('In progress now', c.in_progress), stat('Started today', c.attempts_today), stat('Published papers', `${c.published} / ${c.papers}`)));
  view().append(card('Papers', 'Results are kept permanently on the server', table(
    ['Paper', { label: 'Students', cls: 'num' }, { label: 'Submitted', cls: 'num' }, { label: 'Average', cls: 'num' }, { label: 'Top score', cls: 'num' }, ''],
    d.perPaper.map((p) => el('tr', {},
      el('td', {}, el('a', { href: `#paper/${p.id}` }, el('b', {}, p.title))),
      el('td', { class: 'num' }, String(p.students)), el('td', { class: 'num' }, String(p.attempts)),
      el('td', { class: 'num' }, p.avg === null ? '–' : num(p.avg)), el('td', { class: 'num' }, p.top === null ? '–' : num(p.top)),
      el('td', { class: 'num nowrap' }, el('a', { href: `#attempts?paper=${p.id}` }, 'Rank list'), ' · ', csvLink(p.id, p.title)))),
    { empty: 'No papers yet.' })));
  view().append(card('Recent activity', null, table(
    ['Student', 'Paper', 'Status', { label: 'Score', cls: 'num' }, 'Started'],
    d.recent.map((a) => {
      const tr = el('tr', { class: a.status === 'submitted' ? 'clickable' : '' },
        el('td', {}, el('b', {}, a.name || '—'), el('div', { class: 'muted small' }, contact(a))),
        el('td', {}, a.title, el('span', { class: 'muted small' }, ` · attempt ${a.attempt_no}`)),
        el('td', {}, statusBadge(a)),
        el('td', { class: 'num' }, a.score === null ? '–' : `${num(a.score)} / ${num(a.max_score)}`),
        el('td', { class: 'nowrap' }, fmtDate(a.started_at)));
      if (a.status === 'submitted') tr.addEventListener('click', () => (location.href = `result.html?attempt=${a.id}`));
      return tr;
    }),
    { empty: 'No attempts yet. Share your site link with students.' })));

  // share link + passcode
  const home = new URL('index.html', location.href).href.replace(/index\.html$/, '');
  view().append(el('div', { class: 'grid grid-2', style: { gap: '20px' } },
    card('Link for students', 'Share this on WhatsApp, email or your class group', el('div', { class: 'card-pad' },
      el('div', { class: 'share-row' }, el('input', { class: 'input', readonly: true, value: home, 'aria-label': 'Website link', onclick: (e) => e.target.select() }),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => toast((await copyText(home)) ? 'Link copied.' : 'Copy failed.', 'ok') }, 'Copy')))),
    card('Admin passcode', 'Only people with this passcode can open this page', el('div', { class: 'card-pad' },
      el('p', { class: 'muted small', style: { marginBottom: '12px' } }, 'Change it if you shared it with someone by mistake.'),
      el('button', { class: 'btn', type: 'button', onclick: changePassModal }, 'Change passcode')))));
}

function changePassModal() {
  const cur = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const nw = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '10' });
  const again = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const err = el('div', { class: 'error-text' });
  modal({
    title: 'Change admin passcode',
    body: el('div', {}, field('Current passcode', cur), field('New passcode (at least 10 characters)', nw), field('New passcode again', again), err),
    actions: [{ label: 'Cancel' }, { label: 'Change passcode', kind: 'primary', onClick: async () => {
      err.textContent = '';
      if (cur.value !== PASS) { err.textContent = 'The current passcode is not correct.'; return false; }
      if (nw.value.length < 10) { err.textContent = 'Use at least 10 characters.'; return false; }
      if (nw.value !== again.value) { err.textContent = 'The two new passcodes are different.'; return false; }
      try {
        await A('ceed_admin_change_pass', { p_new: nw.value });
        let remembered = false;
        try { remembered = Boolean(localStorage.getItem('ceed_admin')); } catch (_) { /* ignore */ }
        setAdminPass(nw.value, remembered);
        PASS = nw.value;
        toast('Passcode changed. Use the new one next time.', 'ok', 5000);
      } catch (e) { err.textContent = e.message; return false; }
    } }],
  });
}

// ---------------------------------------------------------------- papers list
async function showPapers() {
  const papers = await A('ceed_admin_papers');
  view().innerHTML = '';
  view().append(el('div', { class: 'toolbar' },
    el('div', {}, el('h1', { style: { fontSize: '22px' } }, 'Papers & questions'), el('p', { class: 'muted', style: { margin: '4px 0 0' } }, 'Add previous-year papers and their questions one by one as screenshots.')),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: newPaperModal }, '+ New paper')));
  view().append(card('All papers', null, table(
    ['Paper', { label: 'Questions', cls: 'num' }, { label: 'Marks', cls: 'num' }, { label: 'Duration', cls: 'num' }, 'Status', { label: 'Attempts', cls: 'num' }, ''],
    papers.map((p) => {
      const tr = el('tr', { class: 'clickable' },
        el('td', {}, el('b', {}, p.title), p.year ? el('div', { class: 'muted small' }, `${p.exam || ''} ${p.year}`) : null),
        el('td', { class: 'num' }, String(p.question_count)),
        el('td', { class: 'num' }, num(p.max_marks)),
        el('td', { class: 'num' }, `${p.duration_min} min`),
        el('td', {}, p.published ? el('span', { class: 'badge badge-ok' }, 'Published') : el('span', { class: 'badge' }, 'Draft')),
        el('td', { class: 'num' }, String(p.attempt_count)),
        el('td', { class: 'num nowrap' }, el('a', { href: `#paper/${p.id}` }, 'Edit →')));
      tr.addEventListener('click', (e) => { if (e.target.tagName !== 'A') location.hash = `#paper/${p.id}`; });
      return tr;
    }),
    { empty: 'No papers yet. Click “New paper”.' })));
}

function newPaperModal() {
  const title = el('input', { class: 'input', placeholder: 'e.g. CEED 2018 — Part A' });
  const exam = el('input', { class: 'input', value: 'CEED' });
  const year = el('input', { class: 'input', type: 'number', min: '1990', max: '2100', placeholder: '2018' });
  const dur = el('input', { class: 'input', type: 'number', min: '1', max: '600', value: '60' });
  const tpl = el('select', { class: 'input' }, el('option', { value: 'ceed' }, 'CEED pattern — Section I NAT, II MSQ, III MCQ'), el('option', { value: '' }, 'Empty — I will add sections myself'));
  const err = el('div', { class: 'error-text' });
  const body = el('div', {}, field('Paper title', title), el('div', { class: 'row2' }, field('Exam', exam), field('Year', year)),
    field('Duration (minutes)', dur), field('Start with', tpl), err);
  modal({
    title: 'New paper',
    body,
    actions: [
      { label: 'Cancel' },
      { label: 'Create paper', kind: 'primary', onClick: async () => {
        try {
          const r = await A('ceed_admin_save_paper', { p_data: { title: title.value, exam: exam.value, year: year.value, duration_min: dur.value, template: tpl.value, published: false } });
          toast('Paper created. Now add the questions.', 'ok');
          location.hash = `#paper/${r.id}`;
        } catch (e) {
          err.textContent = e.message;
          return false;
        }
      } },
    ],
  });
}

// ---------------------------------------------------------------- paper editor
async function showPaper(id) {
  const d = await paperDetail(id, true);
  const p = d.paper;
  const statMap = new Map(d.questions.map((q) => [q.id, q.stats]));
  const topics = [...new Set(d.questions.map((q) => q.topic).filter(Boolean))];
  const reload = () => showPaper(id);
  view().innerHTML = '';

  // header
  view().append(el('div', { class: 'toolbar' },
    el('div', {}, el('a', { href: '#papers', class: 'small' }, '← All papers'),
      el('h1', { style: { fontSize: '22px', marginTop: '4px' } }, p.title),
      el('div', { class: 'row', style: { marginTop: '6px' } },
        p.published ? el('span', { class: 'badge badge-ok' }, 'Published') : el('span', { class: 'badge' }, 'Draft — students cannot see it'),
        el('span', { class: 'badge' }, `${d.questions.length} questions`),
        el('span', { class: 'badge' }, `${num(d.questions.reduce((t, q) => t + Number(q.marks), 0))} marks`),
        el('span', { class: 'badge' }, `${d.attempt_count} attempts`))),
    el('span', { class: 'spacer' }),
    el('a', { class: 'btn', href: `exam.html?paper=${p.id}&preview=1`, target: '_blank', rel: 'noopener' }, 'Preview as student'),
    el('button', { class: 'btn', type: 'button', onclick: () => exportResults(p.id, p.title) }, 'Results CSV'),
    el('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!(await confirmBox('Re-evaluate all attempts?', 'Use this after correcting an answer key. Every submitted attempt of this paper is re-marked with the current key.', { ok: 'Re-evaluate' }))) return;
      try {
        const r = await A('ceed_admin_reevaluate', { p_paper: p.id });
        toast(`Re-evaluated ${r.attempts} attempt${r.attempts === 1 ? '' : 's'}.`, 'ok');
      } catch (e) { toast(e.message, 'bad'); }
    } }, 'Re-evaluate')));

  // settings
  const f = {
    title: el('input', { class: 'input', value: p.title }),
    exam: el('input', { class: 'input', value: p.exam || '' }),
    year: el('input', { class: 'input', type: 'number', value: p.year ?? '' }),
    duration_min: el('input', { class: 'input', type: 'number', min: 1, max: 600, value: p.duration_min }),
    description: el('textarea', { class: 'input', rows: 2 }),
    instructions: el('textarea', { class: 'input', rows: 6 }),
    answer_key_note: el('textarea', { class: 'input', rows: 2 }),
    timer_mode: el('select', { class: 'input' }, el('option', { value: 'pause' }, 'Pause when the student leaves (resume later)'), el('option', { value: 'strict' }, 'Keep running even if the student leaves')),
  };
  f.description.value = p.description || '';
  f.instructions.value = p.instructions || '';
  f.answer_key_note.value = p.answer_key_note || '';
  f.timer_mode.value = p.timer_mode || 'pause';
  const swPub = switchEl('Published (visible to students)', p.published);
  const swRe = switchEl('Allow reattempts', p.allow_reattempt);
  const swAns = switchEl('Show correct answers after submit', p.show_answers);
  const settingsErr = el('div', { class: 'error-text' });
  const settings = el('div', { class: 'card-pad' },
    el('div', { class: 'form-grid' },
      field('Title', f.title, 'span-2'), field('Exam', f.exam), field('Year', f.year),
      field('Duration (minutes)', f.duration_min), field('Timer', f.timer_mode, 'span-2'), el('div'),
      field('Short description (shown on the home page)', f.description, 'span-4'),
      field('Instructions for this paper (shown before the test starts)', f.instructions, 'span-4'),
      field('Answer key note (shown at the bottom of results)', f.answer_key_note, 'span-4')),
    el('div', { class: 'toggles' }, swPub, swRe, swAns),
    settingsErr,
    el('div', { class: 'row', style: { marginTop: '10px' } },
      el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        settingsErr.textContent = '';
        try {
          await A('ceed_admin_save_paper', { p_data: {
            id: p.id, title: f.title.value, exam: f.exam.value, year: f.year.value, duration_min: f.duration_min.value, description: f.description.value,
            instructions: f.instructions.value, answer_key_note: f.answer_key_note.value, timer_mode: f.timer_mode.value,
            published: swPub.querySelector('input').checked, allow_reattempt: swRe.querySelector('input').checked, show_answers: swAns.querySelector('input').checked,
          } });
          toast('Paper settings saved.', 'ok');
          reload();
        } catch (e) { settingsErr.textContent = e.message; }
      } }, 'Save settings'),
      el('span', { class: 'spacer' }),
      d.attempt_count === 0 ? el('button', { class: 'btn btn-ghost', type: 'button', style: { color: 'var(--bad)' }, onclick: async () => {
        if (!(await confirmBox('Delete this paper?', 'The paper and all its questions will be deleted. This cannot be undone.', { ok: 'Delete', danger: true }))) return;
        try { await A('ceed_admin_delete_paper', { p_paper: p.id }); } catch (e) { return toast(e.message, 'bad'); }
        toast('Paper deleted.', 'ok');
        location.hash = '#papers';
      } }, 'Delete paper') : el('span', { class: 'muted small' }, 'Papers with attempts cannot be deleted; unpublish instead.')));
  view().append(card('Paper settings', null, settings));

  // sections + questions
  for (const [si, s] of d.sections.entries()) {
    const qs = d.questions.filter((q) => q.section_id === s.id);
    const list = el('div');
    for (const q of qs) list.append(questionRow(q, statMap.get(q.id), { paper: p, sections: d.sections, topics, reload, attempts: d.attempt_count }));
    if (!qs.length) list.append(el('div', { class: 'empty' }, 'No questions in this section yet.'));
    const lastQ = qs[qs.length - 1];
    view().append(el('section', { class: 'card sec-card' },
      el('div', { class: 'card-head' },
        el('div', {}, el('h3', {}, s.name, ' ', el('span', { class: 'badge badge-blue', style: { marginLeft: '6px' } }, s.qtype)),
          el('p', { class: 'muted small', style: { margin: '2px 0 0' } }, `${qs.length} question${qs.length === 1 ? '' : 's'} · ${num(qs.reduce((t, q) => t + Number(q.marks), 0))} marks${s.info ? ' · ' + s.info : ''}`)),
        el('div', { class: 'q-actions' },
          el('button', { class: 'btn', type: 'button', title: 'Move up', disabled: si === 0, onclick: () => move('section', s.id, 'up', reload) }, '↑'),
          el('button', { class: 'btn', type: 'button', title: 'Move down', disabled: si === d.sections.length - 1, onclick: () => move('section', s.id, 'down', reload) }, '↓'),
          el('button', { class: 'btn', type: 'button', onclick: () => sectionModal(p, s, reload) }, 'Edit'),
          qs.length ? null : el('button', { class: 'btn', type: 'button', onclick: async () => {
            if (!(await confirmBox('Delete section?', `Delete “${s.name}”?`, { ok: 'Delete', danger: true }))) return;
            try { await A('ceed_admin_delete_section', { p_section: s.id }); reload(); } catch (e) { toast(e.message, 'bad'); }
          } }, 'Delete'))),
      list,
      el('div', { class: 'add-q' }, el('button', { class: 'btn btn-primary', type: 'button', onclick: () => questionEditor({ paper: p, sections: d.sections, section: s, template: lastQ, topics, reload, nextNumber: (lastQ ? lastQ.number : d.questions.filter((q) => d.sections.findIndex((x) => x.id === q.section_id) < si).length) + 1 }) }, `+ Add question to ${s.short_name || s.name}`))));
  }
  view().append(el('div', { style: { marginTop: '16px' } }, el('button', { class: 'btn', type: 'button', onclick: () => sectionModal(p, null, reload) }, '+ Add section')));
}

async function move(kind, id, dir, reload) {
  try { await A('ceed_admin_move', { p_kind: kind, p_id: id, p_dir: dir }); reload(); } catch (e) { toast(e.message, 'bad'); }
}

function questionRow(q, st, ctx) {
  const thumb = q.image_url ? el('div', { class: 'q-thumb', title: 'View screenshot', onclick: () => modal({ title: `Question ${q.number}`, wide: true, body: imgEl(q.image_url, { alt: `Question ${q.number}`, style: { width: '100%' } }) }) }) : el('div', { class: 'q-thumb' });
  if (q.image_url) imageSrc(q.image_url).then((src) => { if (src) thumb.style.backgroundImage = `url("${src}")`; }).catch(() => {});
  const pctText = st && st.n ? `${Math.round((st.correct / st.n) * 100)}% correct · avg ${mmss(st.avg_time)} · ${st.n} attempts` : null;
  return el('div', { class: 'q-row' },
    el('div', { class: 'qn' }, `Q${q.number}`),
    thumb,
    el('div', { class: 'q-meta' },
      el('span', { class: 'badge' }, q.qtype),
      el('span', {}, 'Answer: ', el('span', { class: 'key' }, q.key_text || (q.bonus ? 'marks to all' : '—'))),
      el('span', { class: 'muted' }, `+${num(q.marks)} / −${num(q.neg_marks)}`),
      q.partial ? el('span', { class: 'badge' }, 'Partial marking') : null,
      q.bonus ? el('span', { class: 'badge badge-warn' }, 'Marks to all') : null,
      q.topic ? el('span', { class: 'muted' }, `· ${q.topic}`) : null,
      pctText ? el('span', { class: 'badge badge-blue' }, pctText) : null),
    el('div', { class: 'q-actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => questionEditor({ ...ctx, question: q, section: ctx.sections.find((s) => s.id === q.section_id) }) }, 'Edit'),
      el('button', { class: 'btn', type: 'button', title: 'Move up', onclick: () => move('question', q.id, 'up', ctx.reload) }, '↑'),
      el('button', { class: 'btn', type: 'button', title: 'Move down', onclick: () => move('question', q.id, 'down', ctx.reload) }, '↓'),
      ctx.attempts ? null : el('button', { class: 'btn', type: 'button', title: 'Delete', onclick: async () => {
        if (!(await confirmBox('Delete question?', `Delete Q${q.number}? This cannot be undone.`, { ok: 'Delete', danger: true }))) return;
        try { await A('ceed_admin_delete_question', { p_question: q.id }); toast('Question deleted.', 'ok'); ctx.reload(); } catch (e) { toast(e.message, 'bad'); }
      } }, '✕')));
}

function sectionModal(paper, section, reload) {
  const name = el('input', { class: 'input', value: section ? section.name : '', placeholder: 'e.g. Section I: NAT' });
  const short = el('input', { class: 'input', value: section ? section.short_name || '' : '', placeholder: 'NAT' });
  const type = el('select', { class: 'input' }, ...['NAT', 'MSQ', 'MCQ'].map((t) => el('option', { value: t }, `${t} — ${TYPE_INFO[t]}`)));
  type.value = section ? section.qtype : 'MCQ';
  const info = el('input', { class: 'input', value: section ? section.info || '' : '', placeholder: 'e.g. 25 questions · +2 for correct · −0.6 for wrong' });
  const err = el('div', { class: 'error-text' });
  modal({
    title: section ? 'Edit section' : 'Add section',
    body: el('div', {}, field('Section name', name), el('div', { class: 'row2' }, field('Short name', short), field('Default question type', type)), field('Info line (shown to students)', info), err),
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
      try {
        const body = { name: name.value, short_name: short.value, qtype: type.value, info: info.value };
        if (section) body.id = section.id;
        else body.paper_id = paper.id;
        await A('ceed_admin_save_section', { p_data: body });
        reload();
      } catch (e) { err.textContent = e.message; return false; }
    } }],
  });
}

// ---------------------------------------------------------------- question editor (one by one, screenshot)
function questionEditor(ctx) {
  const editing = Boolean(ctx.question);
  const q0 = ctx.question || {};
  const tpl = ctx.template || {};
  const defaults = { NAT: [3, 0], MSQ: [2, 0], MCQ: [2, 0.6] };
  const st = {
    file: null,
    preview: q0.image_url || null,
    qtype: q0.qtype || ctx.section.qtype,
    options: q0.options_count || 4,
    keys: new Set((q0.answer && q0.answer.options) || []),
    natMin: q0.answer && q0.answer.min !== undefined ? q0.answer.min : '',
    natMax: q0.answer && q0.answer.max !== undefined && q0.answer.max !== q0.answer.min ? q0.answer.max : '',
    number: editing ? q0.number : ctx.nextNumber,
  };
  const markDefault = (t) => (tpl.qtype === t ? [tpl.marks, tpl.neg_marks] : defaults[t]);
  const [m0, n0] = editing ? [q0.marks, q0.neg_marks] : markDefault(st.qtype);
  const marks = el('input', { class: 'input', type: 'number', step: '0.01', min: '0', value: m0 });
  const neg = el('input', { class: 'input', type: 'number', step: '0.01', min: '0', value: n0 });
  const topic = el('input', { class: 'input', list: 'topic-list', value: q0.topic || (editing ? '' : tpl.topic || ''), placeholder: 'e.g. Visualisation & spatial ability' });
  const topicList = el('datalist', { id: 'topic-list' }, ...ctx.topics.map((t) => el('option', { value: t })));
  const solution = el('textarea', { class: 'input', rows: 3, placeholder: 'Optional: short explanation shown in results' });
  solution.value = q0.solution || '';
  const text = el('textarea', { class: 'input', rows: 2, placeholder: 'Optional: question text (if you are not using a screenshot)' });
  text.value = q0.text || '';
  const partial = switchEl('Partial marking (MSQ)', q0.partial);
  const bonus = switchEl('Marks to all (dropped question)', q0.bonus);
  const sectionSel = el('select', { class: 'input' }, ...ctx.sections.map((s) => el('option', { value: s.id }, s.name)));
  sectionSel.value = ctx.section.id;
  const err = el('div', { class: 'error-text' });

  // screenshot drop zone
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hidden' });
  const drop = el('div', { class: 'drop', tabindex: 0, role: 'button', 'aria-label': 'Add question screenshot' });
  const drawDrop = () => {
    drop.innerHTML = '';
    if (st.preview) {
      drop.append(imgEl(st.preview, { alt: 'Question screenshot' }), el('div', { class: 'hint small', style: { marginTop: '8px' } }, 'Click, drop or paste to replace the screenshot'));
    } else {
      drop.append(
        el('div', { style: { fontSize: '30px' }, 'aria-hidden': 'true' }, '🖼'),
        el('div', { class: 'hint' }, el('b', {}, 'Paste a screenshot'), ' (', el('span', { class: 'kbd' }, 'Ctrl'), ' + ', el('span', { class: 'kbd' }, 'V'), ')'),
        el('div', { class: 'hint small' }, 'or drag & drop / click to choose an image (PNG, JPG, WEBP · max 15 MB, it is compressed automatically)'));
    }
  };
  const setFile = (file) => {
    if (!file || !/^image\//.test(file.type)) return toast('Please choose an image file.', 'bad');
    if (file.size > 15 * 1024 * 1024) return toast('That image is larger than 15 MB.', 'bad');
    st.file = file;
    st.preview = URL.createObjectURL(file);
    drawDrop();
  };
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => fileInput.files[0] && setFile(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) setFile(f); });
  const onPaste = (e) => {
    const item = [...(e.clipboardData || {}).items || []].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); setFile(item.getAsFile()); }
  };
  document.addEventListener('paste', onPaste);
  drawDrop();

  // answer area
  const answerBox = el('div');
  const typeSeg = el('div', { class: 'seg-type', role: 'group', 'aria-label': 'Question type' });
  const optCount = el('select', { class: 'input', style: { width: 'auto' } }, ...[2, 3, 4, 5, 6].map((n) => el('option', { value: n }, `${n} options`)));
  optCount.value = String(st.options);
  optCount.addEventListener('change', () => { st.options = Number(optCount.value); [...st.keys].forEach((k) => { if (LETTERS.indexOf(k) >= st.options) st.keys.delete(k); }); drawAnswer(); });
  const drawType = () => {
    typeSeg.innerHTML = '';
    for (const t of ['NAT', 'MSQ', 'MCQ']) {
      typeSeg.append(el('button', { type: 'button', class: t === st.qtype ? 'on' : '', 'aria-pressed': String(t === st.qtype), onclick: () => {
        if (st.qtype === t) return;
        st.qtype = t;
        st.keys.clear();
        if (!editing) { const [a, b] = markDefault(t); marks.value = a; neg.value = b; }
        drawType(); drawAnswer();
      } }, t));
    }
  };
  const natMin = el('input', { class: 'input', type: 'text', inputmode: 'decimal', placeholder: 'e.g. 56', value: st.natMin });
  const natMax = el('input', { class: 'input', type: 'text', inputmode: 'decimal', placeholder: 'optional', value: st.natMax });
  const drawAnswer = () => {
    answerBox.innerHTML = '';
    partial.classList.toggle('hidden', st.qtype !== 'MSQ');
    if (st.qtype === 'NAT') {
      answerBox.append(el('div', { class: 'row2' }, field('Correct answer', natMin), field('…up to (for a range)', natMax)),
        el('p', { class: 'inline-note' }, 'For an exact answer fill only the first box. For a range (e.g. 250.9 to 251.1) fill both.'));
      return;
    }
    const chips = el('div', { class: 'opt-chips', role: 'group', 'aria-label': 'Correct options' });
    for (let i = 0; i < st.options; i++) {
      const L = LETTERS[i];
      chips.append(el('button', { type: 'button', class: `opt-chip ${st.keys.has(L) ? 'on' : ''}`, 'aria-pressed': String(st.keys.has(L)), onclick: (ev) => {
        if (st.qtype === 'MCQ' && !st.keys.has(L) && st.keys.size && !ev.shiftKey) st.keys.clear();
        st.keys.has(L) ? st.keys.delete(L) : st.keys.add(L);
        drawAnswer();
      } }, L));
    }
    answerBox.append(el('div', { class: 'field' }, el('label', {}, st.qtype === 'MCQ' ? 'Correct option' : 'Correct options (select all that are correct)'), el('div', { class: 'row' }, chips, optCount)),
      el('p', { class: 'inline-note' }, st.qtype === 'MCQ' ? 'Tip: hold Shift to select a second option only if the official key accepts two answers.' : 'Students get marks only if they select exactly these options (unless partial marking is on).'));
  };
  drawType();
  drawAnswer();

  const right = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Question type'), typeSeg),
    answerBox,
    el('div', { class: 'row2' }, field('Marks for correct', marks), field('Negative marks (wrong)', neg)),
    el('div', { class: 'toggles' }, partial, bonus),
    field('Topic', topic), topicList,
    editing ? field('Section', sectionSel) : null,
    field('Explanation (optional)', solution),
    field('Question text (optional)', text),
    err);
  const body = el('div', { class: 'qe' }, el('div', {}, drop, fileInput), right);
  const title = () => `${editing ? 'Edit' : 'Add'} question · Q${st.number} · ${ctx.section.name}`;

  async function save(addNext) {
    err.textContent = '';
    const data = {
      qtype: st.qtype, options_count: st.options, marks: marks.value, neg_marks: neg.value,
      partial: partial.querySelector('input').checked, bonus: bonus.querySelector('input').checked,
      topic: topic.value, solution: solution.value, text: text.value,
      answer: st.qtype === 'NAT' ? { min: natMin.value.trim(), max: natMax.value.trim() } : { options: [...st.keys] },
    };
    if (editing) { data.id = q0.id; data.section_id = sectionSel.value; } else data.section_id = ctx.section.id;
    if (!editing && !st.file && !text.value.trim()) { err.textContent = 'Add a screenshot of the question first.'; return false; }
    try {
      if (st.file) data.image_data = await compressImage(st.file);
      await A('ceed_admin_save_question', { p_data: data });
    } catch (e) {
      err.textContent = e.message;
      return false;
    }
    toast(`Q${st.number} saved.`, 'ok');
    ctx.reload();
    if (addNext) {
      st.file = null; st.preview = null; st.keys.clear(); st.number += 1;
      natMin.value = ''; natMax.value = ''; solution.value = ''; text.value = '';
      bonus.querySelector('input').checked = false;
      drawDrop(); drawAnswer();
      m.box.querySelector('.modal-head h2').textContent = title();
      m.box.querySelector('.modal-body').scrollTop = 0;
      return false; // keep the modal open
    }
    return true;
  }
  const actions = [{ label: 'Cancel' }];
  if (!editing) actions.push({ label: 'Save & add next', onClick: () => save(true) });
  actions.push({ label: editing ? 'Save changes' : 'Save question', kind: 'primary', onClick: () => save(false) });
  const m = modal({ title: title(), wide: true, body, actions, onClose: () => document.removeEventListener('paste', onPaste) });
}

// Screenshots are re-encoded (max 1600 px wide, WebP) so they load fast for students.
async function compressImage(file) {
  const raw = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error('Could not read the image file.'));
    fr.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('This image could not be opened. Try a PNG or JPG.'));
    i.src = raw;
  });
  const scale = Math.min(1, 1600 / (img.naturalWidth || 1));
  const okType = /^data:image\/(png|jpeg|webp|gif);base64,/.test(raw);
  if (scale === 1 && okType && raw.length < 400000) return raw;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  let out = c.toDataURL('image/webp', 0.9);
  if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.92); // browsers without a WebP encoder
  if (scale === 1 && okType && raw.length < out.length) out = raw;
  if (out.length > 7900000) throw new Error('This screenshot is too large even after compressing. Crop it and try again.');
  return out;
}

// ---------------------------------------------------------------- students
async function showStudents() {
  view().innerHTML = '';
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search name, email or mobile', style: { minWidth: '280px' } });
  const box = el('div');
  view().append(el('div', { class: 'toolbar' }, el('h1', { style: { fontSize: '22px' } }, 'Students'), el('span', { class: 'spacer' }), search), box);
  let t;
  const load = async () => {
    const students = await A('ceed_admin_students', { p_search: search.value.trim() });
    box.innerHTML = '';
    box.append(card(`${students.length} student${students.length === 1 ? '' : 's'}`, 'Everyone who has started a test', table(
      ['Name', 'Email', 'Mobile', 'City', 'First test', 'Last seen', { label: 'Tests', cls: 'num' }, { label: 'Best', cls: 'num' }, ''],
      students.map((u) => {
        const tr = el('tr', { class: 'clickable', onclick: () => (location.hash = `#attempts?student=${u.id}`) },
          el('td', {}, el('b', {}, u.name || '—')),
          el('td', {}, u.email || '—'), el('td', { class: 'nowrap' }, u.phone ? `+91 ${u.phone}` : '—'), el('td', {}, u.city || '—'),
          el('td', { class: 'nowrap' }, fmtDate(u.created_at, false)), el('td', { class: 'nowrap' }, fmtDate(u.last_seen_at)),
          el('td', { class: 'num' }, `${u.submitted}/${u.attempts}`), el('td', { class: 'num' }, u.best === null ? '–' : num(u.best)),
          el('td', { class: 'num' }, el('a', { href: `#attempts?student=${u.id}` }, 'Attempts →')));
        return tr;
      }),
      { empty: 'No students found.' })));
  };
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  await load();
}

// ---------------------------------------------------------------- attempts
async function showAttempts(params) {
  const papers = await A('ceed_admin_papers');
  const paperSel = el('select', { class: 'input' }, el('option', { value: '' }, 'All papers'), ...papers.map((p) => el('option', { value: p.id }, p.title)));
  const statusSel = el('select', { class: 'input' }, el('option', { value: '' }, 'All statuses'), el('option', { value: 'submitted' }, 'Submitted'), el('option', { value: 'in_progress' }, 'In progress'));
  const modeSel = el('select', { class: 'input', 'aria-label': 'Rank by' }, el('option', { value: 'first' }, 'Rank by first attempt'), el('option', { value: 'best' }, 'Rank by best attempt'));
  paperSel.value = params.get('paper') || (papers.length === 1 ? papers[0].id : '');
  statusSel.value = params.get('status') || '';
  modeSel.value = params.get('rank') === 'best' ? 'best' : 'first';
  const student = params.get('student') || '';
  const box = el('div');
  const setHash = () => {
    const q = new URLSearchParams();
    if (paperSel.value) q.set('paper', paperSel.value);
    if (statusSel.value) q.set('status', statusSel.value);
    if (modeSel.value === 'best') q.set('rank', 'best');
    if (student) q.set('student', student);
    location.hash = `#attempts${q.toString() ? '?' + q : ''}`;
  };
  paperSel.addEventListener('change', setHash);
  statusSel.addEventListener('change', setHash);
  modeSel.addEventListener('change', setHash);
  const paper = papers.find((p) => p.id === paperSel.value);
  view().innerHTML = '';
  view().append(el('div', { class: 'toolbar' }, el('h1', { style: { fontSize: '22px' } }, 'Results & ranks'), el('span', { class: 'spacer' }),
    student ? el('a', { class: 'btn btn-sm', href: '#attempts' }, 'Showing one student ✕') : null, paperSel, statusSel,
    paper ? el('button', { class: 'btn', type: 'button', onclick: () => exportResults(paper.id, paper.title, modeSel.value) }, 'Download CSV') : null), box);
  const attempts = await A('ceed_admin_attempts', { p_paper: paperSel.value || null, p_status: statusSel.value || null, p_student: student || null });

  // rank list for one paper
  if (paper && !student && statusSel.value !== 'in_progress') {
    const d = await paperDetail(paper.id);
    const secs = d.sections.filter((s) => d.questions.some((q) => q.section_id === s.id));
    const ranked = rankRows(attempts, modeSel.value);
    box.append(card(`Rank list · ${paper.title}`, `${ranked.length} student${ranked.length === 1 ? '' : 's'} · ${modeSel.value === 'best' ? "each student's best attempt" : "each student's first attempt (fair comparison)"} · equal scores share a rank`, table(
      [{ label: 'Rank', cls: 'num' }, 'Student', 'City', { label: 'Score', cls: 'num' }, ...secs.map((s) => ({ label: secKey(s), cls: 'num' })),
        { label: 'C / W / U', cls: 'num' }, { label: 'Time used', cls: 'num' }, 'Submitted', { label: 'Tries', cls: 'num' }, ''],
      ranked.map((a) => {
        const tr = el('tr', { class: 'clickable', onclick: (e) => { if (!e.target.closest('a')) location.href = `result.html?attempt=${a.id}`; } },
          el('td', { class: 'num' }, el('span', { class: `rank-pill ${a.rank <= 3 ? 'top' + a.rank : ''}` }, String(a.rank))),
          el('td', {}, el('b', {}, a.name || '—'), el('div', { class: 'muted small' }, contact(a))),
          el('td', {}, a.city || '—'),
          el('td', { class: 'num nowrap' }, el('b', {}, num(a.score)), el('span', { class: 'muted small' }, ` / ${num(a.max_score)}`)),
          ...secs.map((s) => el('td', { class: 'num' }, a.section_scores && a.section_scores[secKey(s)] !== undefined && a.section_scores[secKey(s)] !== null ? num(a.section_scores[secKey(s)]) : '–')),
          el('td', { class: 'num nowrap' }, a.correct === null || a.correct === undefined ? '–' : `${a.correct} / ${a.wrong} / ${a.unattempted}`),
          el('td', { class: 'num' }, mmss(Math.min(a.time_used_ms, a.duration_ms))),
          el('td', { class: 'nowrap' }, fmtDate(a.submitted_at)),
          el('td', { class: 'num' }, String(a.tries)),
          el('td', { class: 'num nowrap' }, el('a', { href: `result.html?attempt=${a.id}` }, 'Analysis →')));
        return tr;
      }),
      { empty: 'No submitted attempts yet.' }), el('div', { class: 'row', style: { padding: '0 20px 16px' } }, modeSel)));
  } else if (!paper && !student && papers.length > 1) {
    box.append(el('p', { class: 'muted', style: { margin: '0 0 14px' } }, 'Choose a paper above to see its rank list.'));
  }

  box.append(card(`${attempts.length} attempt${attempts.length === 1 ? '' : 's'}`, 'Every attempt, newest first. Click a submitted attempt to open its full analysis.', table(
    ['Student', 'Paper', 'Status', { label: 'Score', cls: 'num' }, { label: 'C / W / U', cls: 'num' }, { label: 'Time used', cls: 'num' }, { label: 'Tab switches', cls: 'num' }, 'Started', ''],
    attempts.map((a) => {
      const acts = el('td', { class: 'num nowrap' });
      if (a.status === 'submitted') acts.append(el('a', { href: `result.html?attempt=${a.id}` }, 'Analysis →'));
      else acts.append(el('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmBox('Submit this attempt now?', 'The student’s saved answers will be evaluated and the attempt closed.', { ok: 'Submit now' }))) return;
        try { await A('ceed_admin_force_submit', { p_attempt: a.id }); } catch (ex) { return toast(ex.message, 'bad'); }
        toast('Attempt submitted.', 'ok');
        route();
      } }, 'Submit now'));
      acts.append(' ', el('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'Delete attempt', onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmBox('Delete this attempt?', `Delete ${a.name || 'this student'}’s attempt ${a.attempt_no} of “${a.title}”? Its answers and analysis will be removed permanently.`, { ok: 'Delete', danger: true }))) return;
        try { await A('ceed_admin_delete_attempt', { p_attempt: a.id }); } catch (ex) { return toast(ex.message, 'bad'); }
        toast('Attempt deleted.', 'ok');
        route();
      } }, '✕'));
      const tr = el('tr', { class: a.status === 'submitted' ? 'clickable' : '' },
        el('td', {}, el('b', {}, a.name || '—'), el('div', { class: 'muted small' }, contact(a))),
        el('td', {}, a.title, el('div', { class: 'muted small' }, `Attempt ${a.attempt_no}`)),
        el('td', {}, statusBadge(a)),
        el('td', { class: 'num nowrap' }, a.score === null ? '–' : `${num(a.score)} / ${num(a.max_score)}`),
        el('td', { class: 'num nowrap' }, a.correct === null || a.correct === undefined ? '–' : `${a.correct} / ${a.wrong} / ${a.unattempted}`),
        el('td', { class: 'num' }, mmss(Math.min(a.time_used_ms, a.duration_ms))),
        el('td', { class: 'num' }, String(a.tab_switches || 0)),
        el('td', { class: 'nowrap' }, fmtDate(a.started_at)),
        acts);
      if (a.status === 'submitted') tr.addEventListener('click', (e) => { if (!e.target.closest('button,a')) location.href = `result.html?attempt=${a.id}`; });
      return tr;
    }),
    { empty: 'No attempts match these filters.' })));
}
