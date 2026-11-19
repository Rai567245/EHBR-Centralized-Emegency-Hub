'use strict';
/* Sidebar upgrade, shared by every admin page.
   - splits the menu into Monitor / Respond / Admin
   - live counts: pending reports (red badge) and active incidents (plain number)
   - a small status strip above the account card: data freshness + push status
   Load it LAST on each page, after app.js and the page script:
   <script src="sidebar.js"></script> */
(() => {
  const side = document.querySelector('.sidebar');
  if (!side || side.dataset.enhanced) return;
  side.dataset.enhanced = '1';

  const items = [...side.querySelectorAll('.nav__item')];
  const hrefOf = (a) => (a.getAttribute('href') || '').split(/[?#]/)[0];
  const link = (h) => items.find((a) => hrefOf(a) === h);

  /* 1. Groups (the items are already in this order, so only the labels change) */
  const GROUPS = [
    ['MONITOR', ['index.html', 'incident-map.html', 'blockages.html']],
    ['RESPOND', ['reports.html', 'announcements.html']],
    ['ADMIN',   ['database.html', 'settings.html']],
  ];
  const firstLabel = side.querySelector('.nav__label');
  GROUPS.forEach(([title, hrefs], i) => {
    const first = items.find((a) => hrefs.includes(hrefOf(a)));
    if (!first) return;
    if (i === 0 && firstLabel) { firstLabel.textContent = title; firstLabel.classList.add('nav__label--group'); return; }
    const p = document.createElement('p');
    p.className = 'nav__label nav__label--group'; p.textContent = title;
    first.before(p);
  });

  /* 2. Counts */
  function setBadge(a, n) {            // Reports: the red badge that already exists in the markup
    const b = a && a.querySelector('.nav__badge'); if (!b) return;
    b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
  }
  function setCount(a, n) {            // others: a quiet grey number
    if (!a) return;
    let c = a.querySelector('.nav__count');
    if (!c) { c = document.createElement('span'); c.className = 'nav__count'; a.appendChild(c); }
    c.textContent = n; c.hidden = !n;
  }

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
    let ok = true;
    try {
      const s = await EH.api('/admin/stats');
      setBadge(link('reports.html'), s.pendingReports || 0);
      setCount(link('incident-map.html'), s.activeIncidents || 0);
    } catch { ok = false; }
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