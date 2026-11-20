'use strict';
(async () => {
  if (!EH.init()) return;
  const { $, $$, esc, api, ago, fail, downloadCsv } = EH;
  let all = [], filter = 'ALL', selected = null, zones = [], allTypes = [], mapCenter = null, cityName = '', tlOpenId = null, page = 1;
  let PAGE_SIZE = 8, rowH = 0, fitting = false, reveal = null; // rows per page follows the card height (see fitPageSize)
  // How many rows fit in the list card right now (desktop). Other layouts use 8.
  function fitPageSize() {
    if (!window.matchMedia('(min-width: 1101px)').matches) return 8;
    const sc = $('.rp__scroll'); if (!sc) return PAGE_SIZE;
    const tr = $('#rpBody tr[data-id]'); if (tr) rowH = tr.getBoundingClientRect().height;
    if (!rowH) return PAGE_SIZE;
    const head = sc.querySelector('thead');
    return Math.max(4, Math.floor((sc.clientHeight - (head ? head.offsetHeight : 0) - 2) / rowH));
  }
  const adv = { range: 'all', zone: '', photos: false, needsInfo: false };
  const narrow = () => window.matchMedia('(max-width: 1100px)').matches; // Type/Urgency dropdowns are hidden here (see styles) and move into Filters
  const advOn = () => adv.range !== 'all' || adv.zone || adv.photos || adv.needsInfo;
  const RANGES = { all: ['All time', 0], today: ['Today', 1], '7': ['Last 7 days', 7], '30': ['Last 30 days', 30] };
  const search = $('#globalSearch');
  search.value = new URLSearchParams(location.search).get('q') || '';
  search.placeholder = 'Search reports';

  const visible = () => {
    const q = search.value.trim().toLowerCase(), t = $('#fType').value, u = $('#fUrg').value;
    return all.filter((r) => (filter === 'ALL' || r.status === filter) && (!t || r.type === t) && (!u || r.urgency === u) &&
      (!q || `${r.id} ${r.type} ${r.locationText} ${r.reporterName} ${r.description}`.toLowerCase().includes(q)) &&
      (adv.range === 'all' || Date.now() - new Date(r.createdAt).getTime() <= RANGES[adv.range][1] * 864e5) &&
      (!adv.zone || r.reporterZone === adv.zone) && (!adv.photos || (r.photos || []).length) && (!adv.needsInfo || r.infoRequested));
  };

  function renderPanel() {
    const panel = $('#panel'), r = all.find((x) => x.id === selected);
    if (!r) { delete panel.dataset.shown; panel.innerHTML = '<div class="empty"><b>No report selected</b>Select a report to review it.</div>'; return; }
    const fresh = panel.dataset.shown !== r.id; panel.dataset.shown = r.id;
    panel.innerHTML = RP.render(r);
    if (fresh) panel.scrollTop = 0; // a newly picked report starts at the top
    RP.bind(panel, r, (upd) => { all[all.findIndex((x) => x.id === upd.id)] = upd; render(); });
    collapseTimeline(panel, r);
  }
  // Long histories: show the latest few events and tuck the older ones behind one link.
  function collapseTimeline(panel, r) {
    const tl = panel.querySelector('.timeline'); if (!tl) return;
    const items = [...tl.children].filter((el) => el.classList.contains('timeline__item'));
    const KEEP = 4;
    if (items.length <= KEEP + 1) return;
    const older = items.slice(0, items.length - KEEP);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'tl-more';
    const paint = () => {
      const open = tlOpenId === r.id;
      older.forEach((el) => { el.hidden = !open; });
      btn.textContent = open ? 'Hide earlier events' : `Show ${older.length} earlier events`;
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', () => { tlOpenId = tlOpenId === r.id ? null : r.id; paint(); });
    tl.prepend(btn); paint();
  }
  function render() {
    const counts = { ALL: all.length };
    ['NEW', 'VERIFIED', 'DISPATCHED', 'RESOLVED', 'REJECTED'].forEach((s) => { counts[s] = all.filter((r) => r.status === s).length; });
    $$('#rpChips [data-n]').forEach((s) => { s.textContent = counts[s.dataset.n]; });
    const matches = visible();
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    if (reveal) { const i = matches.findIndex((r) => r.id === reveal); if (i >= 0) page = Math.floor(i / PAGE_SIZE) + 1; }
    page = Math.min(Math.max(1, page), pages);
    const rows = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    $('#rpBody').innerHTML = rows.map((r) => `<tr data-id="${esc(r.id)}" class="${r.id === selected ? 'is-selected' : ''}">
      <td class="id">${esc(r.id)}</td><td>${esc(r.type)}${r.infoRepliedAt ? ' <span class="pill pill--green pill--sm">Replied</span>' : ''}</td><td>${esc(RP.where(r))}</td>
      <td><span class="pill pill--${RP.UC[r.urgency]} pill--sm">${esc(r.urgency)}</span></td><td>${esc(ago(r.createdAt))}</td>
      <td><span class="pill pill--${RP.SC[r.status]} pill--sm pill--caps">${esc(r.status)}</span></td></tr>`).join('');
    $('#rpEmpty').innerHTML = rows.length ? '' : `<div class="empty"><b>${all.length ? 'No reports match these filters' : 'No reports yet'}</b>${all.length ? 'Try a different status or clear the filters.<br><button class="btn btn--sm btn--fit" id="clearFilters" style="margin-top:10px">Clear filters</button>' : 'Reports filed by residents in the app will show up here.'}</div>`;
    const pg = $('#rpPager'), chev = (n) => `<svg class="icon" aria-hidden="true"><use href="#${n}"/></svg>`;
    pg.hidden = pages <= 1;
    pg.innerHTML = `<button type="button" class="btn btn--fit" data-pg="prev"${page <= 1 ? ' disabled' : ''}>${chev('i-chev-l')}Prev</button>
      <span class="bk__pager-info">${page} of ${pages}</span>
      <button type="button" class="btn btn--fit" data-pg="next"${page >= pages ? ' disabled' : ''}>Next${chev('i-chev-r')}</button>`;
    $('#advDot').hidden = !(advOn() || (narrow() && ($('#fType').value || $('#fUrg').value)));
    renderPanel();
    if (!fitting) {
      const f = fitPageSize();
      if (f !== PAGE_SIZE) { fitting = true; const first = (page - 1) * PAGE_SIZE; PAGE_SIZE = f; page = Math.floor(first / PAGE_SIZE) + 1; render(); fitting = false; }
    }
    reveal = null;
  }

  try {
    $('#rpBody').innerHTML = Array.from({ length: 6 }, () => '<tr class="skeleton-row"><td colspan="6"><span class="skeleton"></span></td></tr>').join('');
    const [reports, cfg] = await Promise.all([api('/admin/reports'), api('/config'), RP.load()]);
    all = reports; zones = cfg.zones || [];
    const types = [...cfg.reportTypes.incident, ...cfg.reportTypes.hazard]; allTypes = types; mapCenter = cfg.mapCenter || null; cityName = (cfg.barangay && cfg.barangay.city) || '';
    $('#fType').innerHTML = '<option value="">Type: All</option>' + types.map((t) => `<option>${esc(t)}</option>`).join('');
    // Opened from a link like reports.html?q=EH-0005: show that report in the side panel, but do NOT keep
    // it as a search filter (otherwise every other status chip looks empty). Anything that is not an exact
    // report ID (e.g. a word typed in the top search box) stays a normal search.
    const want = search.value.trim().toUpperCase();
    const exact = all.find((r) => r.id === want);
    if (exact) { selected = exact.id; search.value = ''; history.replaceState(null, '', location.pathname); reveal = exact.id; }
    render();
    if (exact) { const row = $('#rpBody tr.is-selected'); if (row) row.scrollIntoView({ block: 'nearest' }); }
  } catch (e) { fail(e); }

  $('#rpBody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) { selected = tr.dataset.id; render(); } });
  $$('#rpChips .chip').forEach((c) => c.addEventListener('click', () => { $$('#rpChips .chip').forEach((x) => x.classList.toggle('is-on', x === c)); filter = c.dataset.f; page = 1; render(); }));
  let rz; window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { const f = fitPageSize(); if (f !== PAGE_SIZE) { const first = (page - 1) * PAGE_SIZE; PAGE_SIZE = f; page = Math.floor(first / PAGE_SIZE) + 1; render(); } }, 150);
  });
  $('#rpPager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pg]'); if (!b || b.disabled) return;
    page += b.dataset.pg === 'next' ? 1 : -1; render();
    const sc = $('.rp__scroll'); if (sc) sc.scrollTop = 0;
  });
  ['#fType', '#fUrg'].forEach((s) => $(s).addEventListener('change', () => { page = 1; render(); }));
  search.addEventListener('input', () => { page = 1; render(); });
  const clearAll = () => { page = 1; filter = 'ALL'; $$('#rpChips .chip').forEach((x) => x.classList.toggle('is-on', x.dataset.f === 'ALL')); $('#fType').value = ''; $('#fUrg').value = ''; search.value = ''; Object.assign(adv, { range: 'all', zone: '', photos: false, needsInfo: false }); render(); };
  document.addEventListener('click', (e) => { if (e.target.id === 'clearFilters') clearAll(); });
  $('#filtersBtn').addEventListener('click', async () => {
    const out = await EH.modal({
      title: 'Filters', sub: `${visible().length} reports match right now.`, submit: 'Apply filters',
      fields: [
        ...(narrow() ? [
          { name: 'type', label: 'Type', type: 'select', value: $('#fType').value, options: [{ value: '', label: 'All types' }, ...allTypes], full: true },
          { name: 'urg', label: 'Urgency', type: 'select', value: $('#fUrg').value, options: [{ value: '', label: 'All urgencies' }, 'Critical', 'High', 'Medium', 'Low'], full: true },
        ] : []),
        { name: 'range', label: 'Date range', type: 'select', value: adv.range, options: Object.entries(RANGES).map(([v, [l]]) => ({ value: v, label: l })), full: true },
        { name: 'zone', label: 'Zone / Purok (of the reporter)', type: 'select', value: adv.zone, options: [{ value: '', label: 'All zones' }, ...zones], full: true },
        { name: 'photos', label: 'Has photos', type: 'checkbox', value: adv.photos, full: true },
        { name: 'needsInfo', label: 'Waiting for the reporter to reply (more info requested)', type: 'checkbox', value: adv.needsInfo, full: true },
      ],
    });
    if (out) {
      Object.assign(adv, { range: out.range, zone: out.zone, photos: out.photos, needsInfo: out.needsInfo });
      if (narrow()) ['#fType', '#fUrg'].forEach((id, i) => { const el = $(id); el.value = i ? out.urg : out.type; el.dispatchEvent(new Event('change')); });
      page = 1; render();
    }
  });
  // ---- manual report (walk-in / phone call)
  $('#newReportBtn').addEventListener('click', async () => {
    const out = await EH.modal({
      title: 'New report', sub: 'Record a report from a walk-in or phone call. It is added to the list and shown in the resident app.', submit: 'Create report',
      fields: [
        { name: 'type', label: 'Type', type: 'select', options: [{ value: '', label: 'Select a type' }, ...allTypes], full: true },
        { name: 'urgency', label: 'Urgency', type: 'select', value: 'Medium', options: ['Low', 'Medium', 'High', 'Critical'] },
        { name: 'status', label: 'Status', type: 'select', value: 'VERIFIED', options: [{ value: 'VERIFIED', label: 'Verified (visible to residents)' }, { value: 'NEW', label: 'New (needs review)' }] },
        { name: 'locationText', label: 'Location', required: true, full: true, placeholder: 'Street, landmark or purok' },
        { name: 'description', label: 'Description', type: 'textarea', max: 1000, required: true, full: true, placeholder: 'What happened? Who is affected?' },
        { name: 'reporterName', label: 'Reporter name', placeholder: 'Required if not a resident' },
        { name: 'reporterContact', label: 'Contact number', placeholder: '09xx xxx xxxx' },
      ],
      onOpen: (bg, form) => LP.attach(form, { center: mapCenter, city: cityName }),   // map pin, search, my location, paste
      onSubmit: (v) => {
        if (!v.type) throw new Error('Select a report type.');
        // v.lat / v.lng come from the picker's hidden inputs ('' when no pin was dropped)
        return api('/admin/reports', { method: 'POST', body: { type: v.type, urgency: v.urgency, status: v.status, locationText: v.locationText, lat: v.lat, lng: v.lng, description: v.description, reporterName: v.reporterName, reporterContact: v.reporterContact } });
      },
    });
    if (!out || out === true) return;
    clearAll();                         // make sure no filter hides the new report
    all.unshift(out); selected = out.id; reveal = out.id; render();
    EH.toast(`Report ${out.id} created`, 'ok');
  });
  $('#exportBtn').addEventListener('click', async () => {
    const rows = visible(); if (!rows.length) return EH.toast('Nothing to export.');
    const mask = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || ''; };
    const COLS = { ID: (r) => r.id, Type: (r) => r.type, Urgency: (r) => r.urgency, Status: (r) => r.status, Location: (r) => r.locationText, Reported: (r) => r.createdAt, 'Assigned to': (r) => r.assignedTo, 'Reporter (masked)': (r) => mask(r.reporterName), Photos: (r) => (r.photos || []).length, Description: (r) => r.description };
    const out = await EH.modal({
      title: 'Export reports', sub: `${rows.length} reports match the current filters. Opens in Excel or Google Sheets. Exports are access-logged. Reporter names are masked; contact numbers are never included.`, submit: 'Export CSV',
      fields: Object.keys(COLS).map((c) => ({ name: c, label: c, type: 'checkbox', value: c !== 'Description' && c !== 'Reporter (masked)' })),
    });
    if (!out) return;
    const cols = Object.keys(COLS).filter((c) => out[c]);
    if (!cols.length) return EH.toast('Pick at least one column.');
    EH.downloadCsv('reports.csv', [cols, ...rows.map((r) => cols.map((c) => COLS[c](r)))]);
    api('/admin/log-export', { method: 'POST', body: { what: 'reports', count: rows.length, format: 'csv' } }).catch(() => {});
  });
})();
