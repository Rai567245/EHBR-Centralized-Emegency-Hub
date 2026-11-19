'use strict';
(async () => {
  if (!EH.init()) return;
  const { $, esc, api, ago, fail, makeMap, marker, downloadCsv } = EH;
  let map = null, layer = null, last = { stats: null, reports: [], settings: null };

  const DAY = 864e5;
  const KIND_ICON = { report: 'i-file', user: 'i-users', announcement: 'i-mega', center: 'i-shield' };
  const icon = (n) => `<svg class="icon" aria-hidden="true"><use href="#${n}"/></svg>`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // refresh button tooltip: when the numbers were last updated
  function markUpdated() {
    const t = 'Refresh · updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const b = $('#refreshBtn'); b.title = t; b.setAttribute('aria-label', t);
  }

  // 7-day report chart, status split and the "needs attention" list (all worked out from the reports already loaded)
  function renderInsights(reports, centers) {
    const now = Date.now(), at = (r) => new Date(r.createdAt).getTime();
    const t0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const days = Array.from({ length: 7 }, (_, i) => t0(now - (6 - i) * DAY));
    const counts = days.map((d0) => reports.filter((r) => at(r) >= d0 && at(r) < d0 + DAY).length);
    const total = counts.reduce((a, b) => a + b, 0), max = Math.max(...counts, 1);
    const prev = reports.filter((r) => at(r) >= t0(now - 13 * DAY) && at(r) < days[0]).length, diff = total - prev;
    $('#trendTotal').textContent = total;
    const tb = $('#trendBars'); tb.classList.toggle('is-empty', !total); tb.dataset.empty = 'No reports filed in the last 7 days';
    $('#trendDelta').textContent = !total && !prev ? 'No reports in the last 14 days' : diff === 0 ? 'Same as the previous 7 days' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than the previous 7 days`;
    $('#trendBars').innerHTML = days.map((d0, i) => `<div class="bars__col${i === 6 ? ' is-today' : ''}" title="${plural(counts[i], 'report')}"><b>${counts[i] || ''}</b><i style="height:${Math.max(4, Math.round((counts[i] / max) * 80))}px"></i><span>${new Date(d0).toLocaleDateString(undefined, { weekday: 'short' })}</span></div>`).join('');

    const ST = [['NEW', 'New'], ['VERIFIED', 'Verified'], ['DISPATCHED', 'Dispatched'], ['RESOLVED', 'Resolved'], ['REJECTED', 'Rejected']];
    const by = (s) => reports.filter((r) => r.status === s).length;
    $('#statusSplit').innerHTML = ST.map(([s]) => (by(s) ? `<i class="s-${s.toLowerCase()}" style="flex:${by(s)}"></i>` : '')).join('');
    $('#statusLegend').innerHTML = ST.map(([s, l]) => `<span><i class="s-${s.toLowerCase()}"></i>${l} <b>${by(s)}</b></span>`).join('');

    const open = reports.filter((r) => ['NEW', 'VERIFIED', 'DISPATCHED'].includes(r.status));
    const rows = [
      ['i-warn', 'High or critical urgency', 'Open reports to prioritise', open.filter((r) => ['High', 'Critical'].includes(r.urgency)).length, 'reports.html'],
      ['i-users', 'No team assigned', 'Active reports without a responder', open.filter((r) => r.status !== 'NEW' && !r.assignedTo).length, 'reports.html'],
      ['i-clock', 'Waiting over 24 hours', 'Reports not yet verified', reports.filter((r) => r.status === 'NEW' && now - at(r) > DAY).length, 'reports.html'],
      ['i-shield', 'Centers above 85% full', 'Open evacuation centers', centers.filter((c) => c.status === 'open' && c.capacity && c.occupied / c.capacity >= 0.85).length, 'database.html#centers'],
    ];
    $('#attention').innerHTML = rows.map(([ic, t, s, n, href]) => `<a class="attn__row${n ? '' : ' is-zero'}" href="${href}"><span class="attn__ico">${icon(ic)}</span><span class="attn__txt">${t}<small>${s}</small></span><span class="attn__n">${n}</span></a>`).join('');
  }

  async function load() {
    const [stats, reports, centers, settings] = await Promise.all([api('/admin/stats'), api('/admin/reports'), api('/centers'), api('/admin/settings')]);
    last = { stats, reports, settings };
    document.querySelector('.content').classList.remove('is-loading'); $('#liveErr').hidden = true;
    const b = settings.barangay;
    $('#pageSub').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
      ' · Live overview' + (b.name ? ` for Barangay ${b.name}${b.city ? ', ' + b.city : ''}` : '');

    $('#sActive').textContent = stats.activeIncidents;
    $('#sPending').textContent = stats.pendingReports;
    $('#sHaz').textContent = stats.hazardsMonitored;
    $('#sCen').textContent = stats.centersOpen;
    [['#sActive', stats.activeIncidents], ['#sPending', stats.pendingReports], ['#sHaz', stats.hazardsMonitored], ['#sCen', stats.centersOpen]]
      .forEach(([s, n]) => $(s).closest('.stat').classList.toggle('is-zero', !n));
    $('#nCen').textContent = centers.length ? `${stats.capacityUsedPct}% of capacity used` : 'No centers added yet';
    const capBar = $('#barCen');
    capBar.hidden = !centers.length; if (centers.length) capBar.firstElementChild.style.width = Math.min(100, stats.capacityUsedPct || 0) + '%';
    markUpdated();
    try { renderInsights(reports, centers); } catch (e) { console.warn('Insights unavailable', e); }

    // priority queue
    $('#queue').innerHTML = stats.queue.length ? stats.queue.map((r) => {
      const urg = String(r.urgency || '').toLowerCase();
      return `
      <a class="queue__item" href="reports.html?q=${encodeURIComponent(r.id)}">
        <div class="queue__main">
          <div class="queue__top"><p class="queue__title">${esc(r.type)}</p>${r.urgency ? `<span class="urg urg--${esc(urg)}"><i></i>${esc(r.urgency)}</span>` : ''}</div>
          <p class="queue__meta">${esc(r.id)} · ${esc(ago(r.createdAt))} · ${r.locationText ? esc(r.locationText) : '<span class="noloc">No location</span>'}</p></div>
        <span class="pill pill--${RP.SC[r.status]}">${esc(r.status)}</span></a>`;
    }).join('')
      : (stats.activeIncidents === 0 && stats.pendingReports === 0 ? '<div class="empty"><b>All clear</b>No active incidents or pending reports.</div>' : '<div class="empty"><b>Nothing waiting</b>New resident reports will appear here.</div>');

    // activity
    $('#activity').innerHTML = stats.activity.length ? stats.activity.slice(0, 5).map((a) => `
      <div class="activity"><span class="activity__icon">${icon(KIND_ICON[a.kind] || 'i-clock')}</span><span class="activity__text">${esc(a.text)}</span><span class="activity__time">${esc(ago(a.at))}</span></div>`).join('')
      : '<div class="empty empty--sm">No activity yet.</div>';

    // evacuation centers
    $('#centers').innerHTML = centers.length ? centers.slice(0, 4).map((c) => {
      const pct = c.capacity ? Math.min(100, Math.round((c.occupied / c.capacity) * 100)) : 0;
      const pill = c.status === 'open' ? 'green' : c.status === 'standby' ? 'amber' : 'gray';
      const left = Math.max(0, (c.capacity || 0) - (c.occupied || 0));
      return `<div class="center center--v2"><div class="center__top"><span class="center__name">${esc(c.name)}</span><span class="pill pill--${pill}">${esc(c.status)}</span></div>
        <span class="center__bar"><span style="width:${pct}%"></span></span>
        <div class="center__meta"><span><b>${c.occupied} / ${c.capacity}</b> occupied</span><span>${pct}% full · ${left} left</span></div></div>`;
    }).join('') : '<div class="empty empty--sm">No evacuation centers yet. <a href="database.html#centers">Add one</a>.</div>';

    const sum = $('#centersSum');
    const openC = centers.filter((c) => c.status === 'open');
    sum.hidden = !centers.length;
    if (centers.length) {
      const cap = openC.reduce((n, c) => n + (c.capacity || 0), 0), occ = openC.reduce((n, c) => n + (c.occupied || 0), 0);
      sum.innerHTML = `<span>Open <b>${openC.length}</b></span><span>Capacity <b>${cap.toLocaleString()}</b></span><span>Spaces left <b>${Math.max(0, cap - occ).toLocaleString()}</b></span>`;
    }

    // map
    if (!map) map = makeMap($('#miniMap'), settings.mapCenter, 15);
    if (map) {
      if (layer) layer.remove();
      layer = L.featureGroup().addTo(map);
      const pts = [];
      reports.filter((r) => ['NEW', 'VERIFIED', 'DISPATCHED'].includes(r.status) && r.lat != null).forEach((r) => {
        marker(layer, r.lat, r.lng, r.kind).bindTooltip(`${r.type} · ${r.locationText || ''}`); pts.push([r.lat, r.lng]);
      });
      centers.filter((c) => c.lat != null).forEach((c) => { marker(layer, c.lat, c.lng, 'center').bindTooltip(c.name); pts.push([c.lat, c.lng]); });
      if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 }); else map.setView([settings.mapCenter.lat, settings.mapCenter.lng], 15);
      let note = $('#miniMap .map-note');
      if (!pts.length) {
        if (!note) { note = document.createElement('div'); note.className = 'map-note'; $('#miniMap').appendChild(note); }
        note.textContent = 'No reports or evacuation centers with a location yet.';
      } else if (note) note.remove();
    }
  }
  try { await load(); } catch (e) { fail(e); document.querySelector('.content').classList.remove('is-loading'); $('#liveErr').hidden = false; }
  // ---- quick actions
  $('#qaSend').addEventListener('click', async () => {
    const stats = last.stats || await api('/admin/stats');
    let tpls = []; try { tpls = (await api('/admin/settings')).templates || []; } catch { /* templates are optional */ }
    const form = await EH.modal({
      onOpen: (bg, f) => { const sel = f.elements.tpl; if (sel) sel.addEventListener('change', () => { const t = tpls.find((x) => x.id === sel.value); if (t) { f.elements.title.value = t.title || t.name; f.elements.body.value = t.body.slice(0, 280); } }); },
      title: 'Send announcement', sub: 'Residents see this in the app and get a push notification.', submit: 'Review & send',
      fields: [
        ...(tpls.length ? [{ name: 'tpl', label: 'Use a template', type: 'select', full: true, options: [{ value: '', label: 'None' }, ...tpls.map((t) => ({ value: t.id, label: t.name }))] }] : []),
        { name: 'title', label: 'Title', required: true, full: true, placeholder: 'e.g. Typhoon Signal No. 1: stay alert' },
        { name: 'body', label: 'Message', type: 'textarea', max: 280, required: true, full: true, placeholder: 'Write your message for residents (max 280 characters)' },
        { name: 'category', label: 'Category', type: 'select', options: [{ value: 'alert', label: 'Alert' }, { value: 'advisory', label: 'Advisory' }, { value: 'event', label: 'Event' }], full: true },
      ],
    });
    if (!form) return;
    const n = stats.residents || 0;
    if (!(await EH.confirmBox(`Send to ${n.toLocaleString()} resident${n === 1 ? '' : 's'}?`, `“${form.title}” will be sent right away and cannot be recalled.`, 'Send now', false))) return;
    try { await api('/admin/announcements', { method: 'POST', body: { title: form.title, body: form.body, category: form.category } }); EH.toast(`Announcement sent to ${n.toLocaleString()} resident${n === 1 ? '' : 's'}`, 'ok'); load().catch(() => {}); } catch (e) { fail(e); }
  });
  $('#qaResp').addEventListener('click', async () => {
    const st = last.settings || await api('/admin/settings');
    const teams = (st.teams || []).map((t) => t.name);
    const out = await EH.modal({
      title: 'Add responder', sub: 'Responders appear in dispatch lists (Database → Responders).', submit: 'Add responder',
      fields: [
        { name: 'name', label: 'Full name', required: true, full: true, placeholder: 'Responder name' },
        { name: 'contact', label: 'Contact number', placeholder: '09XX XXX XXXX' },
        teams.length ? { name: 'team', label: 'Team', type: 'select', options: [{ value: '', label: 'Select team' }, ...teams] } : { name: 'team', label: 'Team', placeholder: 'e.g. Team A' },
        { name: 'role', label: 'Role', placeholder: 'e.g. Medic, Tanod' },
        { name: 'availability', label: 'Availability', type: 'select', options: [{ value: 'available', label: 'Available' }, { value: 'oncall', label: 'On call' }, { value: 'off', label: 'Off duty' }] },
      ],
      onSubmit: async (v) => { const cur = await api('/admin/settings'); await api('/admin/settings', { method: 'PUT', body: { responders: [...(cur.responders || []), v] } }); return v; },
    });
    if (out) EH.toast(`${out.name} added`, 'ok');
  });
  $('#exportToday').addEventListener('click', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const out = await EH.modal({
      title: 'Export daily report', sub: 'Includes the reports filed on that day. Exports are access-logged.', submit: 'Export',
      fields: [
        { name: 'date', label: 'Date', type: 'date', value: today, required: true, full: true },
        { name: 'format', label: 'Format', type: 'select', options: [{ value: 'pdf', label: 'PDF (opens print dialog – choose “Save as PDF”)' }, { value: 'csv', label: 'CSV (opens in Excel)' }], full: true },
        { name: 'reports', label: 'Reports', type: 'checkbox', value: true },
        { name: 'log', label: 'Activity log (what staff did that day)', type: 'checkbox', value: true },
      ],
    });
    if (!out) return;
    const day = (iso) => new Date(iso).toLocaleDateString('en-CA');
    const reports = (last.reports || []).filter((r) => day(r.createdAt) === out.date);
    const feed = out.log ? (await api('/admin/feed')).items.filter((a) => day(a.at) === out.date) : [];
    if (!(out.reports && reports.length) && !feed.length) return EH.toast('Nothing to export for that day.');
    const head = ['ID', 'Type', 'Urgency', 'Status', 'Location', 'Reported', 'Assigned to'];
    const rows = out.reports ? reports.map((r) => [r.id, r.type, r.urgency, r.status, r.locationText, new Date(r.createdAt).toLocaleString(), r.assignedTo]) : [];
    if (out.format === 'csv') {
      EH.downloadCsv(`daily-report-${out.date}.csv`, [head, ...rows, ...(feed.length ? [[], ['Activity log'], ...feed.map((a) => [new Date(a.at).toLocaleTimeString(), a.text])] : [])]);
    } else {
      const w = window.open('', '_blank'); if (!w) return EH.toast('Allow pop-ups to open the report.');
      const t = (arr) => arr.map((c) => `<td>${esc(c)}</td>`).join('');
      w.document.write(`<!doctype html><meta charset="utf-8"><title>Daily report ${esc(out.date)}</title><style>body{font:13px system-ui;margin:28px}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin:10px 0 24px}td,th{border:1px solid #ccc;padding:5px 8px;text-align:left}th{background:#f3f3f3}</style>
        <h1>Emergency Hub · Daily report · ${esc(out.date)}</h1><p>${esc(((last.settings || {}).barangay || {}).name ? 'Barangay ' + last.settings.barangay.name : '')} · ${reports.length} report(s)</p>
        ${out.reports ? `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${t(r)}</tr>`).join('')}</table>` : ''}
        ${feed.length ? `<h2 style="font-size:15px">Activity log</h2><table>${feed.map((a) => `<tr>${t([new Date(a.at).toLocaleTimeString(), a.text])}</tr>`).join('')}</table>` : ''}<script>onload=()=>print()<\/script>`);
      w.document.close();
    }
    api('/admin/log-export', { method: 'POST', body: { what: 'daily report ' + out.date, count: reports.length, format: out.format } }).catch(() => {});
  });
  $('#refreshBtn').addEventListener('click', async () => {
    const b = $('#refreshBtn'); b.disabled = true; b.classList.add('is-busy');
    try { await load(); } catch { $('#liveErr').hidden = false; } finally { b.disabled = false; b.classList.remove('is-busy'); }
  });
  $('#liveRetry').addEventListener('click', () => load().catch(() => { $('#liveErr').hidden = false; }));
  setInterval(() => load().catch(() => { $('#liveErr').hidden = false; }), 30000);
})();
