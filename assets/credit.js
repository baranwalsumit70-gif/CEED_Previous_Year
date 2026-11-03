/* Creator strip shown at the very top of every page.
   To change a link or a label, edit LINKS and the labels below.
   (The page-not-found page, 404.html, loads this same file.) */
(function () {
  'use strict';
  var LINKS = {
    linkedin: 'https://www.linkedin.com/in/baranwalsumit/',
    whatsapp: 'https://chat.whatsapp.com/KRwNf9wtZzXHsLG4bHB9PU',
    topmate: 'https://topmate.io/sumit_baranwal/'
  };

  var me = document.currentScript;
  if (!me || document.querySelector('.credit-bar')) return;

  var css = [
    '.credit-bar,.credit-bar *{box-sizing:border-box}',
    '.credit-bar{flex:none;position:relative;z-index:40;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 26px;min-height:32px;margin:0;padding:6px 14px;background:#0f3566;color:#c9d8ee;font:500 13px/20px system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;text-align:center;letter-spacing:0;-webkit-font-smoothing:antialiased}',
    '.credit-bar a,.credit-bar a:hover{color:#fff;font-weight:650;text-decoration:none}',
    '.credit-bar a{display:inline-flex;align-items:center;gap:6px;border-radius:4px}',
    '.credit-bar a:hover .cb-txt{text-decoration:underline;text-underline-offset:3px}',
    '.credit-bar a:focus-visible{outline:2px solid #ffd34d;outline-offset:2px}',
    '.cb-item{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}',
    '.cb-ic{width:15px;height:15px;flex:none;color:#ffd34d}',
    '.cb-tag{display:inline-block;padding:0 7px;border-radius:999px;background:rgba(255,255,255,.16);color:#fff;font-size:10.5px;font-weight:700;line-height:16px;letter-spacing:.02em}',
    '.cb-tag.cb-wa{background:#25d366;color:#053d1d}',
    '.cb-short{display:none}',
    /* tablets and phones: "Created by" on the first line, the two links on the second */
    '@media (max-width:860px){.credit-bar{gap:2px 18px}.cb-by{flex-basis:100%;justify-content:center}}',
    '@media (max-width:640px){',
    '.credit-bar{gap:2px 14px;padding:5px 10px;font-size:12px;line-height:18px}',
    '.cb-long{display:none}.cb-short{display:inline}',
    '.cb-ic{width:14px;height:14px}',
    '}',
    '@media (max-width:350px){.cb-ic{display:none}}',
    /* the exam screen: warning banners sit just under the exam header */
    'body .x-banner{top:calc(52px + var(--cb-h,32px))}',
    '@media print{.credit-bar{background:none;color:#333;border-bottom:1px solid #ccc}.credit-bar a{color:#000}.cb-ic{color:#333}.cb-tag,.cb-tag.cb-wa{background:none;color:#333;border:1px solid #aaa}}'
  ].join('');

  var icon = function (paths) {
    return '<svg class="cb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  };
  var USER = '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>';
  var GROUP = '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.5 14.2a6.5 6.5 0 0 1 3 5.8"/>';
  var CAL = '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>';
  var ext = ' target="_blank" rel="noopener"';

  var html =
    '<div class="credit-bar">' +
      '<span class="cb-item cb-by">' + icon(USER) + '<span>Created by</span>' +
        '<a href="' + LINKS.linkedin + '"' + ext + ' title="Sumit Baranwal on LinkedIn"><span class="cb-txt">Sumit Baranwal</span><span class="cb-tag">LinkedIn</span></a>' +
      '</span>' +
      '<a class="cb-item" href="' + LINKS.whatsapp + '"' + ext + ' title="Join the CEED / NID Prep group on WhatsApp">' + icon(GROUP) +
        '<span class="cb-txt"><span class="cb-long">Join the CEED / NID Prep group</span><span class="cb-short">Join CEED / NID Prep</span></span>' +
        '<span class="cb-tag cb-wa">WhatsApp</span>' +
      '</a>' +
      '<a class="cb-item" href="' + LINKS.topmate + '"' + ext + ' title="Sumit Baranwal on Topmate">' + icon(CAL) +
        '<span class="cb-txt">Topmate<span class="cb-long">: sumit_baranwal</span></span>' +
      '</a>' +
    '</div>';

  var style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  me.insertAdjacentHTML('beforebegin', html);

  // Keep --cb-h equal to the strip's height (it wraps onto two lines on phones).
  var bar = me.previousElementSibling;
  if (bar && window.ResizeObserver) {
    new ResizeObserver(function () {
      document.documentElement.style.setProperty('--cb-h', bar.offsetHeight + 'px');
    }).observe(bar);
  }
})();
