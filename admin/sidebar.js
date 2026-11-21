'use strict';
/* Sidebar upgrade, shared by every admin page.
   - splits the menu into Monitor / Respond / Admin
   - live counts per item: pending reports (red badge), active incidents,
     active blockages, total announcements (hover shows the type breakdown)
   - a total next to the MONITOR and RESPOND titles
   - a small status strip above the account card: data freshness + push status
   Load it LAST on each page, after app.js and the page script:
   <script src="sidebar.js"></script> */
(() => {
  const side = document.querySelector('.sidebar');
  if (!side || side.dataset.enhanced) return;
  side.dataset.enhanced = '1';

  /* -1. Collapsible sidebar (desktop). The button sits at the start of the top bar; the choice is remembered.
         Phones keep the existing slide-out drawer, so the button is hidden there. */
  (() => {
    const KEY = 'ehbr.sidebar.collapsed';
    const app = side.closest('.app') || document.body;
    // Keep the sidebar in view while the page scrolls (skipped if the stylesheet already pins it with position: fixed)
    const pos = getComputedStyle(side).position;
    const stick = pos !== 'fixed' && pos !== 'absolute';
    const css = document.createElement('style');
    css.textContent = `
@media (min-width: 861px) {
  ${stick ? '.app .sidebar, .sidebar { position: sticky !important; top: 0 !important; align-self: flex-start !important; height: 100vh !important; max-height: 100vh !important; overflow-y: auto; overscroll-behavior: contain; }' : ''}
  .sidebar.sb-anim { transition: width .2s ease, padding .2s ease; }
  .sb-toggle { margin-right: 12px; flex: none; cursor: pointer; }
  .app.sb-collapsed .sidebar { width: 76px; padding-left: 10px; padding-right: 10px; overflow: hidden; }
  .app.sb-collapsed .brand { justify-content: center; padding: 0 0 16px; }
  .app.sb-collapsed .brand > div:not(.brand__logo) { display: none; }
  .app.sb-collapsed .nav__label { font-size: 0; height: 1px; padding: 0; margin: 8px 10px; background: var(--line, #e5e7eb); overflow: hidden; }
  .app.sb-collapsed .nav__label .nav__count { display: none; }
  .app.sb-collapsed .nav__item { position: relative; justify-content: center; gap: 0; padding: 11px 0; font-size: 0; }
  .app.sb-collapsed .nav__item .nav__count { display: none; }
  .app.sb-collapsed .nav__item .nav__badge { position: absolute; top: 2px; right: 6px; margin: 0; padding: 0 5px; font-size: 10px; }
  .app.sb-collapsed .side-status { display: none; }
  .app.sb-collapsed .user { flex-direction: column; align-items: center; gap: 8px; padding: 10px 0; }
  .app.sb-collapsed .user > div:not(.user__avatar) { display: none; }
  .app.sb-collapsed .user .logout { margin: 0; }
}
@media (max-width: 860px) { .sb-toggle { display: none !important; } }`;
    document.head.appendChild(css);

    const get = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
    const put = (v) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* storage blocked: still works for this page */ } };
    const bar = document.querySelector('.topbar');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'icon-btn sb-toggle';
    btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>';
    const apply = (collapsed) => {
      app.classList.toggle('sb-collapsed', collapsed);
      btn.setAttribute('aria-expanded', String(!collapsed));
      const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      btn.setAttribute('aria-label', label); btn.title = label;
    };
    apply(get());
    if (bar) bar.prepend(btn);
    btn.addEventListener('click', () => { const v = !app.classList.contains('sb-collapsed'); apply(v); put(v); });
    requestAnimationFrame(() => requestAnimationFrame(() => side.classList.add('sb-anim')));   // no slide on first paint
    // collapsed items show only icons, so give each one a tooltip with its name
    side.querySelectorAll('.nav__item').forEach((a) => {
      const t = [...a.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (t && !a.title) a.title = t;
    });
  })();

  /* 0. Backup & Restore link. Added here so it appears on every page without editing each HTML file
        (backup.html already contains it, so nothing is added twice). */
  if (!side.querySelector('a.nav__item[href="backup.html"]')) {
    const before = side.querySelector('a.nav__item[href="settings.html"]') || side.querySelector('a.nav__item[href="database.html"]');
    if (before) {
      const a = document.createElement('a');
      a.className = 'nav__item'; a.href = 'backup.html';
      a.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>Backup &amp; Restore';
      before.before(a);                      // Database, Backup & Restore, Settings
    }
  }

  /* 0b. Reports Generator link, placed between Database and Backup & Restore. Added here for the same reason. */
  if (!side.querySelector('a.nav__item[href="report-generator.html"]')) {
    const before = side.querySelector('a.nav__item[href="backup.html"]') || side.querySelector('a.nav__item[href="settings.html"]');
    if (before) {
      const a = document.createElement('a');
      a.className = 'nav__item'; a.href = 'report-generator.html';
      a.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>Reports Generator';
      before.before(a);
    }
  }

  const items = [...side.querySelectorAll('.nav__item')];
  const hrefOf = (a) => (a.getAttribute('href') || '').split(/[?#]/)[0];
  const link = (h) => items.find((a) => hrefOf(a) === h);

  /* 1. Groups (the items are already in this order, so only the labels change) */
  const GROUPS = [
    ['MONITOR', ['index.html', 'incident-map.html', 'blockages.html']],
    ['RESPOND', ['reports.html', 'announcements.html']],
    ['ADMIN',   ['database.html', 'report-generator.html', 'backup.html', 'settings.html']],
  ];
  const labelOf = {};
  const firstLabel = side.querySelector('.nav__label');
  GROUPS.forEach(([title, hrefs], i) => {
    const first = items.find((a) => hrefs.includes(hrefOf(a)));
    if (!first) return;
    if (i === 0 && firstLabel) {
      firstLabel.textContent = title; firstLabel.classList.add('nav__label--group');
      labelOf[title] = firstLabel; return;
    }
    const p = document.createElement('p');
    p.className = 'nav__label nav__label--group'; p.textContent = title;
    first.before(p);
    labelOf[title] = p;
  });

  /* 2. Counts */
  function setBadge(a, n) {            // Reports: the red badge that already exists in the markup
    const b = a && a.querySelector('.nav__badge'); if (!b) return;
    b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
  }
  function setCount(el, n, tip) {      // items AND group titles: a quiet grey number
    if (!el) return;
    let c = el.querySelector('.nav__count');
    if (!c) { c = document.createElement('span'); c.className = 'nav__count'; el.appendChild(c); }
    c.textContent = n > 99 ? '99+' : n; c.hidden = !n;
    if (tip) c.title = tip; else c.removeAttribute('title');
  }

  /* Data helpers. Endpoints are listed once here so they are easy to change. */
  const ENDPOINTS = { blockages: '/admin/blockages', announcements: '/announcements' };
  const asList = (r) => (Array.isArray(r) ? r : (r && (r.items || r.data || r.blockages || r.announcements)) || []);
  // A blockage is active until its expected end time passes (the server sets `expired`).
  const isActive = (x) => !!x && !x.expired && !(x.until && Date.now() > new Date(x.until).getTime());
  const typeOf = (x) => String(x.category || x.type || '').trim().toLowerCase();
  const breakdown = (by) => Object.entries(by).filter(([, n]) => n).map(([t, n]) => `${n} ${t}`).join(' · ');

  /* 3. Status strip */
  const strip = document.createElement('div');
  strip.className = 'side-status';
  strip.innerHTML = '<p class="ss-live is-off"><i></i><span>Connecting…</span></p><p class="ss-push is-off"><i></i><span>Checking push…</span></p>';
  const user = side.querySelector('.user');
  if (user) user.before(strip); else side.appendChild(strip);
  const live = strip.querySelector('.ss-live'), push = strip.querySelector('.ss-push');

  async function refresh() {
    // EH is a top-level const in app.js, so it is NOT on window: test it by name.
    if (typeof EH === 'undefined' || typeof EH.api !== 'function') {
      live.classList.add('is-off'); live.lastElementChild.textContent = 'Status unavailable';
      push.classList.add('is-off'); push.lastElementChild.textContent = 'Push status unavailable';
      return;
    }
    // One failing request must not blank the others.
    const [st] = await Promise.allSettled([EH.api('/admin/stats')]);
    const ok = st.status === 'fulfilled';
    const s = ok ? st.value : {};
    // Only fall back to the list endpoints when /admin/stats doesn't carry the numbers yet.
    const none = Promise.resolve(null);
    const [bl, an] = await Promise.allSettled([
      s.activeBlockages != null ? none : EH.api(ENDPOINTS.blockages),
      s.totalAnnouncements != null ? none : EH.api(ENDPOINTS.announcements),
    ]);

    const pending = s.pendingReports || 0;
    const incidents = s.activeIncidents || 0;
    // Prefer a number from /admin/stats if the backend provides it, else count the list.
    const blockages = s.activeBlockages != null ? s.activeBlockages
      : bl.status === 'fulfilled' ? asList(bl.value).filter(isActive).length : null;

    let announcements = null, annTip = '';
    if (s.totalAnnouncements != null) {              // from /admin/stats (preferred)
      announcements = s.totalAnnouncements;
      annTip = breakdown(s.announcementCounts || {});
    } else if (an.status === 'fulfilled') {          // fallback: count the public list
      const list = asList(an.value);
      announcements = list.length;
      const by = {};
      list.forEach((x) => { const t = typeOf(x) || 'other'; by[t] = (by[t] || 0) + 1; });
      annTip = breakdown(by);
    }

    if (ok) {
      setBadge(link('reports.html'), 0);                    // retire the red badge...
      setCount(link('reports.html'), pending, 'Pending reports');   // ...and show the same quiet grey number as the other items
      setCount(link('incident-map.html'), incidents);
    }
    if (blockages != null) setCount(link('blockages.html'), blockages);
    if (announcements != null) setCount(link('announcements.html'), announcements, annTip);

    live.classList.toggle('is-off', !ok);
    live.lastElementChild.textContent = ok
      ? 'Live · updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : 'Offline · retrying';
    try {
      const p = await EH.api('/admin/push-status');
      push.classList.toggle('is-off', !p.enabled);
      push.lastElementChild.textContent = p.enabled ? `Push on · ${p.devices} phone${p.devices === 1 ? '' : 's'}` : 'Push not set up';
    } catch { /* keep the previous text */ }
  }
  refresh();
  setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
