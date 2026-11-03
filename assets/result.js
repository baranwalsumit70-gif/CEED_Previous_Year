import {
  rpc, CFG, el, $, renderHeader, fmtDate, num, modal, humanDuration, toast, copyText, imgEl,
  hashToken, qs, getAdminPass, rememberAttempt, tokenForAttempt,
} from './common.js';
import { timePerQuestion, journey, segmentedBar, hBars, OUTCOME_COLORS, OUTCOME_LABEL, SERIES, fmtSec, fmtClock, hideTip } from './charts.js';

// Student view: result.html#t=<secret key of the attempt>. Admin view: result.html?attempt=<id> (needs the admin passcode).
const TOKEN = hashToken();
const ADMIN_ATTEMPT = TOKEN ? null : qs('attempt');
const IS_ADMIN = Boolean(ADMIN_ATTEMPT);
let R = null;

(async function init() {
  renderHeader({ active: IS_ADMIN ? 'admin' : 'my', admin: IS_ADMIN || Boolean(getAdminPass()) });
  const fail = (msg, link = el('a', { class: 'btn', href: 'index.html#my' }, 'Back to my tests')) => {
    $('#result').innerHTML = '';
    $('#result').append(el('div', { class: 'card empty' }, msg, el('div', { style: { marginTop: '14px' } }, link)));
  };
  if (!TOKEN && !ADMIN_ATTEMPT) return fail('This result link is incomplete. Open your result from "My results" on the home page.');
  if (IS_ADMIN && !getAdminPass()) return fail('Please unlock the admin page first.', el('a', { class: 'btn btn-primary', href: 'admin.html' }, 'Open admin'));
  try {
    R = IS_ADMIN
      ? await rpc('ceed_admin_result', { p_pass: getAdminPass(), p_attempt: ADMIN_ATTEMPT })
      : await rpc('ceed_result', { p_token: TOKEN });
  } catch (e) {
    if (TOKEN && /still in progress/i.test(e.message)) return location.replace(`exam.html#t=${TOKEN}`);
    return fail(e.message);
  }
  if (TOKEN) rememberAttempt({ token: TOKEN, attempt_id: R.attempt.id, paper_id: R.paper.id, title: R.paper.title, attempt_no: R.attempt.attempt_no });
  document.title = `Result · ${R.paper.title} · ${CFG.SITE_NAME}`;
  render();
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(drawCharts, 150);
  });
})();

// ---------------------------------------------------------------- helpers
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const secColor = (i) => SERIES[i % SERIES.length];
const secIndex = (id) => R.sections.findIndex((s) => s.id === id);
const secOf = (id) => R.sections.find((s) => s.id === id) || {};

function qList(nums, max = 8) {
  const list = nums.map((n) => `Q${n}`);
  if (list.length <= 1) return list.join('');
  if (list.length > max) return `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
function qRanges(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `Q${sorted[i]}–Q${sorted[j]}` : `Q${sorted[i]}`);
    i = j;
  }
  return out.join(', ');
}

function clientEval(q, ans) {
  const key = q.correct_answer;
  if (!key || ans === null || ans === undefined || ans === '') return null;
  if (q.qtype === 'NAT') {
    const v = parseFloat(ans);
    return Number.isFinite(v) && v >= Number(key.min) - 1e-9 && v <= Number(key.max ?? key.min) + 1e-9;
  }
  const set = new Set(key.options || []);
  if (q.qtype === 'MCQ') return set.has(ans);
  const sel = Array.isArray(ans) ? ans : [ans];
  return sel.length === set.size && sel.every((x) => set.has(x));
}

function resultBadge(outcome) {
  return el('span', { class: 'res-badge' }, el('i', { style: { background: OUTCOME_COLORS[outcome] } }), OUTCOME_LABEL[outcome] || outcome);
}
function marksText(m) {
  const v = Number(m) || 0;
  if (v > 0) return el('span', { class: 'marks-pos' }, `+${num(v)}`);
  if (v < 0) return el('span', { class: 'marks-neg' }, `−${num(Math.abs(v))}`);
  return el('span', { class: 'muted' }, '0');
}

// ---------------------------------------------------------------- insights
function buildInsights() {
  const qs = R.questions;
  const used = R.attempt.time_used_ms || 1;
  const attempted = qs.filter((q) => ['correct', 'wrong', 'partial'].includes(q.outcome));
  const correct = qs.filter((q) => q.outcome === 'correct');
  const wrong = qs.filter((q) => q.outcome === 'wrong');
  const unatt = qs.filter((q) => q.outcome === 'unattempted');
  const acc = attempted.length ? correct.length / attempted.length : 0;
  const out = [];
  const add = (kind, icon, ...text) => out.push({ kind, icon, text });

  if (R.attempt.submit_reason === 'timeout') {
    add('warn', '⏱', 'Time ran out and the test was submitted automatically', unatt.length ? ` with ${unatt.length} question${unatt.length > 1 ? 's' : ''} unanswered.` : '.');
  }
  add(acc >= 0.7 ? 'good' : acc >= 0.4 ? 'info' : 'bad', '✓', `You attempted ${attempted.length} of ${qs.length} questions with `, el('b', {}, pct(acc)), ' accuracy (', el('b', {}, `${correct.length} correct`), `, ${wrong.length} wrong).`);

  const neg = wrong.filter((q) => q.marks < 0);
  if (neg.length) {
    const lost = neg.reduce((t, q) => t - q.marks, 0);
    add('bad', '−', 'Negative marking cost you ', el('b', {}, `${num(lost)} marks`), ` on ${qList(neg.map((q) => q.number))}. Leaving them blank would have scored ${num(R.attempt.score + lost)}.`);
  }
  const tWrong = wrong.reduce((t, q) => t + q.time_ms, 0);
  if (tWrong > 0) add('warn', '!', 'You spent ', el('b', {}, humanDuration(tWrong)), ` (${pct(tWrong / used)} of your time) on questions you got wrong.`);

  const longest = [...qs].sort((a, b) => b.time_ms - a.time_ms)[0];
  if (longest && longest.time_ms > 0) {
    add(longest.outcome === 'correct' ? 'info' : 'warn', '⌛', `Your longest question was `, el('b', {}, `Q${longest.number}`), ` (${fmtSec(longest.time_ms)}) and it was ${longest.outcome === 'unattempted' ? 'left unanswered' : OUTCOME_LABEL[longest.outcome].toLowerCase()}.`);
  }
  const fastWrong = wrong.filter((q) => q.time_ms > 0 && q.time_ms < 20000);
  if (fastWrong.length) add('warn', '⚡', `${qList(fastWrong.map((q) => q.number))} ${fastWrong.length > 1 ? 'were' : 'was'} answered in under 20 seconds and turned out wrong. Slow down on questions like these.`);

  // answer changes (needs the answer key)
  if (R.paper.show_answers) {
    const byQ = new Map();
    for (const e of R.events || []) {
      if ((e.type === 'save' || e.type === 'mark') && e.q && e.a !== null && e.a !== undefined) {
        if (!byQ.has(e.q)) byQ.set(e.q, []);
        byQ.get(e.q).push(e.a);
      }
    }
    let helped = 0;
    let hurt = 0;
    let changedQs = 0;
    for (const q of qs) {
      const arr = (byQ.get(q.id) || []).filter((a, i, all) => i === 0 || JSON.stringify(a) !== JSON.stringify(all[i - 1]));
      if (arr.length < 2 || q.your_answer === null) continue;
      changedQs++;
      const first = clientEval(q, arr[0]);
      const last = clientEval(q, q.your_answer);
      if (first === false && last === true) helped++;
      if (first === true && last === false) hurt++;
    }
    if (changedQs) add(hurt > helped ? 'bad' : helped > hurt ? 'good' : 'info', '↺', `You changed your answer on ${changedQs} question${changedQs > 1 ? 's' : ''}: `, el('b', {}, `${helped} changed wrong → right`), `, ${hurt} changed right → wrong.`);
  }

  const notVisited = qs.filter((q) => q.status_at_submit === 'not_visited');
  if (notVisited.length) add('warn', '○', `You never opened ${notVisited.length} question${notVisited.length > 1 ? 's' : ''} (${qRanges(notVisited.map((q) => q.number))}). Try to read every question at least once.`);
  const markedOnly = qs.filter((q) => q.status_at_submit === 'marked');
  if (markedOnly.length) add('warn', '◔', `${qList(markedOnly.map((q) => q.number))} ${markedOnly.length > 1 ? 'were' : 'was'} marked for review but never answered, so ${markedOnly.length > 1 ? 'they' : 'it'} scored 0.`);

  // section balance
  const S = R.summary && R.summary.sections ? R.summary.sections : {};
  const totalMax = R.sections.reduce((t, s) => t + ((S[s.id] && S[s.id].max) || 0), 0) || 1;
  let worstGap = null;
  for (const s of R.sections) {
    const st = S[s.id];
    if (!st) continue;
    const timeShare = st.time_ms / used;
    const markShare = st.max / totalMax;
    const gap = timeShare - markShare;
    if (!worstGap || Math.abs(gap) > Math.abs(worstGap.gap)) worstGap = { s, gap, timeShare, markShare };
  }
  if (worstGap && Math.abs(worstGap.gap) >= 0.15) {
    add('info', '◑', `You spent ${pct(worstGap.timeShare)} of your time on `, el('b', {}, worstGap.s.name), ` which carries ${pct(worstGap.markShare)} of the marks.`);
  }
  const ranked = R.sections.map((s) => ({ s, st: S[s.id] })).filter((x) => x.st && x.st.attempted >= 2)
    .map((x) => ({ ...x, acc: x.st.correct / x.st.attempted })).sort((a, b) => b.acc - a.acc);
  if (ranked.length >= 2 && ranked[0].acc > ranked[ranked.length - 1].acc) {
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    add('good', '★', 'Your strongest section was ', el('b', {}, best.s.name), ` (${pct(best.acc)} accuracy); the weakest was `, el('b', {}, worst.s.name), ` (${pct(worst.acc)}).`);
  }
  const missedEasy = qs.filter((q) => q.outcome !== 'correct' && q.others && q.others.n >= 3 && q.others.correct_pct >= 60);
  if (missedEasy.length) add('warn', '↗', `Most students got ${qList(missedEasy.map((q) => q.number))} right, but you didn't. Revise these first.`);
  if (R.attempt.tab_switches > 0) add('info', '⧉', `You left the test window ${R.attempt.tab_switches} time${R.attempt.tab_switches > 1 ? 's' : ''} during the test.`);
  if (R.attempt.submit_reason !== 'timeout' && used < R.attempt.duration_ms * 0.8) {
    add('info', '⏲', `You submitted with ${humanDuration(R.attempt.duration_ms - used)} to spare. Use spare time to recheck marked and doubtful questions.`);
  }
  return out;
}

// ---------------------------------------------------------------- render
function render() {
  const root = $('#result');
  root.innerHTML = '';
  const a = R.attempt;
  const qs = R.questions;
  const sum = R.summary || {};
  const attempted = qs.filter((q) => ['correct', 'wrong', 'partial'].includes(q.outcome)).length;
  const correct = qs.filter((q) => q.outcome === 'correct').length;
  const wrong = qs.filter((q) => q.outcome === 'wrong').length;
  const partial = qs.filter((q) => q.outcome === 'partial').length;
  const bonus = qs.filter((q) => q.outcome === 'bonus').length;
  const unatt = qs.filter((q) => q.outcome === 'unattempted').length;
  const posMarks = qs.reduce((t, q) => t + Math.max(0, q.marks), 0);
  const negMarks = qs.reduce((t, q) => t + Math.min(0, q.marks), 0);

  if (IS_ADMIN) {
    root.append(el('div', { class: 'admin-note' }, `Admin view: this is ${R.candidate.name || 'a student'}'s attempt.`));
  }
  // header
  const actions = el('div', { class: 'actions' },
    el('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print / save PDF'));
  if (!IS_ADMIN) {
    actions.append(el('button', { class: 'btn', type: 'button', title: 'Save this link to open your result on any device', onclick: async () => {
      const ok = await copyText(location.href);
      toast(ok ? 'Result link copied. Keep it to open this analysis on any device.' : 'Copy failed. Copy the address from the address bar.', ok ? 'ok' : 'bad', 5000);
    } }, 'Copy result link'));
  }
  if (!IS_ADMIN && R.paper.allow_reattempt && R.paper.published) actions.append(el('a', { class: 'btn', href: `exam.html?paper=${R.paper.id}` }, 'Reattempt'));
  actions.append(el('a', { class: 'btn btn-primary', href: IS_ADMIN ? 'admin.html#attempts' : 'index.html#my' }, IS_ADMIN ? 'Back to admin' : 'My tests'));
  root.append(el('div', { class: 'res-head' },
    el('div', {},
      el('h1', {}, `${R.paper.title} · Analysis`),
      el('div', { class: 'meta' },
        el('span', { class: 'badge' }, R.candidate.name || ''),
        el('span', { class: 'badge' }, `Attempt ${a.attempt_no}`),
        el('span', { class: 'badge' }, `Submitted ${fmtDate(a.submitted_at)}`),
        a.submit_reason === 'timeout' ? el('span', { class: 'badge badge-warn' }, 'Auto-submitted (time up)') : null,
        a.submit_reason === 'admin' ? el('span', { class: 'badge badge-warn' }, 'Submitted by admin') : null)),
    actions));

  // hero
  const c = R.comparison || {};
  const rankLine = c.students >= 2
    ? el('div', { class: 'rank' }, 'Rank ', el('b', {}, `${c.rank} of ${c.students}`), c.percentile !== null ? ` · better than ${Math.round(c.percentile)}% of students` : '', el('br'), `Topper ${num(c.topper)} · Average ${num(c.average)}`, a.attempt_no > 1 ? el('div', { class: 'small muted' }, 'Rank compares this attempt with every student\'s first attempt.') : null)
    : el('div', { class: 'rank' }, 'You are the first to finish this paper. Your rank appears here as more students attempt it.');
  const tiles = el('div', { class: 'tiles' },
    tile('Correct', String(correct), `+${num(posMarks)} marks`, OUTCOME_COLORS.correct),
    tile('Wrong', String(wrong), negMarks ? `−${num(Math.abs(negMarks))} marks` : 'no negative marks', OUTCOME_COLORS.wrong),
    tile('Unattempted', String(unatt), `of ${qs.length} questions`, OUTCOME_COLORS.unattempted),
    tile('Accuracy', attempted ? pct(correct / attempted) : '–', `${attempted} attempted`),
    tile('Time used', fmtClock(a.time_used_ms), `of ${fmtClock(a.duration_ms)} minutes`),
    tile('Avg. per attempted', attempted ? fmtSec(qs.filter((q) => ['correct', 'wrong', 'partial'].includes(q.outcome)).reduce((t, q) => t + q.time_ms, 0) / attempted) : '–', 'time per answered question'));
  const outcomeBar = el('div');
  root.append(el('section', { class: 'card hero' },
    el('div', { class: 'hero-score' },
      el('div', { class: 'lbl' }, 'Your score'),
      el('div', { class: 'big' }, num(a.score), el('small', {}, ` / ${num(a.max_score)}`)),
      rankLine),
    el('div', { class: 'hero-right' }, tiles, outcomeBar)));
  segmentedBar(outcomeBar, [
    { label: 'Correct', value: correct, color: OUTCOME_COLORS.correct, display: String(correct) },
    { label: 'Partially correct', value: partial, color: OUTCOME_COLORS.partial, dark: true, display: String(partial) },
    { label: 'Wrong', value: wrong, color: OUTCOME_COLORS.wrong, display: String(wrong) },
    { label: 'Unattempted', value: unatt, color: OUTCOME_COLORS.unattempted, display: String(unatt) },
    { label: 'Marks to all', value: bonus, color: OUTCOME_COLORS.bonus, display: String(bonus) },
  ].filter((p) => p.value > 0 || ['Correct', 'Wrong', 'Unattempted'].includes(p.label)), { unit: ' questions' });

  // insights
  const ins = buildInsights();
  root.append(el('section', { class: 'card res-section' },
    el('div', { class: 'card-head' }, el('div', {}, el('h2', {}, 'Key insights'), el('p', { class: 'sub' }, 'What this attempt says about your preparation'))),
    el('ul', { class: 'insights' }, ...ins.map((i) => el('li', {}, el('span', { class: `ic ic-${i.kind}`, 'aria-hidden': 'true' }, i.icon), el('span', {}, ...i.text))))));

  // sections
  const S = sum.sections || {};
  const tb = el('tbody');
  R.sections.forEach((s, i) => {
    const st = S[s.id] || { total: 0, attempted: 0, correct: 0, wrong: 0, partial: 0, unattempted: 0, score: 0, max: 0, time_ms: 0 };
    tb.append(el('tr', {},
      el('td', {}, el('span', { class: 'sec-name' }, el('i', { style: { background: secColor(i) } }), s.name)),
      el('td', { class: 'num' }, String(st.total)),
      el('td', { class: 'num' }, String(st.attempted)),
      el('td', { class: 'num' }, String(st.correct)),
      el('td', { class: 'num' }, String(st.wrong)),
      el('td', { class: 'num' }, String(st.unattempted)),
      el('td', { class: 'num' }, st.attempted ? pct(st.correct / st.attempted) : '–'),
      el('td', { class: 'num' }, fmtSec(st.time_ms)),
      el('td', { class: 'num' }, st.total ? fmtSec(st.time_ms / st.total) : '–'),
      el('td', { class: 'num' }, el('div', { class: 'score-cell' },
        el('div', { class: 'meter', title: `${num(st.score)} of ${num(st.max)}` }, el('span', { style: { width: `${st.max ? Math.max(0, (st.score / st.max) * 100) : 0}%` } })),
        el('b', {}, `${num(st.score)} / ${num(st.max)}`)))));
  });
  const timeSplit = el('div', { style: { padding: '4px 20px 18px' } });
  root.append(el('section', { class: 'card res-section' },
    el('div', { class: 'card-head' }, el('div', {}, el('h2', {}, 'Section-wise performance'), el('p', { class: 'sub' }, 'Score, accuracy and time in each section'))),
    el('div', { class: 'table-wrap' }, el('table', { class: 'table compact' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Section'), el('th', { class: 'num' }, 'Questions'), el('th', { class: 'num' }, 'Attempted'), el('th', { class: 'num' }, 'Correct'),
        el('th', { class: 'num' }, 'Wrong'), el('th', { class: 'num' }, 'Unattempted'), el('th', { class: 'num' }, 'Accuracy'), el('th', { class: 'num' }, 'Time spent'),
        el('th', { class: 'num' }, 'Avg / question'), el('th', { class: 'num' }, 'Score'))),
      tb)),
    el('div', { style: { padding: '14px 20px 0' } }, el('h3', { style: { fontSize: '14px', marginBottom: '8px' } }, 'How you split your time')),
    timeSplit));
  segmentedBar(timeSplit, R.sections.map((s, i) => ({
    label: s.name, value: (S[s.id] && S[s.id].time_ms) || 0, color: secColor(i), display: fmtSec((S[s.id] && S[s.id].time_ms) || 0), dark: i === 3,
  })));

  // time per question
  R._timeBox = el('div', { class: 'chart-box' });
  const hasOthers = qs.some((q) => q.others && q.others.n);
  root.append(el('section', { class: 'card res-section' },
    el('div', { class: 'card-head' }, el('div', {}, el('h2', {}, 'Time spent on each question'), el('p', { class: 'sub' }, 'Bar height is your time; colour is the result. Hover a bar for details.'))),
    R._timeBox,
    el('div', { class: 'chart-legend legend' },
      ...['correct', 'partial', 'wrong', 'unattempted'].filter((k) => k !== 'partial' || partial).map((k) => el('span', { class: 'legend-item' }, el('i', { style: { background: OUTCOME_COLORS[k] } }), OUTCOME_LABEL[k])),
      hasOthers ? el('span', { class: 'legend-item' }, el('span', { class: 'legend-line' }), "Other students' average time") : null)));

  // journey
  R._journeyBox = el('div', { class: 'chart-box' });
  root.append(el('section', { class: 'card res-section' },
    el('div', { class: 'card-head' }, el('div', {}, el('h2', {}, 'Your exam timeline'), el('p', { class: 'sub' }, 'Which question was on your screen at what time. Bars show when a question was open; dots show when you saved an answer.'))),
    R._journeyBox,
    el('div', { class: 'chart-legend legend' },
      ...['correct', 'partial', 'wrong', 'unattempted'].filter((k) => k !== 'partial' || partial).map((k) => el('span', { class: 'legend-item' }, el('i', { style: { background: OUTCOME_COLORS[k] } }), OUTCOME_LABEL[k])),
      el('span', { class: 'legend-item' }, el('i', { style: { background: '#555', borderRadius: '50%' } }), 'Final answer saved'),
      el('span', { class: 'legend-item' }, el('i', { style: { background: '#fff', border: '2px solid #555', borderRadius: '50%', width: '8px', height: '8px' } }), 'Answer changed later'),
      a.tab_switches ? el('span', { class: 'legend-item' }, el('i', { style: { background: '#8a6d00', clipPath: 'polygon(0 0,100% 0,50% 100%)' } }), 'Left the test window') : null)));

  // topics
  const topics = new Map();
  for (const q of qs) {
    if (!q.topic) continue;
    const t = topics.get(q.topic) || { total: 0, attempted: 0, correct: 0 };
    t.total++;
    if (['correct', 'wrong', 'partial'].includes(q.outcome)) t.attempted++;
    if (q.outcome === 'correct') t.correct++;
    topics.set(q.topic, t);
  }
  if (topics.size >= 2) {
    const tbox = el('div', { style: { padding: '8px 20px 16px' } });
    root.append(el('section', { class: 'card res-section' },
      el('div', { class: 'card-head' }, el('div', {}, el('h2', {}, 'Topic-wise accuracy'), el('p', { class: 'sub' }, 'Share of questions in each topic that you got right'))),
      tbox));
    hBars(tbox, [...topics.entries()].map(([k, t]) => ({ label: k, value: (t.correct / t.total) * 100, sub: `${t.correct} of ${t.total} right` })).sort((x, y) => y.value - x.value));
  }

  // question table
  root.append(questionTable());

  // history
  if (R.history && R.history.length > 1) {
    root.append(el('section', { class: 'card res-section' },
      el('div', { class: 'card-head' }, el('h2', {}, 'Your attempts at this paper')),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Attempt'), el('th', {}, 'Date'), el('th', { class: 'num' }, 'Score'), el('th', { class: 'num' }, 'Time used'), el('th', {}, ''))),
        el('tbody', {}, ...R.history.map((h) => el('tr', {},
          el('td', {}, `Attempt ${h.attempt_no}`, h.id === a.id ? el('span', { class: 'badge badge-blue', style: { marginLeft: '8px' } }, 'This one') : null),
          el('td', {}, fmtDate(h.submitted_at)),
          el('td', { class: 'num' }, `${num(h.score)} / ${num(h.max_score)}`),
          el('td', { class: 'num' }, fmtClock(h.time_used_ms)),
          el('td', { class: 'num' }, h.id === a.id ? '' : historyLink(h.id)))))))));
  }
  if (R.paper.answer_key_note) root.append(el('p', { class: 'key-note' }, `About the answer key: ${R.paper.answer_key_note}`));
  drawCharts();
}

function historyLink(id) {
  if (IS_ADMIN) return el('a', { href: `result.html?attempt=${id}` }, 'Open →');
  const tok = tokenForAttempt(id);
  return tok ? el('a', { href: `result.html#t=${tok}` }, 'Open →') : el('span', { class: 'muted small', title: 'This attempt was taken on another device' }, 'Other device');
}

function tile(label, value, sub, color) {
  return el('div', { class: 'tile' },
    el('div', { class: 't-l' }, color ? el('i', { style: { background: color } }) : null, label),
    el('div', { class: 't-v' }, value),
    el('div', { class: 't-s' }, sub));
}

function drawCharts() {
  if (!R) return;
  hideTip();
  if (R._timeBox) timePerQuestion(R._timeBox, R.questions, R.sections);
  if (R._journeyBox) journey(R._journeyBox, R.questions, R.sections, R.events, R.attempt.duration_ms, R.attempt.time_used_ms);
}

// ---------------------------------------------------------------- question table + review
function questionTable() {
  const qs = R.questions;
  const filters = [
    ['all', 'All', () => true],
    ['correct', 'Correct', (q) => q.outcome === 'correct'],
    ['wrong', 'Wrong', (q) => q.outcome === 'wrong'],
    ['partial', 'Partial', (q) => q.outcome === 'partial'],
    ['unattempted', 'Unattempted', (q) => q.outcome === 'unattempted'],
    ['marked', 'Marked for review', (q) => q.status_at_submit === 'marked' || q.status_at_submit === 'answered_marked'],
  ].filter(([k, , f]) => k === 'all' || qs.some(f));
  let active = 'all';
  const tbody = el('tbody');
  const chips = el('div', { class: 'filters', role: 'group', 'aria-label': 'Filter questions' });
  const showKeys = R.paper.show_answers;
  const draw = () => {
    chips.innerHTML = '';
    for (const [k, label, f] of filters) {
      chips.append(el('button', { class: `chip ${k === active ? 'on' : ''}`, type: 'button', 'aria-pressed': String(k === active), onclick: () => { active = k; draw(); } },
        OUTCOME_COLORS[k] ? el('i', { style: { background: OUTCOME_COLORS[k] } }) : null, `${label} (${qs.filter(f).length})`));
    }
    tbody.innerHTML = '';
    const f = filters.find((x) => x[0] === active)[2];
    const list = qs.filter(f);
    for (const q of list) {
      const sec = secOf(q.section_id);
      tbody.append(el('tr', { class: 'clickable', tabindex: 0, onclick: () => openReview(q.id, list), onkeydown: (e) => { if (e.key === 'Enter') openReview(q.id, list); } },
        el('td', {}, el('b', {}, `Q${q.number}`)),
        el('td', {}, el('span', { class: 'sec-name', style: { fontWeight: '500' } }, el('i', { style: { background: secColor(secIndex(q.section_id)) } }), sec.short_name || sec.name)),
        el('td', { class: 'ans' }, q.your_answer_text || el('span', { class: 'muted' }, '—')),
        showKeys ? el('td', { class: 'ans' }, q.correct_answer_text || '—') : null,
        el('td', {}, resultBadge(q.outcome)),
        el('td', { class: 'num' }, marksText(q.marks)),
        el('td', { class: 'num' }, q.time_ms ? fmtSec(q.time_ms) : '—'),
        el('td', { class: 'num' }, String(q.visits)),
        el('td', { class: 'num' }, q.first_seen_ms !== null && q.first_seen_ms !== undefined ? fmtClock(q.first_seen_ms) : '—'),
        el('td', { class: 'num' }, q.answered_ms !== null && q.answered_ms !== undefined && q.your_answer !== null ? fmtClock(q.answered_ms) : '—'),
        el('td', { class: 'num' }, q.others ? `${Math.round(q.others.correct_pct)}%` : '—')));
    }
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: 11, class: 'empty' }, 'No questions here.')));
  };
  draw();
  return el('section', { class: 'card res-section' },
    el('div', { class: 'card-head', style: { flexWrap: 'wrap' } },
      el('div', {}, el('h2', {}, 'Question-wise analysis'), el('p', { class: 'sub' }, 'Times are minutes:seconds from the start of the exam. Click a row to review the question.')),
      chips),
    el('div', { class: 'table-wrap' }, el('table', { class: 'table compact' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Q'), el('th', {}, 'Section'), el('th', {}, 'Your answer'), showKeys ? el('th', {}, 'Correct answer') : null,
        el('th', {}, 'Result'), el('th', { class: 'num' }, 'Marks'), el('th', { class: 'num' }, 'Time spent'), el('th', { class: 'num' }, 'Visits'),
        el('th', { class: 'num' }, 'First opened'), el('th', { class: 'num' }, 'Answered at'), el('th', { class: 'num', title: 'Share of other students who got it right' }, 'Others ✓'))),
      tbody)));
}

function openReview(qid, list) {
  let idx = list.findIndex((q) => q.id === qid);
  const body = el('div');
  const m = modal({ title: '', wide: true, body });
  const titleEl = m.box.querySelector('.modal-head h2');
  const render = () => {
    const q = list[idx];
    const sec = secOf(q.section_id);
    titleEl.textContent = `Question ${q.number} · ${sec.name || ''}`;
    body.innerHTML = '';
    const fact = (k, v, full) => el('div', { class: `fact ${full ? 'full' : ''}` }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v));
    body.append(el('div', { class: 'review-grid' },
      el('div', {}, q.text ? el('p', { style: { whiteSpace: 'pre-wrap' } }, q.text) : null, q.image_url ? imgEl(q.image_url, { alt: `Question ${q.number}` }) : null),
      el('div', {},
        el('div', { class: 'review-facts' },
          fact('Result', resultBadge(q.outcome), true),
          fact('Your answer', q.your_answer_text || '—'),
          R.paper.show_answers ? fact('Correct answer', q.correct_answer_text || '—') : fact('Marks', marksText(q.marks)),
          R.paper.show_answers ? fact('Marks', marksText(q.marks)) : null,
          fact('Time spent', q.time_ms ? fmtSec(q.time_ms) : '—'),
          fact('Opened', `${q.visits} time${q.visits === 1 ? '' : 's'}`),
          fact('Answer changed', `${q.changes} time${q.changes === 1 ? '' : 's'}`),
          fact('First opened at', q.first_seen_ms !== null && q.first_seen_ms !== undefined ? fmtClock(q.first_seen_ms) : '—'),
          fact('Answered at', q.answered_ms !== null && q.answered_ms !== undefined && q.your_answer !== null ? fmtClock(q.answered_ms) : '—'),
          q.others ? fact('Other students', `${Math.round(q.others.correct_pct)}% correct · avg ${fmtSec(q.others.avg_time_ms)}`, true) : null,
          q.topic ? fact('Topic', q.topic, true) : null),
        q.solution ? el('div', { class: 'solution' }, el('b', {}, 'Explanation: '), q.solution) : null,
        el('div', { class: 'row', style: { marginTop: '14px' } },
          el('button', { class: 'btn btn-sm', type: 'button', disabled: idx === 0, onclick: () => { idx--; render(); } }, '‹ Previous'),
          el('span', { class: 'muted small' }, `${idx + 1} of ${list.length}`),
          el('button', { class: 'btn btn-sm', type: 'button', disabled: idx === list.length - 1, onclick: () => { idx++; render(); } }, 'Next ›')))));
  };
  render();
}
