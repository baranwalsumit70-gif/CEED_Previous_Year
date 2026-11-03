// CBT exam screen: candidate login -> instructions -> exam -> submit. Mirrors the CEED (TCS iON) interface rules.
import {
  rpc, CFG, el, $, $$, logoSvg, clock, num, initials, modal, toast, lsGet, lsSet, lsDel, qs,
  getStudent, saveStudent, rememberAttempt, hashToken, getAdminPass, setImg, imageSrc, imgEl,
} from './common.js';

const LETTERS = 'ABCDEFGH';
const STATUS_LABEL = {
  answered: 'Answered',
  not_answered: 'Not Answered',
  not_visited: 'Not Visited',
  marked: 'Marked for Review',
  answered_marked: 'Answered & Marked for Review',
};
let STUDENT = null; // { name, email, phone, city } entered on the login screen
const PREVIEW = qs('preview') === '1' ? getAdminPass() : ''; // admin trying an unpublished paper
const S = {}; // live exam state

// ---------------------------------------------------------------- boot
(async function boot() {
  $('#x-logo').innerHTML = logoSvg();
  $('#x-app').textContent = CFG.SITE_NAME;
  const token = hashToken();
  const paperId = qs('paper');
  try {
    if (token) await showResume(token);
    else if (paperId) await showLogin(paperId);
    else showError('Please choose a test on the home page first.', 'Choose a test');
  } catch (e) {
    showError(e.message);
  }
})();

function showError(msg, title = 'Something went wrong') {
  const body = $('#x-body');
  body.innerHTML = '';
  body.append(el('div', { class: 'card card-pad', style: { margin: 'auto', maxWidth: '460px', textAlign: 'center', fontFamily: 'var(--font)' } },
    el('h2', { style: { marginBottom: '8px' } }, title),
    el('p', { class: 'muted', style: { marginBottom: '16px' } }, msg || 'Please try again.'),
    el('a', { class: 'btn btn-primary', href: 'index.html#papers' }, 'Go to the tests')));
}

function requestFs() {
  const d = document.documentElement;
  try {
    if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen().catch(() => {});
  } catch (_) { /* not supported (e.g. iPhone) */ }
}

// ---------------------------------------------------------------- shared instruction content
function legendIcon(status, n = '') {
  return el('span', { class: `qs mini ${status}`, 'aria-hidden': 'true' }, String(n));
}

function generalInstructions(durationMin, timerMode) {
  const box = el('div');
  box.append(el('h2', {}, 'Please read the instructions carefully'));
  box.append(el('h3', {}, 'General Instructions:'));
  const ol = el('ol');
  ol.append(
    el('li', {}, `The total duration of the examination is ${durationMin} minutes.`),
    el('li', {}, 'The clock is set on the server. The countdown timer at the top right of the screen shows the time left. When the timer reaches zero, the examination ends by itself. You do not need to end or submit it.'),
    el('li', {}, 'The Question Palette on the right of the screen shows the status of each question with one of these symbols:',
      el('div', { class: 'lg-row' }, legendIcon('not_visited', 1), 'You have not visited the question yet.'),
      el('div', { class: 'lg-row' }, legendIcon('not_answered', 2), 'You have not answered the question.'),
      el('div', { class: 'lg-row' }, legendIcon('answered', 3), 'You have answered the question.'),
      el('div', { class: 'lg-row' }, legendIcon('marked', 4), 'You have NOT answered the question, but have marked it for review.'),
      el('div', { class: 'lg-row' }, legendIcon('answered_marked', 5), 'You have answered the question and marked it for review. This answer WILL be considered for evaluation.'),
      el('p', { style: { marginTop: '6px' } }, '"Marked for Review" only reminds you to look at the question again.')),
    el('li', {}, 'Click the arrow (›) on the left edge of the question palette to hide it and enlarge the question area. Click (‹) to show it again.'),
  );
  box.append(ol);
  box.append(el('h3', {}, 'Navigating to a Question:'));
  box.append(el('ol', { start: 5 },
    el('li', {}, 'To answer a question, do the following:',
      el('ol', { type: 'a' },
        el('li', {}, 'Click a question number in the Question Palette to go to that question directly. ', el('b', {}, 'Note that this does NOT save your answer to the current question.')),
        el('li', {}, 'Click ', el('b', {}, 'Save & Next'), ' to save your answer for the current question and go to the next question.'),
        el('li', {}, 'Click ', el('b', {}, 'Mark for Review & Next'), ' to save your answer for the current question, mark it for review, and go to the next question.')))));
  box.append(el('h3', {}, 'Answering a Question:'));
  box.append(el('ol', { start: 6 },
    el('li', {}, 'Multiple Choice Questions (MCQ, only one correct option):',
      el('ol', { type: 'a' },
        el('li', {}, 'To select your answer, click one of the option buttons.'),
        el('li', {}, 'To deselect it, click the same option again or click ', el('b', {}, 'Clear Response'), '.'),
        el('li', {}, 'To change your answer, click another option.'),
        el('li', {}, 'To save your answer, you MUST click ', el('b', {}, 'Save & Next'), ' (or Mark for Review & Next).'))),
    el('li', {}, 'Multiple Select Questions (MSQ, one or more correct options): select every option you think is correct, then click Save & Next.'),
    el('li', {}, 'Numerical Answer Type (NAT): enter the number using the virtual keypad on the screen (use "." for decimals and "-" for negative numbers), then click Save & Next. No options are shown for these questions.'),
    el('li', {}, 'To change an answer you saved earlier, open that question, change the answer and save it again.')));
  box.append(el('h3', {}, 'Navigating through Sections:'));
  box.append(el('ol', { start: 10 },
    el('li', {}, 'The sections of this paper are shown in the bar at the top of the screen. Click a section name to view its questions. The section you are in is highlighted.'),
    el('li', {}, 'After you click Save & Next on the last question of a section, you go to the first question of the next section automatically.'),
    el('li', {}, 'You can move between sections and questions at any time during the examination.'),
    el('li', {}, 'Hover over the (i) next to a section name to see the summary of that section.')));
  box.append(el('h3', {}, 'About this online test:'));
  box.append(el('ol', { start: 14 },
    el('li', {}, 'Your answers are saved to the server automatically as you work.'),
    timerMode === 'strict'
      ? el('li', {}, 'The timer keeps running even if you close the page or lose your internet connection.')
      : el('li', {}, 'If your internet or power goes off, open the test again (on this device, or sign in with the same email on another device) and click Resume. The timer pauses while you are away.'),
    el('li', {}, 'The test opens in full screen. Leaving full screen or switching to another tab is recorded in your analysis.'),
    el('li', {}, 'After you submit, you will see your score, the time you spent on each question and a section-wise analysis.')));
  return box;
}

function paperInstructions(info) {
  const box = el('div');
  box.append(el('h2', {}, info.paper.title));
  const t = el('table');
  t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Section'), el('th', {}, 'Question numbers'), el('th', {}, 'Questions'), el('th', {}, 'Marks'), el('th', {}, 'Answering'))));
  const tb = el('tbody');
  for (const s of info.sections) {
    tb.append(el('tr', {}, el('td', {}, s.name), el('td', {}, s.first ? `${s.first} – ${s.last}` : '–'), el('td', {}, String(s.count)), el('td', {}, num(s.marks)), el('td', {}, s.info || s.qtype)));
  }
  tb.append(el('tr', {}, el('td', {}, el('b', {}, 'Total')), el('td', {}, ''), el('td', {}, el('b', {}, String(info.total_questions))), el('td', {}, el('b', {}, num(info.max_marks))), el('td', {}, `${info.paper.duration_min} minutes`)));
  t.append(tb);
  box.append(t);
  if (info.paper.instructions) {
    box.append(el('h3', {}, 'Instructions for this paper:'));
    box.append(el('div', { class: 'para' }, info.paper.instructions));
  }
  return box;
}

// ---------------------------------------------------------------- candidate login (name + email)
async function showLogin(paperId) {
  const info = await rpc('ceed_paper_info', { p_paper: paperId, p_pass: PREVIEW || null });
  document.title = `${info.paper.title} · Candidate login`;
  const s = getStudent();
  const input = (id, attrs) => el('input', { class: 'x-input', id, ...attrs });
  const name = input('lg-name', { autocomplete: 'name', maxlength: '80', value: s.name || '', placeholder: 'e.g. Asha Rao' });
  const email = input('lg-email', { type: 'email', autocomplete: 'email', inputmode: 'email', maxlength: '200', value: s.email || '', placeholder: 'you@example.com' });
  const phone = input('lg-phone', { type: 'tel', autocomplete: 'tel', inputmode: 'numeric', maxlength: '14', value: s.phone || '', placeholder: 'Optional' });
  const city = input('lg-city', { autocomplete: 'address-level2', maxlength: '80', value: s.city || '', placeholder: 'Optional' });
  const err = el('div', { class: 'x-err', role: 'alert' });
  const photo = el('div', { class: 'x-photo', 'aria-hidden': 'true' }, initials(s.name || ''));
  const shownName = el('b', {}, s.name || '—');
  name.addEventListener('input', () => { photo.textContent = initials(name.value); shownName.textContent = name.value.trim() || '—'; });
  const row = (label, ctl, hint) => el('div', { class: 'x-field' }, el('label', { for: ctl.id }, label), ctl, hint ? el('div', { class: 'x-hint' }, hint) : null);
  const form = el('form', { class: 'x-login-card', novalidate: true },
    el('div', { class: 'x-login-head' }, 'Candidate Login'),
    el('div', { class: 'x-login-body' },
      row('Full name', name),
      row('Email address', email, 'Use the same email every time. Your attempts and results are saved with it.'),
      el('div', { class: 'x-row2' }, row('Mobile number', phone), row('City', city)),
      err,
      el('button', { class: 'x-btn primary x-signin', type: 'submit' }, 'Sign In')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    const v = {
      name: name.value.replace(/\s+/g, ' ').trim(),
      email: email.value.trim().toLowerCase(),
      phone: phone.value.replace(/[^0-9]/g, '').replace(/^91(?=\d{10}$)/, ''),
      city: city.value.trim(),
    };
    if (v.name.length < 2) { err.textContent = 'Please enter your full name.'; return name.focus(); }
    if (!/^[^@\s<>()]+@[^@\s<>()]+\.[a-z]{2,}$/.test(v.email)) { err.textContent = 'Please enter a valid email address.'; return email.focus(); }
    if (v.phone && !/^[6-9]\d{9}$/.test(v.phone)) { err.textContent = 'Please enter a valid 10-digit mobile number, or leave it empty.'; return phone.focus(); }
    saveStudent(v);
    STUDENT = v;
    showInstructions(info);
  });
  const body = $('#x-body');
  body.innerHTML = '';
  body.append(el('div', { class: 'x-login' },
    el('div', { class: 'x-login-info' },
      el('div', { class: 'x-login-cand' }, photo,
        el('div', {},
          el('div', { class: 'kv' }, el('span', {}, 'Candidate Name'), shownName),
          el('div', { class: 'kv' }, el('span', {}, 'Subject'), el('b', {}, info.paper.title)),
          el('div', { class: 'kv' }, el('span', {}, 'Duration'), el('b', {}, `${info.paper.duration_min} minutes`)),
          el('div', { class: 'kv' }, el('span', {}, 'Questions'), el('b', {}, `${info.total_questions} · ${num(info.max_marks)} marks`)))),
      PREVIEW ? el('div', { class: 'ins-warn', style: { marginTop: '14px' } }, 'Admin preview: this attempt is saved like a student attempt. Delete it from the admin page afterwards if you like.') : null,
      el('p', { class: 'x-login-note' }, 'No password or OTP is needed. Enter your name and email to start. ',
        el('a', { href: 'index.html#papers' }, 'Back to tests'))),
    form));
  (s.name ? email : name).focus();
  if (s.name && s.email) form.querySelector('.x-signin').focus();
}

// ---------------------------------------------------------------- instructions page
async function showInstructions(info) {
  document.title = `Instructions · ${info.paper.title}`;
  let page = 1;
  const body = $('#x-body');
  body.innerHTML = '';
  const content = el('div', { class: 'ins-body' });
  const foot = el('div', { class: 'ins-foot' });
  const head = el('div', { class: 'ins-head' }, 'Instructions');
  body.append(el('div', { class: 'ins' },
    el('div', { class: 'ins-main' }, head, content, foot),
    el('aside', { class: 'ins-side' }, el('div', { class: 'x-photo' }, initials(STUDENT.name)), el('div', { class: 'x-cname' }, STUDENT.name), el('div', { class: 'x-cmeta' }, STUDENT.email), el('div', { class: 'x-cmeta' }, info.paper.title))));

  const render = () => {
    content.innerHTML = '';
    foot.innerHTML = '';
    content.scrollTop = 0;
    if (page === 1) {
      head.textContent = 'Instructions';
      content.append(generalInstructions(info.paper.duration_min, info.paper.timer_mode));
      foot.append(el('button', { class: 'x-btn', type: 'button', onclick: () => showLogin(info.paper.id).catch((e) => showError(e.message)) }, '‹ Change details'), el('span', { class: 'spacer' }),
        el('button', { class: 'x-btn primary', type: 'button', onclick: () => { page = 2; render(); } }, 'Next ›'));
    } else {
      head.textContent = 'Other Important Instructions';
      content.append(paperInstructions(info));
      const chk = el('input', { type: 'checkbox', id: 'agree' });
      content.append(el('label', { class: 'declare', for: 'agree' }, chk,
        el('span', {}, 'I have read and understood the instructions. I will attempt this test on my own, without books, notes, internet search or help from anyone, just like the real examination.')));
      if (info.paper.allow_reattempt === false) content.append(el('p', { class: 'muted', style: { marginTop: '12px' } }, 'Note: only one attempt is allowed for this paper.'));
      const start = el('button', { class: 'x-btn primary', type: 'button', disabled: true }, 'I am ready to begin');
      chk.addEventListener('change', () => (start.disabled = !chk.checked));
      start.addEventListener('click', () => begin(info, start));
      foot.append(el('button', { class: 'x-btn', type: 'button', onclick: () => { page = 1; render(); } }, '‹ Previous'), el('span', { class: 'spacer' }), start);
    }
  };
  render();
}

async function begin(info, btn) {
  btn.disabled = true;
  btn.textContent = 'Starting…';
  requestFs(); // must run inside the click
  try {
    const r = await rpc('ceed_start', {
      p_paper: info.paper.id, p_name: STUDENT.name, p_email: STUDENT.email,
      p_phone: STUDENT.phone || null, p_city: STUDENT.city || null, p_pass: PREVIEW || null,
    });
    rememberAttempt({ token: r.token, attempt_id: r.attempt_id, paper_id: info.paper.id, title: info.paper.title, attempt_no: r.attempt_no, email: STUDENT.email });
    history.replaceState(null, '', `exam.html#t=${r.token}`);
    await loadAndRun(r.token);
    if (r.resumed) toast('You had an unfinished attempt of this paper, so it was resumed with your saved answers and time.', 'ok', 7000);
  } catch (e) {
    toast(e.message, 'bad', 6000);
    btn.disabled = false;
    btn.textContent = 'I am ready to begin';
  }
}

// ---------------------------------------------------------------- resume
async function showResume(token) {
  const st = await rpc('ceed_state', { p_token: token });
  if (st.submitted) return location.replace(`result.html#t=${token}`);
  rememberAttempt({ token, attempt_id: st.attempt.id, paper_id: st.paper.id, title: st.paper.title, attempt_no: st.attempt.attempt_no });
  document.title = `${st.paper.title} · Exam`;
  const started = st.attempt.time_used_ms > 0;
  const strict = st.paper.timer_mode === 'strict';
  const btn = el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button' }, started ? 'Resume test' : 'Start test');
  const ov = el('div', { class: 'x-overlay' }, el('div', { class: 'box' },
    el('h2', {}, st.paper.title),
    el('p', {}, started ? (strict ? 'Your test is in progress. The timer is still running.' : 'Your test is paused. The timer continues when you click Resume.') : 'Your test is ready. The timer starts when you click Start.'),
    el('div', { class: 'big' }, clock(st.attempt.remaining_ms)),
    el('p', { class: 'small', style: { marginTop: '-10px', marginBottom: '18px' } }, 'time left'),
    btn,
    el('a', { href: 'index.html#my', class: 'btn btn-ghost btn-block', style: { marginTop: '8px' } }, 'Back to my tests')));
  document.body.append(ov);
  btn.addEventListener('click', async () => {
    requestFs();
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      await loadAndRun(token);
      ov.remove();
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.textContent = 'Try again';
    }
  });
}

// ---------------------------------------------------------------- exam setup
const backupKey = () => `ceed_attempt_${S.id}`;

async function loadAndRun(token) {
  const st = await rpc('ceed_state', { p_token: token });
  if (st.submitted) return location.replace(`result.html#t=${token}`);
  setupState(st, token);
  renderExam();
  startLoops();
  const first = (S.qById.has(st.attempt.current_qid) && st.attempt.current_qid) || S.questions[0].id;
  showQuestion(first, { silent: true });
  if (S.restored) toast('Restored answers that were saved on this device.', 'ok');
}

function setupState(st, token) {
  Object.assign(S, {
    id: st.attempt.id,
    token,
    paper: st.paper,
    sections: st.sections,
    questions: st.questions,
    candidate: st.candidate,
    qById: new Map(st.questions.map((q) => [q.id, q])),
    secQs: new Map(st.sections.map((s) => [s.id, st.questions.filter((q) => q.section_id === s.id)])),
    resp: new Map(),
    lastInSec: new Map(),
    cur: null,
    curSec: st.sections[0] && st.sections[0].id,
    draft: null,
    caret: 0,
    durationMs: st.attempt.duration_ms,
    remainingMs: st.attempt.remaining_ms,
    syncedAt: performance.now(),
    lastTick: performance.now(),
    events: [],
    tabSwitches: st.attempt.tab_switches || 0,
    submitting: false,
    ended: false,
    syncing: false,
    syncAgain: false,
    nextAutoTry: 0,
    restored: false,
  });
  for (const q of S.questions) {
    S.resp.set(q.id, { answer: null, status: 'not_visited', time_ms: 0, visits: 0, first_seen_ms: null, answered_ms: null, changes: 0, dirty: false, important: false });
  }
  for (const r of st.responses) {
    const x = S.resp.get(r.question_id);
    if (!x) continue;
    Object.assign(x, {
      answer: r.answer === undefined ? null : r.answer,
      status: r.status,
      time_ms: Number(r.time_ms) || 0,
      visits: Number(r.visits) || 0,
      first_seen_ms: r.first_seen_ms,
      answered_ms: r.answered_ms,
      changes: Number(r.changes) || 0,
    });
  }
  // Merge answers that were saved on this device but never reached the server.
  const bk = lsGet(backupKey());
  // Ignore a device backup if the server has moved on (e.g. the test was continued on another device).
  const fresh = bk && (bk.elapsed === undefined || st.attempt.time_used_ms <= Number(bk.elapsed) + 15000);
  if (bk && bk.pending && bk.responses && fresh) {
    for (const [qid, r] of Object.entries(bk.responses)) {
      const x = S.resp.get(qid);
      if (!x) continue;
      if (!sameAns(x.answer, r.answer) || x.status !== r.status) S.restored = true;
      Object.assign(x, r, { time_ms: Math.max(x.time_ms, Number(r.time_ms) || 0), dirty: true, important: true });
    }
    if (Array.isArray(bk.events)) S.events.push(...bk.events.slice(-500));
  }
  document.title = `${S.paper.title} · Exam`;
}

// ---------------------------------------------------------------- answers helpers
const isEmpty = (a) => a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0);
const cloneAns = (a) => (Array.isArray(a) ? [...a] : a ?? null);
const sameAns = (a, b) => JSON.stringify(isEmpty(a) ? null : a) === JSON.stringify(isEmpty(b) ? null : b);
const curQ = () => S.qById.get(S.cur);
const INVALID = Symbol('invalid');

function finalDraft(q) {
  const d = S.draft;
  if (isEmpty(d)) return null;
  if (q.qtype !== 'NAT') return cloneAns(d);
  let v = String(d).trim();
  if (v.endsWith('.')) v = v.slice(0, -1);
  if (v.startsWith('.')) v = '0' + v;
  if (v.startsWith('-.')) v = '-0' + v.slice(1);
  if (!/^-?\d+(\.\d+)?$/.test(v)) return INVALID;
  return v;
}
function draftDiffers() {
  const q = curQ();
  if (!q) return false;
  const d = finalDraft(q);
  if (d === INVALID) return true;
  return !sameAns(d, S.resp.get(q.id).answer);
}

function elapsed() {
  return Math.max(0, Math.min(S.durationMs, Math.round(S.durationMs - remaining())));
}
function remaining() {
  return S.remainingMs - (performance.now() - S.syncedAt);
}
function pushEvent(e) {
  if (S.events.length > 2000) S.events.splice(0, 500);
  S.events.push({ t: elapsed(), ...e });
}

// ---------------------------------------------------------------- render
const UI = {};

function renderExam() {
  $('#btn-qp').classList.remove('hidden');
  $('#btn-instr').classList.remove('hidden');
  $('#btn-qp').onclick = openQuestionPaper;
  $('#btn-instr').onclick = openInstructions;
  const body = $('#x-body');
  body.innerHTML = '';

  UI.tabs = el('div', { class: 'x-tabs', role: 'tablist', 'aria-label': 'Sections' });
  UI.timer = el('b', { class: 'tnum' }, clock(S.remainingMs));
  UI.timerBox = el('div', { class: 'x-timer', role: 'timer', 'aria-live': 'off' }, 'Time Left : ', UI.timer);
  UI.qtype = el('div', { class: 'x-qtype' });
  UI.band = el('div', { class: 'x-band' });
  UI.qn = el('span', { class: 'qn' });
  UI.saveState = el('span', { class: 'x-save-state', 'aria-live': 'polite' }, '');
  UI.img = el('img', { alt: '', draggable: 'false' });
  UI.imgLoader = el('div', { class: 'ld' }, el('span', { class: 'spinner' }));
  UI.imgWrap = el('div', { class: 'x-qimg-wrap' }, UI.imgLoader, UI.img);
  UI.qtext = el('div', { class: 'x-qtext hidden' });
  UI.answer = el('div', { class: 'x-answer' });
  UI.scroll = el('div', { class: 'x-qscroll', id: 'qscroll' },
    el('div', { class: 'x-qcontent' }, el('div', { class: 'x-qcol' }, UI.qtext, UI.imgWrap), UI.answer));
  UI.downBtn = el('button', { class: 'round-btn', type: 'button', title: 'Scroll down', 'aria-label': 'Scroll to the answer area', onclick: toggleScroll }, '↓');
  UI.img.addEventListener('load', () => UI.imgLoader.classList.add('hidden'));
  UI.img.addEventListener('error', () => {
    UI.imgLoader.innerHTML = '';
    UI.imgLoader.append(el('span', {}, 'Could not load the question image. ', el('button', { class: 'link-btn', onclick: () => { const u = UI.img.dataset.src; UI.img.dataset.src = ''; UI.imgLoader.innerHTML = '<span class="spinner"></span>'; setImg(UI.img, `${u}${u.startsWith('db:') ? '' : (u.includes('?') ? '&' : '?') + 'r=' + Date.now()}`); } }, 'Retry')));
  });
  UI.img.addEventListener('click', () => openZoom(curQ()));
  UI.img.addEventListener('contextmenu', (e) => e.preventDefault());
  UI.scroll.addEventListener('scroll', () => {
    const atBottom = UI.scroll.scrollTop + UI.scroll.clientHeight >= UI.scroll.scrollHeight - 8;
    UI.downBtn.textContent = atBottom ? '↑' : '↓';
  });

  const main = el('main', { class: 'x-main' },
    el('div', { class: 'x-subbar' }, el('span', { class: 'x-pill', title: S.paper.title }, S.paper.title)),
    el('div', { class: 'x-secbar' }, el('span', { class: 'lbl' }, 'Sections'), UI.tabs,
      el('button', { class: 'x-btn x-pal-toggle', type: 'button', onclick: () => $('#cbt').classList.toggle('pal-open') }, '☰ Questions'),
      UI.timerBox),
    UI.qtype,
    UI.band,
    el('div', { class: 'x-qhead' }, el('span', {}, 'Question No. ', UI.qn), el('span', { class: 'spacer' }), UI.saveState,
      el('button', { class: 'round-btn ghost', type: 'button', title: 'Zoom', 'aria-label': 'Zoom question image', onclick: () => openZoom(curQ()) },
        el('span', { html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/></svg>' })),
      UI.downBtn),
    UI.scroll,
    el('footer', { class: 'x-actions' },
      el('button', { class: 'x-btn', type: 'button', onclick: markNext }, 'Mark for Review & Next'),
      el('button', { class: 'x-btn', type: 'button', onclick: clearResponse }, 'Clear Response'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'x-btn primary', type: 'button', onclick: saveNext }, 'Save & Next')));

  UI.collapse = el('button', { class: 'x-collapse', type: 'button', 'aria-label': 'Hide question palette', onclick: togglePalette }, '›');
  UI.legend = el('div', { class: 'x-legend' });
  UI.secTitle = el('div', { class: 'x-sectitle' });
  UI.palette = el('div', { class: 'x-palette', role: 'group', 'aria-label': 'Question palette' });
  const side = el('aside', { class: 'x-side', 'aria-label': 'Question palette and status' },
    el('div', { class: 'x-cand' }, el('div', { class: 'x-photo', 'aria-hidden': 'true' }, initials(S.candidate.name)),
      el('div', {}, el('div', { class: 'x-cname' }, S.candidate.name), el('div', { class: 'x-cmeta' }, S.paper.title)),
      el('span', { class: 'spacer', style: { flex: '1' } }),
      el('button', { class: 'icon-btn x-pal-toggle', type: 'button', 'aria-label': 'Close palette', onclick: () => $('#cbt').classList.remove('pal-open') }, '×')),
    UI.legend, UI.secTitle,
    el('div', { class: 'x-choose' }, 'Choose a Question'),
    UI.palette,
    el('div', { class: 'x-submit' }, el('button', { class: 'x-btn submit', type: 'button', onclick: openSubmit }, 'Submit')));
  body.append(main, UI.collapse, side);
}

function togglePalette() {
  const c = $('#cbt');
  c.classList.toggle('pal-hidden');
  const hidden = c.classList.contains('pal-hidden');
  UI.collapse.textContent = hidden ? '‹' : '›';
  UI.collapse.setAttribute('aria-label', hidden ? 'Show question palette' : 'Hide question palette');
}

function toggleScroll() {
  const atBottom = UI.scroll.scrollTop + UI.scroll.clientHeight >= UI.scroll.scrollHeight - 8;
  UI.scroll.scrollTo({ top: atBottom ? 0 : UI.scroll.scrollHeight, behavior: 'smooth' });
}

function counts(secId) {
  const c = { answered: 0, not_answered: 0, not_visited: 0, marked: 0, answered_marked: 0, total: 0 };
  const list = secId ? S.secQs.get(secId) : S.questions;
  for (const q of list) {
    c[S.resp.get(q.id).status] += 1;
    c.total += 1;
  }
  return c;
}

function renderTabs() {
  UI.tabs.innerHTML = '';
  for (const s of S.sections) {
    const c = counts(s.id);
    const tip = el('div', { class: 'x-tip', role: 'tooltip' },
      el('div', { style: { fontWeight: '700', marginBottom: '4px' } }, s.name),
      ...['answered', 'not_answered', 'not_visited', 'marked', 'answered_marked'].map((k) =>
        el('div', { class: 'r' }, legendIcon(k, c[k]), STATUS_LABEL[k])));
    const tab = el('button', {
      class: `x-tab ${s.id === S.curSec ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(s.id === S.curSec),
      onclick: () => goSection(s.id),
    }, s.name, el('span', { class: 'info-i', 'aria-hidden': 'true' }, 'i'), tip);
    UI.tabs.append(tab);
  }
}

function renderSide() {
  const c = counts(S.curSec);
  UI.legend.innerHTML = '';
  UI.legend.append(
    el('div', { class: 'it' }, legendIcon('answered', c.answered), 'Answered'),
    el('div', { class: 'it' }, legendIcon('not_answered', c.not_answered), 'Not Answered'),
    el('div', { class: 'it' }, legendIcon('not_visited', c.not_visited), 'Not Visited'),
    el('div', { class: 'it' }, legendIcon('marked', c.marked), 'Marked for Review'),
    el('div', { class: 'it full' }, legendIcon('answered_marked', c.answered_marked),
      el('span', {}, 'Answered & Marked for Review', el('small', {}, '(will be considered for evaluation)'))));
  const sec = S.sections.find((s) => s.id === S.curSec);
  UI.secTitle.textContent = sec ? sec.name : '';
  UI.palette.innerHTML = '';
  for (const q of S.secQs.get(S.curSec) || []) {
    const r = S.resp.get(q.id);
    UI.palette.append(el('button', {
      class: `qs ${r.status} ${q.id === S.cur ? 'current' : ''}`,
      type: 'button',
      title: `Question ${q.number}: ${STATUS_LABEL[r.status]}`,
      'aria-label': `Question ${q.number}, ${STATUS_LABEL[r.status]}`,
      'aria-current': q.id === S.cur ? 'true' : null,
      onclick: () => showQuestion(q.id),
    }, String(q.number)));
  }
}

function renderQuestion() {
  const q = curQ();
  UI.qn.textContent = q.number;
  UI.qtype.innerHTML = '';
  const typeName = { NAT: 'NAT (Numerical Answer Type)', MSQ: 'MSQ (one or more correct options)', MCQ: 'MCQ (only one correct option)' }[q.qtype];
  UI.qtype.append(el('span', {}, 'Question Type : ', el('b', {}, typeName)));
  UI.band.innerHTML = '';
  UI.band.append(el('span', {}, 'Marks for correct answer: ', el('b', {}, num(q.marks))), el('span', {}, '|'),
    el('span', {}, 'Negative Marks: ', el('b', {}, num(q.neg_marks))));
  if (q.partial) UI.band.append(el('span', {}, '| Partial marking'));
  if (q.text) {
    UI.qtext.textContent = q.text;
    UI.qtext.classList.remove('hidden');
  } else UI.qtext.classList.add('hidden');
  if (q.image_url) {
    UI.imgWrap.classList.remove('hidden');
    if (UI.img.dataset.src !== q.image_url) {
      UI.imgLoader.classList.remove('hidden');
      UI.imgLoader.innerHTML = '<span class="spinner"></span>';
      UI.img.alt = `Question ${q.number}`;
      setImg(UI.img, q.image_url);
    }
  } else UI.imgWrap.classList.add('hidden');
  renderAnswer(q);
  // preload the next image
  const idx = S.questions.findIndex((x) => x.id === q.id);
  const nx = S.questions[idx + 1];
  if (nx && nx.image_url) imageSrc(nx.image_url).then((src) => { if (src) new Image().src = src; }).catch(() => {});
}

function renderAnswer(q, focusIdx) {
  const box = UI.answer;
  box.innerHTML = '';
  if (q.qtype === 'NAT') {
    box.append(el('div', { class: 'ah' }, 'Enter your answer using the keypad:'), natPad());
    return;
  }
  const role = q.qtype === 'MCQ' ? 'radio' : 'checkbox';
  box.append(el('div', { class: 'ah' }, q.qtype === 'MCQ' ? 'Select one option:' : 'Select one or more options:'));
  const list = el('div', { class: 'opt-list', role: q.qtype === 'MCQ' ? 'radiogroup' : 'group', 'aria-label': 'Options' });
  for (let i = 0; i < (q.options_count || 4); i++) {
    const L = LETTERS[i];
    const checked = q.qtype === 'MCQ' ? S.draft === L : Array.isArray(S.draft) && S.draft.includes(L);
    list.append(el('button', { type: 'button', class: 'opt', role, 'aria-checked': String(checked), onclick: () => toggleOption(q, L, i) },
      el('span', { class: 'mk', 'aria-hidden': 'true' }), el('span', { class: 'lt' }, L)));
  }
  box.append(list);
  if (focusIdx !== undefined) list.children[focusIdx] && list.children[focusIdx].focus();
}

function toggleOption(q, L, i) {
  if (S.ended) return;
  if (q.qtype === 'MCQ') S.draft = S.draft === L ? null : L;
  else {
    const set = new Set(Array.isArray(S.draft) ? S.draft : []);
    set.has(L) ? set.delete(L) : set.add(L);
    S.draft = set.size ? [...set].sort() : null;
  }
  renderAnswer(q, i);
}

function natPad() {
  const input = el('input', { type: 'text', readonly: true, inputmode: 'none', autocomplete: 'off', 'aria-label': 'Your numerical answer', spellcheck: 'false' });
  input.value = S.draft || '';
  const sync = () => {
    input.value = S.draft || '';
    try { input.setSelectionRange(S.caret, S.caret); } catch (_) { /* ignore */ }
  };
  const press = (k) => {
    if (S.ended) return;
    applyKey(k);
    input.focus({ preventScroll: true });
    sync();
  };
  const kb = (label, k, cls = '') => el('button', { type: 'button', class: cls, onclick: () => press(k), 'aria-label': label }, label);
  const keys = el('div', { class: 'kp' },
    kb('Backspace', 'back', 'w3'),
    ...['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', '-'].map((k) => kb(k, k)),
    el('div', { class: 'arrows' }, el('button', { type: 'button', 'aria-label': 'Move cursor left', onclick: () => press('left') }, '←'), el('button', { type: 'button', 'aria-label': 'Move cursor right', onclick: () => press('right') }, '→')),
    kb('Clear All', 'clear', 'w3'));
  input.addEventListener('click', () => { S.caret = input.selectionStart ?? (S.draft || '').length; });
  input.addEventListener('keyup', () => { S.caret = input.selectionStart ?? S.caret; });
  input.addEventListener('keydown', (e) => {
    const map = { Backspace: 'back', Delete: 'del', ArrowLeft: 'left', ArrowRight: 'right', '.': '.', '-': '-' };
    let k = map[e.key];
    if (!k && /^\d$/.test(e.key)) k = e.key;
    if (k) { e.preventDefault(); press(k); }
    else if (e.key === 'Enter') { e.preventDefault(); saveNext(); }
  });
  setTimeout(sync, 0);
  return el('div', { class: 'nat' }, input, keys);
}

function applyKey(k) {
  let v = S.draft || '';
  let c = Math.max(0, Math.min(S.caret, v.length));
  if (k === 'back') { if (c > 0) { v = v.slice(0, c - 1) + v.slice(c); c -= 1; } }
  else if (k === 'del') v = v.slice(0, c) + v.slice(c + 1);
  else if (k === 'clear') { v = ''; c = 0; }
  else if (k === 'left') c = Math.max(0, c - 1);
  else if (k === 'right') c = Math.min(v.length, c + 1);
  else if (k === '-') { if (c === 0 && !v.startsWith('-') && v.length < 12) { v = '-' + v; c = 1; } }
  else if (k === '.') { if (!v.includes('.') && v.length < 12 && !(c === 0 && v.startsWith('-'))) { v = v.slice(0, c) + '.' + v.slice(c); c += 1; } }
  else if (/^\d$/.test(k)) { if (v.length < 12 && !(c === 0 && v.startsWith('-'))) { v = v.slice(0, c) + k + v.slice(c); c += 1; } }
  S.draft = v === '' ? null : v;
  S.caret = c;
}

// ---------------------------------------------------------------- navigation & actions
function showQuestion(qid, { silent = false } = {}) {
  if (S.ended || !S.qById.has(qid)) return;
  if (!silent && S.cur && S.cur !== qid && draftDiffers()) {
    toast('Your answer to that question was not saved. Use “Save & Next” to save an answer.', 'info', 3200);
  }
  accumulateTime();
  S.cur = qid;
  const q = S.qById.get(qid);
  S.curSec = q.section_id;
  S.lastInSec.set(q.section_id, qid);
  const r = S.resp.get(qid);
  if (r.status === 'not_visited') r.status = 'not_answered';
  r.visits += 1;
  if (r.first_seen_ms === null || r.first_seen_ms === undefined) r.first_seen_ms = elapsed();
  r.dirty = true;
  r.important = true;
  S.draft = cloneAns(r.answer);
  S.caret = typeof S.draft === 'string' ? S.draft.length : 0;
  pushEvent({ type: 'visit', q: qid });
  renderQuestion();
  renderSide();
  renderTabs();
  UI.scroll.scrollTop = 0;
  $('#cbt').classList.remove('pal-open');
  backup(true);
  syncSoon(1500);
}

function goSection(secId) {
  const list = S.secQs.get(secId) || [];
  if (!list.length) return;
  showQuestion(S.lastInSec.get(secId) || list[0].id);
}

function goNext() {
  const list = S.secQs.get(S.curSec);
  const i = list.findIndex((q) => q.id === S.cur);
  if (i < list.length - 1) return showQuestion(list[i + 1].id, { silent: true });
  const si = S.sections.findIndex((s) => s.id === S.curSec);
  for (let k = 1; k <= S.sections.length; k++) {
    const s = S.sections[(si + k) % S.sections.length];
    const qs = S.secQs.get(s.id);
    if (qs && qs.length) return showQuestion(qs[0].id, { silent: true });
  }
}

function commit(mark) {
  const q = curQ();
  const r = S.resp.get(q.id);
  const ans = finalDraft(q);
  if (ans === INVALID) {
    toast('Please enter a valid number.', 'bad');
    return false;
  }
  const prev = r.answer;
  const changed = !sameAns(prev, ans);
  if (changed && !isEmpty(prev) && !isEmpty(ans)) r.changes += 1;
  r.answer = cloneAns(ans);
  if (!isEmpty(ans)) {
    if (changed || r.answered_ms === null || r.answered_ms === undefined) r.answered_ms = elapsed();
    r.status = mark ? 'answered_marked' : 'answered';
  } else {
    r.answered_ms = null;
    r.status = mark ? 'marked' : 'not_answered';
  }
  r.dirty = true;
  r.important = true;
  if (mark) pushEvent({ type: 'mark', q: q.id, a: isEmpty(ans) ? null : ans });
  else if (!isEmpty(ans)) pushEvent({ type: 'save', q: q.id, a: ans });
  else if (!isEmpty(prev)) pushEvent({ type: 'clear', q: q.id });
  S.draft = cloneAns(ans);
  backup(true);
  syncSoon(300);
  return true;
}

function saveNext() {
  if (S.ended) return;
  if (commit(false)) goNext();
}
function markNext() {
  if (S.ended) return;
  if (commit(true)) goNext();
}
function clearResponse() {
  if (S.ended) return;
  const q = curQ();
  const r = S.resp.get(q.id);
  S.draft = null;
  S.caret = 0;
  if (!isEmpty(r.answer)) {
    r.answer = null;
    r.answered_ms = null;
    pushEvent({ type: 'clear', q: q.id });
  }
  r.status = r.status === 'marked' || r.status === 'answered_marked' ? 'marked' : 'not_answered';
  r.dirty = true;
  r.important = true;
  renderAnswer(q);
  renderSide();
  renderTabs();
  backup(true);
  syncSoon(300);
}

// ---------------------------------------------------------------- time, sync, backup
function accumulateTime() {
  const t = performance.now();
  const d = t - S.lastTick;
  S.lastTick = t;
  if (S.ended || !S.cur || d <= 0) return;
  const r = S.resp.get(S.cur);
  r.time_ms += Math.min(d, 90000);
  r.dirty = true;
}

function tick() {
  if (!S.id) return;
  const rem = remaining();
  UI.timer.textContent = clock(rem);
  UI.timerBox.classList.toggle('warn', rem <= 5 * 60 * 1000 && !S.ended);
  if (performance.now() - S.lastTick >= 1000) accumulateTime();
  if (rem <= 0 && !S.submitting && !S.ended && performance.now() >= S.nextAutoTry) autoSubmit();
}

function serialize(qid, r) {
  return { qid, answer: r.answer, status: r.status, time_ms: Math.round(r.time_ms), visits: r.visits, first_seen_ms: r.first_seen_ms, answered_ms: r.answered_ms, changes: r.changes };
}

const hasPending = () => [...S.resp.values()].some((x) => x.important) || S.events.length > 0;

function backup(pending) {
  const responses = {};
  for (const [qid, r] of S.resp) {
    const { dirty, important, ...rest } = r;
    responses[qid] = { ...rest, time_ms: Math.round(r.time_ms) };
  }
  lsSet(backupKey(), { pending, responses, events: S.events.slice(-500), elapsed: elapsed(), savedAt: Date.now() });
}

let syncTimer = null;
function syncSoon(ms) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => doSync(), ms);
}

function setSaveState(s) {
  if (!UI.saveState) return;
  UI.saveState.textContent = { saving: 'Saving…', saved: 'All answers saved', offline: 'Offline · will retry' }[s] || '';
  UI.saveState.style.color = s === 'offline' ? '#b42318' : '';
}

let netBanner = null;
function showNet(on) {
  if (on && !netBanner) {
    netBanner = el('div', { class: 'x-banner err', role: 'alert' }, 'Connection lost. Keep working — your answers are kept on this device and will be sent when you are back online.');
    document.body.append(netBanner);
  } else if (!on && netBanner) {
    netBanner.remove();
    netBanner = null;
  }
}

async function doSync() {
  if (!S.id || S.ended) return null;
  if (S.syncing) {
    S.syncAgain = true;
    return S.syncPromise;
  }
  S.syncing = true;
  accumulateTime();
  const dirty = [...S.resp.entries()].filter(([, r]) => r.dirty);
  const wasImportant = dirty.map(([, r]) => r.important);
  dirty.forEach(([, r]) => { r.dirty = false; r.important = false; });
  const events = S.events.splice(0);
  const payload = { responses: dirty.map(([qid, r]) => serialize(qid, r)), events, current_qid: S.cur, tab_switches: S.tabSwitches };
  setSaveState('saving');
  S.syncPromise = (async () => {
    try {
      const r = await rpc('ceed_sync', { p_token: S.token, p_payload: payload });
      showNet(false);
      setSaveState('saved');
      if (r.submitted) {
        S.ended = true;
        lsDel(backupKey());
        finish();
        return r;
      }
      S.remainingMs = r.remaining_ms;
      S.syncedAt = performance.now();
      backup(hasPending());
      return r;
    } catch (e) {
      dirty.forEach(([, r], i) => { r.dirty = true; r.important = r.important || wasImportant[i]; });
      S.events.unshift(...events);
      if (e.status === 400 && /Attempt not found/.test(e.message)) {
        S.ended = true;
        lsDel(backupKey());
        showError('This attempt was removed by the admin. Please start the test again from the home page.', 'Attempt removed');
        return null;
      }
      if (e.status === 0 || e.status >= 500) showNet(true);
      setSaveState('offline');
      backup(true);
      return null;
    } finally {
      S.syncing = false;
      if (S.syncAgain) {
        S.syncAgain = false;
        setTimeout(() => doSync(), 50);
      }
    }
  })();
  return S.syncPromise;
}

// ---------------------------------------------------------------- submit
async function autoSubmit() {
  S.submitting = true;
  // Ask the server first: it owns the clock (the device may have been asleep).
  const r = await doSync();
  if (S.ended) return;
  if (r && r.remaining_ms > 1500) {
    S.submitting = false;
    return;
  }
  if (!r) {
    S.submitting = false;
    S.nextAutoTry = performance.now() + 5000;
    return;
  }
  submitExam('timeout');
}

let submitOverlay = null;
async function submitExam(reason) {
  if (S.ended && reason !== 'retry') return;
  S.ended = true;
  S.submitting = true;
  accumulateTime();
  S.ended = true;
  submitOverlay = submitOverlay || el('div', { class: 'x-overlay' }, el('div', { class: 'box' },
    el('h2', {}, reason === 'timeout' ? 'Time is up!' : 'Submitting your test'),
    el('p', { id: 'submit-msg' }, 'Saving your answers and calculating your result…'),
    el('div', { style: { margin: '14px 0 4px' } }, el('span', { class: 'spinner' }))));
  document.body.append(submitOverlay);
  const dirty = [...S.resp.entries()].map(([qid, r]) => serialize(qid, r));
  const payload = { responses: dirty, events: S.events.splice(0), current_qid: S.cur, tab_switches: S.tabSwitches, reason };
  for (let i = 0; i < 60; i++) {
    try {
      await rpc('ceed_submit', { p_token: S.token, p_payload: payload });
      lsDel(backupKey());
      return finish();
    } catch (e) {
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 408) {
        $('#submit-msg').textContent = e.message;
        return;
      }
      $('#submit-msg').textContent = 'Cannot reach the server. Retrying… please keep this page open. Your answers are safe on this device.';
      backup(true);
      await new Promise((res) => setTimeout(res, 4000));
    }
  }
}

function finish() {
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (_) { /* ignore */ }
  location.replace(`result.html#t=${S.token}`);
}

function openSubmit() {
  if (S.ended) return;
  accumulateTime();
  const head = ['Section Name', 'No. of Questions', 'Answered', 'Not Answered', 'Marked for Review', 'Answered & Marked for Review (will be considered for evaluation)', 'Not Visited'];
  const tb = el('tbody');
  const tot = { total: 0, answered: 0, not_answered: 0, marked: 0, answered_marked: 0, not_visited: 0 };
  for (const s of S.sections) {
    const c = counts(s.id);
    Object.keys(tot).forEach((k) => (tot[k] += c[k]));
    tb.append(el('tr', {}, el('td', {}, s.name), ...['total', 'answered', 'not_answered', 'marked', 'answered_marked', 'not_visited'].map((k) => el('td', {}, String(c[k])))));
  }
  tb.append(el('tr', {}, el('td', {}, el('b', {}, 'Total')), ...['total', 'answered', 'not_answered', 'marked', 'answered_marked', 'not_visited'].map((k) => el('td', {}, el('b', {}, String(tot[k]))))));
  const body = el('div', {},
    el('div', { class: 'table-wrap' }, el('table', { class: 'summary-table' }, el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))), tb)),
    draftDiffers() ? el('p', { class: 'ins-warn', style: { marginTop: '14px' } }, `Your selection on Question ${curQ().number} is not saved. Go back and click Save & Next if you want it to count.`) : null,
    el('p', { style: { marginTop: '14px', fontWeight: '700' } }, 'Are you sure you want to submit the exam? You cannot change your answers after submitting.'));
  modal({
    title: 'Exam Summary',
    wide: true,
    body,
    actions: [
      { label: 'No, go back' },
      { label: 'Yes, submit', kind: 'primary', onClick: () => { submitExam('manual'); } },
    ],
  });
}

// ---------------------------------------------------------------- views in modals
function openQuestionPaper() {
  const list = el('div', { class: 'qp-list' });
  for (const s of S.sections) {
    list.append(el('div', { class: 'qp-sec' }, s.name));
    for (const q of S.secQs.get(s.id)) {
      list.append(el('div', { class: 'qp-item' },
        el('div', { class: 'n' }, `Question No. ${q.number}`),
        q.text ? el('div', { class: 'x-qtext' }, q.text) : null,
        q.image_url ? imgEl(q.image_url, { loading: 'lazy', alt: `Question ${q.number}` }) : null));
    }
  }
  modal({ title: 'Question Paper', wide: true, body: list, className: 'cbt-modal' });
}

async function openInstructions() {
  const box = el('div', { class: 'ins-body', style: { padding: '0' } });
  box.append(generalInstructions(S.paper.duration_min, S.paper.timer_mode));
  try {
    const info = await rpc('ceed_paper_info', { p_paper: S.paper.id, p_pass: getAdminPass() || null });
    box.append(el('hr', { style: { margin: '20px 0', border: '0', borderTop: '1px solid #e1e5ec' } }), paperInstructions(info));
  } catch (_) { /* general instructions are enough */ }
  modal({ title: 'Instructions', wide: true, body: box });
}

function openZoom(q) {
  if (!q || !q.image_url) return;
  let z = 1;
  const img = imgEl(q.image_url, { alt: `Question ${q.number}`, draggable: 'false' });
  const label = el('span', { class: 'small muted', style: { minWidth: '48px', textAlign: 'center' } });
  const setZ = (v) => {
    z = Math.max(0.5, Math.min(3, Math.round(v * 100) / 100));
    img.style.width = `${z * 100}%`;
    label.textContent = `${Math.round(z * 100)}%`;
  };
  setZ(1);
  const bar = el('div', { class: 'row', style: { marginBottom: '10px' } },
    el('button', { class: 'btn btn-sm', type: 'button', onclick: () => setZ(z - 0.25), 'aria-label': 'Zoom out' }, '−'), label,
    el('button', { class: 'btn btn-sm', type: 'button', onclick: () => setZ(z + 0.25), 'aria-label': 'Zoom in' }, '+'),
    el('button', { class: 'btn btn-sm', type: 'button', onclick: () => setZ(1) }, 'Fit to width'));
  modal({ title: `Question No. ${q.number}`, wide: true, body: el('div', {}, bar, el('div', { class: 'zoom-wrap' }, img)) });
}

// ---------------------------------------------------------------- loops & page events
let fsBanner = null;
function startLoops() {
  S.tickTimer = setInterval(tick, 250);
  S.hbTimer = setInterval(() => doSync(), 15000);
  document.addEventListener('visibilitychange', () => {
    if (S.ended) return;
    if (document.visibilityState === 'hidden') {
      S.tabSwitches += 1;
      pushEvent({ type: 'blur' });
      backup(hasPending());
      doSync();
    } else {
      pushEvent({ type: 'focus' });
      doSync();
    }
  });
  window.addEventListener('online', () => doSync());
  window.addEventListener('beforeunload', (e) => {
    if (S.ended) return;
    e.preventDefault();
    e.returnValue = '';
  });
  window.addEventListener('pagehide', () => {
    if (!S.ended && hasPending()) {
      backup(true);
      sendBeaconSync();
    }
  });
  document.addEventListener('fullscreenchange', () => {
    if (S.ended) return;
    if (!document.fullscreenElement) {
      pushEvent({ type: 'fullscreen_exit' });
      if (!fsBanner) {
        fsBanner = el('div', { class: 'x-banner' }, 'You left full screen.',
          el('button', { class: 'btn btn-sm', type: 'button', onclick: () => requestFs() }, 'Return to full screen'),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', style: { fontSize: '20px', width: '28px', height: '28px' }, onclick: () => { fsBanner.remove(); fsBanner = null; } }, '×'));
        document.body.append(fsBanner);
      }
    } else if (fsBanner) {
      fsBanner.remove();
      fsBanner = null;
    }
  });
}

function sendBeaconSync() {
  try {
    accumulateTime();
    const dirty = [...S.resp.entries()].filter(([, r]) => r.dirty).map(([qid, r]) => serialize(qid, r));
    const payload = { responses: dirty, events: S.events.slice(-200), current_qid: S.cur, tab_switches: S.tabSwitches };
    // Keep local flags: if this last request is lost, the device backup is merged on the next visit.
    rpc('ceed_sync', { p_token: S.token, p_payload: payload }, { keepalive: true }).catch(() => {});
  } catch (_) { /* best effort */ }
}
