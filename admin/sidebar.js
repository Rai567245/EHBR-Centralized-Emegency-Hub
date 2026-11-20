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

  const items = [...side.querySelectorAll('.nav__item')];
  const hrefOf = (a) => (a.getAttribute('href') || '').split(/[?#]/)[0];
  const link = (h) => items.find((a) => hrefOf(a) === h);

  /* 1. Groups (the items are already in this order, so only the labels change) */
  const GROUPS = [
    ['MONITOR', ['index.html', 'incident-map.html', 'blockages.html']],
    ['RESPOND', ['reports.html', 'announcements.html']],
    ['ADMIN',   ['database.html', 'settings.html']],
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
      setBadge(link('reports.html'), pending);
      setCount(link('incident-map.html'), incidents);
    }
    if (blockages != null) setCount(link('blockages.html'), blockages);
    if (announcements != null) setCount(link('announcements.html'), announcements, annTip);

    // Section totals = sum of the numbers shown in that section (ADMIN has none).
    if (ok || blockages != null) setCount(labelOf.MONITOR, incidents + (blockages || 0), 'Active incidents + active blockages');
    if (ok || announcements != null) setCount(labelOf.RESPOND, pending + (announcements || 0), 'Pending reports + announcements');

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
