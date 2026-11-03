// Shared helpers for every page: database calls (Supabase), saved attempts, UI helpers.
export const CFG = Object.assign({ SITE_NAME: 'CEED Mock Test' }, window.CEED_CONFIG || {});

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Calls one of the public.ceed_* database functions through the Supabase REST API.
export async function rpc(fn, args = {}, { keepalive = false } = {}) {
  const base = String(CFG.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(CFG.SUPABASE_KEY || '');
  if (!base || !key || /YOUR_/.test(base + key)) {
    throw new ApiError(0, 'This website is not connected to its database yet. Fill in assets/config.js.');
  }
  const headers = { 'Content-Type': 'application/json', apikey: key };
  if (/^eyJ/.test(key)) headers.Authorization = `Bearer ${key}`; // legacy anon key (JWT)
  let res;
  try {
    res = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), keepalive, cache: 'no-store' });
  } catch (_) {
    throw new ApiError(0, 'Network error. Check your internet connection and try again.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    const code = data && typeof data === 'object' ? data.code : '';
    let msg = data && typeof data === 'object' && data.message ? data.message : '';
    if (code === 'P0001') { /* our own, already friendly */ }
    else if (res.status === 401 || res.status === 403) msg = 'The website could not connect to the database (API key not accepted). Please tell the admin.';
    else if (code === 'PGRST202' || res.status === 404) msg = 'The database is not set up yet. Please tell the admin.';
    else if (res.status === 409) msg = 'Please try again.';
    else if (res.status >= 500 || !msg) msg = 'The test server is not responding right now. Please try again in a minute.';
    throw new ApiError(res.status, msg, data);
  }
  return data;
}

// ---------- attempts saved on this device ----------
// Every attempt has a secret key (token). Whoever has it can open the attempt, so it is kept on this device.
const TOKENS = 'ceed_tokens';
export function savedAttempts() {
  const a = lsGet(TOKENS);
  return Array.isArray(a) ? a.filter((x) => x && /^[0-9a-f]{64}$/.test(x.token)) : [];
}
export function rememberAttempt(entry) {
  const list = savedAttempts().filter((x) => x.token !== entry.token && x.attempt_id !== entry.attempt_id);
  list.unshift({ ...entry, saved_at: Date.now() });
  lsSet(TOKENS, list.slice(0, 200));
}
export function forgetAttempt(token) {
  lsSet(TOKENS, savedAttempts().filter((x) => x.token !== token));
}
export function tokenForAttempt(attemptId) {
  const x = savedAttempts().find((t) => t.attempt_id === attemptId);
  return x ? x.token : null;
}
export function hashToken() {
  const m = location.hash.match(/(?:^#|&)t=([0-9a-fA-F]{64})(?:&|$)/);
  return m ? m[1].toLowerCase() : null;
}

// ---------- the student's details (prefilled on this device) ----------
export const getStudent = () => lsGet('ceed_student') || {};
export const saveStudent = (s) => lsSet('ceed_student', s);

// ---------- admin passcode ----------
export function getAdminPass() {
  try { return sessionStorage.getItem('ceed_admin') || localStorage.getItem('ceed_admin') || ''; } catch (_) { return ''; }
}
export function setAdminPass(pass, remember) {
  try {
    sessionStorage.setItem('ceed_admin', pass);
    if (remember) localStorage.setItem('ceed_admin', pass);
    else localStorage.removeItem('ceed_admin');
  } catch (_) { /* storage unavailable */ }
}
export function clearAdminPass() {
  try { sessionStorage.removeItem('ceed_admin'); localStorage.removeItem('ceed_admin'); } catch (_) { /* ignore */ }
}

// ---------- question images ----------
// Images are files in this website (questions/...) or, when the admin uploads one, stored in the database ("db:<id>").
const imgCache = new Map();
export function imageSrc(url) {
  if (!url) return Promise.resolve('');
  if (!String(url).startsWith('db:')) return Promise.resolve(url);
  if (!imgCache.has(url)) {
    const p = rpc('ceed_image', { p_id: url.slice(3) }).then((d) => d || '').catch((e) => { imgCache.delete(url); throw e; });
    imgCache.set(url, p);
  }
  return imgCache.get(url);
}
export function setImg(img, url) {
  img.dataset.src = url || '';
  if (!url) { img.removeAttribute('src'); return Promise.resolve(); }
  if (!String(url).startsWith('db:')) { img.src = url; return Promise.resolve(); }
  return imageSrc(url).then((src) => { if (img.dataset.src === url) img.src = src; }).catch(() => {});
}
export function imgEl(url, attrs = {}) {
  const img = el('img', attrs);
  setImg(img, url);
  return img;
}

// ---------- DOM ----------
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function mmss(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function clock(ms) {
  // exam timer style: total minutes : seconds
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export function humanDuration(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function fmtDate(t, withTime = true) {
  if (!t) return '';
  const d = new Date(Number(t));
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString('en-IN', opts);
}
export function num(x) {
  const n = Number(x);
  if (x === null || x === undefined || !Number.isFinite(n)) return '–';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
export function initials(name) {
  const parts = String(name || '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const t = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    t.value = text;
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    t.remove();
    return ok;
  }
}

// ---------- toast ----------
let toastBox;
export function toast(msg, kind = 'info', ms = 3500) {
  if (!toastBox) {
    toastBox = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const t = el('div', { class: `toast toast-${kind}` }, msg);
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// ---------- modal ----------
export function modal({ title, body, actions = [], wide = false, onClose, closable = true, className = '' }) {
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: `modal ${wide ? 'modal-wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && closable) close();
  };
  const head = el('div', { class: 'modal-head' }, el('h2', { text: title || '' }), closable ? el('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close, html: '&times;' }) : null);
  const content = el('div', { class: 'modal-body' });
  if (typeof body === 'string') content.innerHTML = body;
  else if (body) content.append(body);
  const foot = actions.length ? el('div', { class: 'modal-foot' }) : null;
  for (const a of actions) {
    foot.append(el('button', {
      class: `btn ${a.kind ? 'btn-' + a.kind : ''}`,
      onclick: async (ev) => {
        if (a.onClick) {
          const btn = ev.currentTarget;
          btn.disabled = true;
          let r;
          try { r = await a.onClick(ev, close); } finally { btn.disabled = false; }
          if (r === false) return;
        }
        if (!a.keepOpen) close();
      },
    }, a.label));
  }
  box.append(head, content);
  if (foot) box.append(foot);
  back.append(box);
  if (closable) back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  const focusable = box.querySelector('input, select, textarea, .modal-foot .btn');
  if (focusable) setTimeout(() => focusable.focus(), 30);
  return { close, box, content };
}

export function confirmBox(title, message, { ok = 'Yes', cancel = 'No', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title,
      body: el('p', { text: message }),
      actions: [
        { label: cancel, onClick: () => { done = true; resolve(false); } },
        { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

// ---------- header ----------
export function renderHeader({ active = '', admin = false } = {}) {
  const header = $('#app-header');
  if (!header) return;
  header.innerHTML = '';
  const left = el('a', { class: 'brand', href: 'index.html' }, el('span', { class: 'brand-mark', html: logoSvg() }), el('span', { class: 'brand-name', text: CFG.SITE_NAME }));
  const nav = el('nav', { class: 'top-nav' });
  nav.append(el('a', { href: 'index.html#papers', class: active === 'papers' ? 'active' : '' }, 'Tests'));
  nav.append(el('a', { href: 'index.html#my', class: active === 'my' ? 'active' : '' }, 'My results'));
  if (admin) nav.append(el('a', { href: 'admin.html', class: active === 'admin' ? 'active' : '' }, 'Admin'));
  header.append(left, nav);
  if (admin) {
    header.append(el('div', { class: 'user-chip' },
      el('span', { class: 'avatar', text: 'A' }),
      el('span', { class: 'user-name', text: 'Admin' }),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { clearAdminPass(); location.href = 'admin.html'; } }, 'Lock')));
  } else {
    const s = getStudent();
    if (s.name) header.append(el('div', { class: 'user-chip' }, el('span', { class: 'avatar', text: initials(s.name) }), el('span', { class: 'user-name', text: s.name })));
  }
}

export function logoSvg() {
  return '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="7" fill="#1e63b5"/><path d="M9 11h14M9 16h9M9 21h11" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="23" cy="21" r="2.6" fill="#ffd34d"/></svg>';
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
}
export function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* storage unavailable */ }
}
export function lsDel(key) {
  try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
}
