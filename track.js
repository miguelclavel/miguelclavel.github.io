// Visitor tracking, shared by Miguel's portfolio sites. The same file runs on:
//   chat.miguelclavel.com (repo miguelclavel-4): tools/build.mjs inlines it
//     into each page's <head>, right after window.MC_SITE;
//   miguelclavel.com (repo miguelclavel-1): loaded as /assets/track.js with
//     data-site and data-version attributes (deploy.sh stamps the version);
//   miguelclavel.github.io (the public repo of that name): /track.js, loaded
//     by each demo page with data-site and data-endpoint (pages-log/ in
//     miguelclavel-4 receives the rows).
// Keep the three copies identical. Each site logs to its own database, so
// their numbers never mix.
//
// It records:
//   - the start of each visit: the referring site's name, campaign tags,
//     window size, language, theme, touch or mouse, and the page version;
//   - every click on a link or button, with its label, destination, the
//     section it is in, and where on the page it was, plus repeated clicks on
//     something that did not respond;
//   - each main section heading the visitor actually had on screen;
//   - copying (what kind and where, never the text), and which form fields
//     they started (never what they typed);
//   - errors in the site's own scripts;
//   - a summary when the page is hidden or closed: seconds open and visible,
//     scroll depth, sections read, questions, clicks, and the last action.
// Never recorded: anything typed and not sent, copied text, IP addresses, or
// anything that identifies a person.
// The chat adds what only it knows (each question and the answer it matched)
// through window.mcTrack.log.
//
// Nothing is sent from Claude Design (window.claude) or a file:// page, for a
// visitor who declined the cookie banner, for a visitor in Europe who has not
// accepted it, from Miguel's own browsers (open any page with ?mc-me=on;
// ?mc-me=off undoes it), or from a browser run by automation
// (navigator.webdriver: screenshot tools, test runners, many bots).
(function () {
  'use strict';
  var me = document.currentScript && document.currentScript.dataset || {};
  // Where the rows go: this site's own /api/log, or another address named by
  // data-endpoint (the demo pages on miguelclavel.github.io log to their own
  // small Worker). '' turns the log off (update the privacy copy too).
  var LOG_ENDPOINT = me.endpoint || '/api/log';
  var CROSS_SITE = /^https?:\/\//.test(LOG_ENDPOINT) && LOG_ENDPOINT.indexOf(location.origin + '/') !== 0;
  var site = window.MC_SITE || {
    site: me.site || location.hostname,
    version: me.version || '',
    page_kind: me.kind || (location.pathname === '/' ? 'home' : /^\/more-work/.test(location.pathname) ? 'more-work' : /^\/work\//.test(location.pathname) ? 'case-study' : 'page'),
    analytics: false
  };

  function store(key, value) {
    try { if (value === undefined) return localStorage.getItem(key); if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) {}
    return null;
  }
  // Miguel's own browsers: ?mc-me=on marks this browser, ?mc-me=off clears it.
  try {
    var flag = new URL(location.href).searchParams.get('mc-me');
    if (flag === 'on' || flag === 'off') {
      var changed = (flag === 'on') !== (store('mc-me') === '1');
      store('mc-me', flag === 'on' ? '1' : null);
      var clean = new URL(location.href); clean.searchParams.delete('mc-me');
      history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
      // A short note, only when the setting changes (report links always carry ?mc-me=on).
      if (changed) addEventListener('DOMContentLoaded', function () {
        var n = document.createElement('div');
        n.setAttribute('role', 'status');
        n.textContent = flag === 'on' ? 'This browser is marked as Miguel: your visits are not tracked.' : 'This browser is tracked like any visitor again.';
        n.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;border-radius:10px;background:#1F1F24;color:#fff;font:14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)';
        document.body.appendChild(n);
        setTimeout(function () { n.remove(); }, 4000);
      });
    }
  } catch (e) {}
  var isMiguel = store('mc-me') === '1';
  // The cookie banner's choice (assets/consent/consent.js). Europe is opt in,
  // the same rule the banner uses: no choice yet means no tracking there.
  var choice = store('mc-consent-choice');
  var inEurope = false;
  try { inEurope = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').indexOf('Europe/') === 0; } catch (e) {}
  var consented = choice === 'granted' || (choice !== 'denied' && !inEurope);
  if (isMiguel || !consented) site.analytics = false;

  var logging = !!LOG_ENDPOINT && !window.claude && !navigator.webdriver && /^https?:$/.test(location.protocol) && !isMiguel && consented;
  var visit = (function () { try { return crypto.randomUUID(); } catch (e) { return String(Math.random()).slice(2); } })();
  var t0 = Date.now(), scroll = 0, questions = 0, clicks = 0, last = 'open';
  var clean = function (s, n) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n); };

  // Where a link goes, in words the report and analytics can group by.
  function target(href) {
    var h = String(href || '');
    if (/^mailto:/i.test(h)) {
      var subject = (h.match(/[?&]subject=([^&]*)/) || [])[1];
      var s = ''; try { s = subject ? decodeURIComponent(subject) : ''; } catch (e) { s = subject || ''; }
      return 'email' + (s ? ':' + s.slice(0, 40) : '');
    }
    if (/^tel:/i.test(h)) return 'phone';
    if (/^#/.test(h)) return 'anchor:' + h.slice(0, 60);
    var u; try { u = new URL(h, location.href); } catch (e) { return 'link:' + h.slice(0, 60); }
    if (/(^|\.)linkedin\.com$/i.test(u.hostname)) return 'linkedin';
    if (/(^|\.)behance\.net$/i.test(u.hostname)) return 'behance';
    if (/\.pdf$/i.test(u.pathname)) return /resume|cv/i.test(u.pathname) ? 'resume' : 'pdf:' + u.pathname.slice(0, 60);
    if (u.origin === location.origin) return u.pathname === location.pathname && u.hash ? 'anchor:' + u.hash.slice(0, 60) : u.pathname.slice(0, 80);
    return 'external:' + (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '').slice(0, 80);
  }

  // What was clicked: the nearest link or button, by its visible label. The
  // chat's "This chat" list shows the visitor's own questions, so those
  // buttons (data-log-turn) log a fixed name instead of their text.
  function describe(el) {
    if (!el || !el.closest) return null;
    var node = el.closest('a[href], button, [role="button"], [role="link"], summary, input[type="submit"], input[type="button"]');
    if (!node || node.closest('x-dc, [data-log-skip]')) return null;
    var label = node.hasAttribute('data-log-turn') ? 'earlier question'
      : clean(node.getAttribute('data-log-label') || node.getAttribute('aria-label') || node.textContent || node.value || node.getAttribute('title') ||
        ((node.querySelector && node.querySelector('img[alt]')) || {}).alt, 60);
    if (node.matches('a[href]')) return { kind: 'click', text: target(node.getAttribute('href')), label: label };
    return { kind: 'action', text: 'button:' + (label || 'no label'), label: label };
  }

  // Where on the page something happened, so the report can point at it:
  // the main section it sits in (the nearest h1 or h2 above it), and the
  // position as a share of the window width and pixels from the top of the
  // page, with the page height and window width to place it on a screenshot.
  // A heading whose words change (a greeting by time of day) names itself
  // with data-log-label, so every visit counts it as the same section.
  function headingName(h) { return h.getAttribute('data-log-label') || h.textContent; }
  function sectionOf(node) {
    if (!node) return '';
    var list = document.querySelectorAll('h1, h2'), found = '';
    for (var i = 0; i < list.length; i++) {
      if (list[i].closest('x-dc, [data-clarity-mask], [data-log-skip]')) continue;
      if (list[i] === node || list[i].compareDocumentPosition(node) & 4) found = headingName(list[i]); else break;
    }
    return clean(found, 50);
  }
  function where(node, clientX, clientY) {
    var at = {};
    try {
      if ((clientX == null || clientY == null) && node && node.getBoundingClientRect) {
        var r = node.getBoundingClientRect();
        clientX = r.left + r.width / 2; clientY = r.top + r.height / 2;
      }
      // Headers and bars that stay on screen (fixed or sticky) are placed by
      // their spot in the window, not on the page, or every click on them
      // would land wherever the visitor had scrolled to.
      var fixed = false;
      for (var n = node, i = 0; n && n.nodeType === 1 && i < 8 && !fixed; n = n.parentElement, i++) {
        var pos = getComputedStyle(n).position;
        fixed = pos === 'fixed' || (pos === 'sticky' && scrollY > 0);
      }
      if (clientX != null) at.x = Math.round(clientX / innerWidth * 1000) / 10;
      if (clientY != null) at.y = Math.round(clientY + (fixed ? 0 : scrollY));
      if (fixed) at.fx = 1;
      at.h = document.documentElement.scrollHeight;
      at.w = innerWidth;
      var s = sectionOf(node);
      if (s) at.sec = s;
    } catch (e) {}
    return at;
  }

  // Named events for this site's own analytics. Only what happened: the
  // answer a question matched, which link or button. Never what was typed.
  var LINK_EVENTS = { email: 'contact_click', linkedin: 'linkedin_click', behance: 'behance_click', resume: 'resume_click', phone: 'phone_click' };
  function analyticsEvent(kind, text, extra) {
    if (!site.analytics) return;
    var name = '', params = {};
    if (kind === 'question') {
      var answer = String(extra.answer || '');
      name = answer === 'jd' ? 'job_post_pasted' : answer === 'fallback' ? 'chat_unanswered' : 'chat_question';
      params = { answer_id: answer.slice(0, 80), via: (extra.detail && extra.detail.via) || '', answer_mode: extra.mode || '' };
    } else if (kind === 'click') {
      var key = text.split(':')[0];
      name = LINK_EVENTS[key] || (key === 'preview' ? 'case_study_preview' : key === 'external' ? 'outbound_click' : key === 'anchor' ? 'anchor_click'
        : text.indexOf('/work/') === 0 ? 'case_study_click' : text.charAt(0) === '/' ? 'nav_click' : 'link_click');
      params = { link_target: text.slice(0, 80), link_label: String(extra.label || '').slice(0, 60) };
    } else if (kind === 'action' && text.indexOf('button:') === 0) {
      name = 'cta_click';
      params = { link_label: text.slice(7, 67) };
    }
    if (!name) return;
    try {
      if (typeof window.gtag === 'function') window.gtag('event', name, params);
      if (typeof window.clarity === 'function') {
        window.clarity('event', name);
        if (name === 'chat_unanswered') window.clarity('set', 'chat_unanswered', 'yes');
      }
    } catch (e) {}
  }

  var sent = 0, MAX_ROWS = 150;   // per page load, so a stuck loop can not flood the log
  function log(kind, text, extra) {
    extra = extra || {};
    text = String(text == null ? '' : text);
    analyticsEvent(kind, text, extra);
    if (kind === 'question') questions++;
    if (kind !== 'leave' && kind !== 'view' && kind !== 'error') last = kind + ':' + text.slice(0, 60);
    if (!logging || !text || (sent >= MAX_ROWS && kind !== 'leave')) return;
    sent++;
    try {
      var detail = extra.detail;
      if (!detail && (extra.label || extra.at)) { detail = {}; if (extra.label) detail.label = extra.label; if (extra.at) detail.at = extra.at; }
      var body = JSON.stringify({ kind: kind, text: text.slice(0, 1000), page: location.pathname, visit: visit, answer: extra.answer, mode: extra.mode, detail: detail });
      // sendBeacon can't send JSON to another site, so a cross site endpoint always uses fetch.
      if (CROSS_SITE || !(navigator.sendBeacon && navigator.sendBeacon(LOG_ENDPOINT, new Blob([body], { type: 'application/json' })))) {
        fetch(LOG_ENDPOINT, { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) {}
  }

  window.mcTrack = { log: log, logging: logging, visit: visit, target: target, describe: describe, where: where };
  // Clarity replays carry the same visit id as the log, so the report's visit
  // can be found in Clarity (Filters, Custom tags, visit_id).
  if (logging && typeof window.clarity === 'function') { try { window.clarity('set', 'visit_id', visit); } catch (e) {} }

  // Start of the visit. Only coarse context: the referring site's name, the
  // campaign tags on the link (utm_*, so each LinkedIn post can be told
  // apart), window size, language, light or dark mode, touch or mouse. The
  // server adds the country (never the IP address).
  var ref = 'direct';
  try { if (document.referrer) ref = new URL(document.referrer).hostname.replace(/^www\./, ''); } catch (e) {}
  if (ref === location.hostname.replace(/^www\./, '')) ref = 'this site';
  var utm = '';
  try {
    var q = new URL(location.href).searchParams;
    utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].map(function (k) { return q.get(k) || ''; }).join('/').replace(/\/+$/, '').slice(0, 100);
  } catch (e) {}
  var mq = function (m) { try { return matchMedia(m).matches; } catch (e) { return false; } };
  var openDetail = { ref: ref, screen: innerWidth < 600 ? 'phone' : innerWidth < 1100 ? 'tablet' : 'desktop', vp: innerWidth + 'x' + innerHeight, v: site.version || '', kind: site.page_kind || '' };
  if (utm) openDetail.utm = utm;
  openDetail.lang = String(navigator.language || '').slice(0, 10);
  openDetail.theme = mq('(prefers-color-scheme: dark)') ? 'dark' : 'light';
  openDetail.input = mq('(pointer: coarse)') ? 'touch' : 'mouse';
  log('action', 'open', { detail: openDetail });

  // Clicks on every link and button (capture phase, so they count even when a
  // page handler stops them). Three quick clicks on the same thing is a
  // frustration signal: something looked clickable and did not respond.
  var lastClick = { node: null, t: 0, n: 0 };
  document.addEventListener('click', function (e) {
    var d = describe(e.target);
    var node = e.target && e.target.closest ? e.target.closest('a, button, [role], img, h1, h2, h3, p, li, div') : null;
    var now = Date.now();
    var at = where(node || e.target, e.clientX, e.clientY);
    if (node && node === lastClick.node && now - lastClick.t < 700) {
      if (++lastClick.n === 3) log('action', 'rage:' + (d ? d.label || d.text : clean(node.textContent, 40) || node.tagName.toLowerCase()), { at: at });
    } else lastClick = { node: node, t: now, n: 1 };
    lastClick.t = now;
    if (d) { clicks++; log(d.kind, d.text, { label: d.label, at: at }); }
  }, true);

  // Which sections were actually read: a main heading (h1 or h2; smaller ones
  // made too many rows) counts once it has been on screen for a full second.
  // Headings appear after the page renders, so new ones are picked up as the
  // visitor scrolls. The chat conversation is left out (the chat logs its own
  // questions and answers).
  var seen = {}, watched = typeof WeakSet === 'function' ? new WeakSet() : null, timers = {}, sections = 0;
  var io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var h = clean(headingName(en.target), 80);
      if (!h || seen[h]) return;
      if (en.isIntersecting) timers[h] = setTimeout(function () { seen[h] = 1; sections++; log('view', h, { at: where(en.target) }); }, 1000);
      else clearTimeout(timers[h]);
    });
  }, { threshold: 0.6 }) : null;
  function watchHeadings() {
    if (!io || !watched) return;
    var list = document.querySelectorAll('h1, h2');
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      if (watched.has(h) || h.closest('x-dc, [data-clarity-mask], [data-log-skip]')) continue;
      watched.add(h); io.observe(h);
    }
  }

  // Copying: what kind of thing was copied (the email address, a link, or
  // other text) and where on the page, never the text itself.
  document.addEventListener('copy', function () {
    var t = '', node = null;
    try { var sel = getSelection(); t = String(sel); node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement); } catch (e) {}
    if (node && node.closest && node.closest('[data-clarity-mask]')) node = node.closest('[data-clarity-mask]');
    log('action', 'copy:' + (/@/.test(t) ? 'email' : /https?:\/\//.test(t) ? 'link' : 'text'), { at: where(node) });
  });

  // A form or text box the visitor started to use, by its label, once per
  // page. Never what they typed: that is only saved when a question is sent.
  // Only focus the visitor caused (a click, tap or key just before) counts:
  // a page that focuses its own box on load is not the visitor starting.
  var fields = {}, acted = 0;
  ['pointerdown', 'keydown'].forEach(function (t) { document.addEventListener(t, function () { acted = Date.now(); }, true); });
  document.addEventListener('focusin', function (e) {
    var f = e.target;
    if (!f || !/^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) || f.closest('x-dc') || Date.now() - acted > 1500) return;
    var name = clean(f.getAttribute('aria-label') || (f.labels && f.labels[0] && f.labels[0].textContent) || f.getAttribute('placeholder') || f.getAttribute('name') || f.id || f.tagName.toLowerCase(), 40);
    if (fields[name]) return;
    fields[name] = 1;
    log('action', 'field:' + name, { at: where(f) });
  });

  // Errors in this site's own scripts, so broken features show up in the
  // report before a visitor mentions them. Five per page at most.
  var errors = 0;
  addEventListener('error', function (e) {
    if (!e || !e.message || errors >= 5) return;
    var file = String(e.filename || '');
    if (file && file.indexOf(location.origin) !== 0) return;
    errors++;
    log('error', String(e.message).slice(0, 160) + (file ? ' @ ' + file.replace(location.origin, '') + ':' + (e.lineno || 0) : ''));
  });

  // Time actually spent: seconds the page was visible, not just open.
  var visibleSince = Date.now(), active = 0;
  addEventListener('scroll', function () {
    var h = document.documentElement.scrollHeight - innerHeight;
    scroll = Math.max(scroll, h > 0 ? Math.round(scrollY / h * 100) : 100);
    watchHeadings();
  }, { passive: true });
  addEventListener('load', function () { watchHeadings(); setTimeout(watchHeadings, 1500); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (visibleSince) active += Date.now() - visibleSince;
      visibleSince = 0;
      log('leave', 'leave', { detail: { seconds: Math.round((Date.now() - t0) / 1000), active: Math.round(active / 1000), scroll: scroll, sections: sections, questions: questions, clicks: clicks, last: last } });
    } else visibleSince = Date.now();
  });
})();
