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

    // Status of the reports filed in the last 7 days, so the donut adds up to the number at the top of the card.
    // Colour carries one idea: red shades = still needs action, dark/grey = finished.
    const ST = [['NEW', 'New'], ['VERIFIED', 'Verified'], ['DISPATCHED', 'Dispatched'], ['RESOLVED', 'Resolved'], ['REJECTED', 'Rejected']];
    const wk = reports.filter((r) => at(r) >= days[0]);
    const by = (s) => wk.filter((r) => r.status === s).length;
    const R = 46, C = 2 * Math.PI * R, GAP = 2.2, parts = ST.map(([s, l]) => ({ s, l, n: by(s) }));
    let acc = 0;
    const arcs = parts.filter((p) => p.n).map((p) => {
      const len = (p.n / total) * C, solid = parts.filter((q) => q.n).length > 1 ? Math.max(len - GAP, 0.5) : len, off = -acc; acc += len;
      return `<circle class="wk-arc wk-${p.s.toLowerCase()}" cx="60" cy="60" r="${R}" fill="none" stroke-width="16" stroke-dasharray="${solid.toFixed(2)} ${(C - solid).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 60 60)"><title>${p.l}: ${p.n}</title></circle>`;
    }).join('');
    $('#statusDonut').innerHTML = `<svg viewBox="0 0 120 120" role="img" aria-label="${total ? parts.filter((p) => p.n).map((p) => `${p.n} ${p.l.toLowerCase()}`).join(', ') : 'No reports this week'}"><circle class="wk-track" cx="60" cy="60" r="${R}" fill="none" stroke-width="16"/>${total ? arcs : ''}<text x="60" y="58" text-anchor="middle" class="wk-n">${total}</text><text x="60" y="74" text-anchor="middle" class="wk-l">this week</text></svg>`;
    $('#statusLegend').innerHTML = parts.map((p) => `<li class="${p.n ? '' : 'is-zero'}"><i class="wk-${p.s.toLowerCase()}"></i><span>${p.l}</span><b>${p.n}</b><em>${total ? Math.round((p.n / total) * 100) : 0}%</em></li>`).join('');

    const open = reports.filter((r) => ['NEW', 'VERIFIED', 'DISPATCHED'].includes(r.status));
    const rows = [
      ['i-warn', 'High or critical urgency', 'Open reports to prioritise', open.filter((r) => ['High', 'Critical'].includes(r.urgency)).length, 'reports.html'],
      ['i-users', 'No team assigned', 'Active reports without a responder', open.filter((r) => r.status !== 'NEW' && !r.assignedTo).length, 'reports.html'],
      ['i-clock', 'Waiting over 24 hours', 'Reports not yet verified', reports.filter((r) => r.status === 'NEW' && now - at(r) > DAY).length, 'reports.html'],
      ['i-shield', 'Centers above 85% full', 'Open evacuation centers', centers.filter((c) => c.status === 'open' && c.capacity && c.occupied / c.capacity >= 0.85).length, 'database.html#centers'],
    ];
    $('#attention').innerHTML = rows.map(([ic, t, s, n, href]) => `<a class="attn__row${n ? '' : ' is-zero'}" href="${href}"><span class="attn__ico">${icon(ic)}</span><span class="attn__txt">${t}<small>${s}</small></span><span class="attn__n">${n}</span></a>`).join('');
  }

  // ---------------------------------------------------------------- projected incidents (model: forecast.js)
  const fc = { scope: 'all', horizon: 7, res: null };
  const SCOPE_LABEL = { all: 'All reports', incident: 'Incidents', hazard: 'Hazards' };
  const OUTLOOK = { higher: ['red', 'Higher than usual'], usual: ['gray', 'About usual'], lower: ['green', 'Lower than usual'], unknown: ['gray', 'Not enough data'] };
  const dayLabel = (ts, o) => new Date(ts).toLocaleDateString(undefined, o || { month: 'short', day: 'numeric' });

  // Inline SVG: bars = reports so far (last 28 days), dashed line + shaded band = projection and its 80% range.
  function chartSvg(res, width) {
    const W = Math.max(300, Math.floor(width)), H = W < 520 ? 210 : 250;
    const m = { t: 14, r: 10, b: 26, l: 28 };
    const hist = res.history, fut = res.forecast, nH = hist.length, N = nH + fut.length;
    const rawMax = Math.max(1, ...hist.map((d) => d.v), ...fut.map((d) => d.hi));
    const step = Math.max(1, Math.ceil(rawMax / 4)), yMax = step * Math.max(2, Math.ceil(rawMax / step));
    const iw = W - m.l - m.r, ih = H - m.t - m.b, cw = iw / N, bw = Math.max(2, Math.min(18, cw * 0.62));
    const X = (i) => m.l + (i + 0.5) * cw, Y = (v) => m.t + ih - (v / yMax) * ih, base = Y(0);
    const f1 = (x) => Math.round(x * 10) / 10;
    let s = `<svg class="fc-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`Reports per day for the last ${nH} days and the projection for the next ${fut.length} days. Expected about ${Math.round(res.total.pred)} reports, likely range ${res.total.lo} to ${res.total.hi}.`)}">`;
    for (let v = 0; v <= yMax; v += step) s += `<line class="fc-grid" x1="${m.l}" x2="${W - m.r}" y1="${f1(Y(v))}" y2="${f1(Y(v))}"/><text class="fc-axis" x="${m.l - 6}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${v}</text>`;
    hist.forEach((d, i) => { if (d.v) s += `<rect class="fc-bar" x="${f1(X(i) - bw / 2)}" y="${f1(Y(d.v))}" width="${f1(bw)}" height="${f1(base - Y(d.v))}" rx="2"/>`; });
    const up = fut.map((d, k) => `${f1(X(nH + k))},${f1(Y(Math.min(d.hi, yMax)))}`), lo = fut.map((d, k) => `${f1(X(nH + k))},${f1(Y(d.lo))}`).reverse();
    s += `<polygon class="fc-band" points="${up.join(' ')} ${lo.join(' ')}"/>`;
    s += `<polyline class="fc-line" fill="none" points="${fut.map((d, k) => `${f1(X(nH + k))},${f1(Y(d.pred))}`).join(' ')}"/>`;
    if (fut.length <= 14) fut.forEach((d, k) => { s += `<circle class="fc-dot" cx="${f1(X(nH + k))}" cy="${f1(Y(d.pred))}" r="3"/>`; });
    const tx = m.l + nH * cw;
    s += `<line class="fc-today" x1="${f1(tx)}" x2="${f1(tx)}" y1="${m.t - 4}" y2="${base}"/><text class="fc-todaylbl" x="${f1(tx + 5)}" y="${m.t + 6}">Projection →</text>`;
    const every = Math.ceil(N / (W < 520 ? 5 : 9));
    for (let i = 0; i < N; i++) {
      if (i % every || Math.abs(i - nH) < Math.max(2, every / 2)) continue;
      s += `<text class="fc-axis" x="${f1(X(i))}" y="${H - 8}" text-anchor="middle">${dayLabel(i < nH ? hist[i].ts : fut[i - nH].ts)}</text>`;
    }
    s += `<text class="fc-axis fc-axis--b" x="${f1(X(nH))}" y="${H - 8}" text-anchor="middle">Today</text>`;
    const tip = { weekday: 'short', month: 'short', day: 'numeric' };
    hist.forEach((d, i) => { s += `<rect class="fc-hit" x="${f1(m.l + i * cw)}" y="${m.t}" width="${f1(cw)}" height="${f1(ih)}"><title>${dayLabel(d.ts, tip)}: ${d.v} report${d.v === 1 ? '' : 's'}</title></rect>`; });
    fut.forEach((d, k) => { s += `<rect class="fc-hit" x="${f1(m.l + (nH + k) * cw)}" y="${m.t}" width="${f1(cw)}" height="${f1(ih)}"><title>${dayLabel(d.ts, tip)}: about ${d.pred} expected (range ${Math.round(d.lo)} to ${Math.round(d.hi)})</title></rect>`; });
    return s + '</svg>';
  }
  function paintChart() {
    const host = $('#fcChart'), r = fc.res;
    if (r && r.ok) host.innerHTML = chartSvg(r, host.clientWidth || 640);
  }
  function renderForecast() {
    if (!window.Forecast) return;
    const res = fc.res = Forecast.run(last.reports || [], { scope: fc.scope, horizon: fc.horizon });
    [['#fcScope', fc.scope], ['#fcHorizon', String(fc.horizon)]].forEach(([id, v]) => $(id).querySelectorAll('button').forEach((b) => { const on = b.dataset.v === v; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }));
    const ok = res.ok, H = fc.horizon;
    $('#fcExport').disabled = !ok;
    $('#fcLegend').hidden = !ok; $('#fcReadBox').hidden = !ok; $('#fcHow').hidden = !ok;
    if (!ok) {
      $('#fcSub').textContent = 'Forecast based on your report history';
      $('#fcChart').innerHTML = `<div class="empty"><b>${res.reason === 'empty' ? 'No reports to learn from yet' : 'Not enough history to project yet'}</b>${res.reason === 'empty'
        ? `There are no ${{ all: 'reports', incident: 'incident reports', hazard: 'hazard reports' }[fc.scope]} recorded yet. The projection appears automatically once reports come in.`
        : `Projections need at least 7 days of reports. So far there ${res.historyDays === 1 ? 'is 1 day' : `are ${res.historyDays} days`} of history (${res.reportCount} report${res.reportCount === 1 ? '' : 's'}).`}</div>`;
      $('#fcKpis').innerHTML = ''; $('#fcMix').hidden = true;
      return;
    }
    $('#fcSub').textContent = `Based on ${res.historyReports} report${res.historyReports === 1 ? '' : 's'} over the last ${res.historyDays} days · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    paintChart();
    const t = res.total, [tone, outTxt] = OUTLOOK[res.outlook.risk];
    const tile = (l, v, n) => `<div class="fc-kpi"><p class="fc-kpi__l">${l}</p><p class="fc-kpi__v">${v}</p><p class="fc-kpi__n">${n}</p></div>`;
    $('#fcKpis').innerHTML =
      tile(`Expected, next ${H} days`, `~${Math.round(t.pred)}`, `Likely ${t.lo} to ${t.hi}`) +
      tile('Compared with usual', `<span class="pill pill--${tone}">${outTxt}</span>`, `Usual: about ${Math.round(res.outlook.usual)} per ${H} days`) +
      tile('Confidence', esc(res.confidence.level), `${res.historyDays} days · ${res.historyReports} reports`) +
      tile('Busiest day', res.peakDay ? esc(res.peakDay.day) : '–', res.peakDay ? `About ${res.peakDay.avg} a day` : 'No clear weekly pattern yet');
    $('#fcRead').innerHTML = Forecast.describe(res).map((l) => `<li>${esc(l)}</li>`).join('');
    const mix = $('#fcMix');
    mix.hidden = !res.mix.length;
    if (res.mix.length) {
      const top = Math.max(...res.mix.map((x) => x.share), 0.01);
      mix.innerHTML = `<p class="eyebrow">Expected by type, next ${H} days</p>` + res.mix.map((x) =>
        `<div class="fc-mix__row"><span class="fc-mix__l" title="${esc(x.type)}">${esc(x.type)}</span><span class="fc-mix__t"><i style="width:${Math.max(2, Math.round((x.share / top) * 100))}%"></i></span><b>~${x.expected}</b><small>${Math.round(x.share * 100)}%</small></div>`).join('') +
        '<p class="fc-mix__n">Split by how common each type was in the last 60 days. It is a share of the total, not a separate forecast per type.</p>';
    }
  }
  $('#fcScope').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { fc.scope = b.dataset.v; renderForecast(); } });
  $('#fcHorizon').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { fc.horizon = Number(b.dataset.v); renderForecast(); } });
  if (window.ResizeObserver) { let w = 0, t; new ResizeObserver(() => { const nw = $('#fcChart').clientWidth; if (nw && Math.abs(nw - w) > 4) { w = nw; clearTimeout(t); t = setTimeout(paintChart, 120); } }).observe($('#fcChart')); }
  $('#fcExport').addEventListener('click', () => {
    const r = fc.res; if (!r || !r.ok) return;
    const day = (ts) => new Date(ts).toLocaleDateString('en-CA');
    const rows = [
      ['Projected incidents', SCOPE_LABEL[fc.scope], `Next ${fc.horizon} days`], ['Generated', new Date().toLocaleString()], [],
      ['Summary'], ['Expected total', r.total.pred], ['Likely range (80%)', `${r.total.lo} to ${r.total.hi}`], ['Compared with usual', OUTLOOK[r.outlook.risk][1]], ['Usual for this period', r.outlook.usual], ['Confidence', r.confidence.level, r.confidence.why], [],
      ['Date', 'Expected', 'Low (80%)', 'High (80%)'], ...r.forecast.map((d) => [day(d.ts), d.pred, d.lo, d.hi]), [],
      ['Date', 'Reports (actual)'], ...r.history.map((d) => [day(d.ts), d.v]), [],
      ['Type', 'Share of last 60 days', `Expected, next ${fc.horizon} days`], ...r.mix.map((x) => [x.type, `${Math.round(x.share * 100)}%`, x.expected]), [],
      ['Reading'], ...Forecast.describe(r).map((l) => [l]), [],
      ['Method', 'Weekday-adjusted damped-trend exponential smoothing on daily report counts (rejected reports excluded). Planning guide only; it does not know about weather or events.'],
    ];
    EH.downloadCsv(`incident-forecast-${day(Date.now())}-${fc.horizon}d.csv`, rows);
    api('/admin/log-export', { method: 'POST', body: { what: `incident forecast (${SCOPE_LABEL[fc.scope].toLowerCase()}, ${fc.horizon} days)`, count: r.historyReports, format: 'csv' } }).catch(() => {});
  });

  // ---------------------------------------------------------------- what the data says (reports, blockages, centers, announcements: interpret.js)
  const IN_ICON = { reports: 'i-file', blockages: 'i-block', centers: 'i-shield', announcements: 'i-mega' };
  function renderInterpret() {
    const out = Interpret.run({ reports: last.reports, blockages: last.blockages, centers: last.centers, announcements: last.announcements, now: Date.now() });
    $('#inLead').textContent = out.lead;
    $('#inAsOf').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('#inGrid').innerHTML = out.groups.map((g) => `<section class="in__group in__group--${g.status}">
      <header><span class="in__ico">${icon(IN_ICON[g.id])}</span><h3>${esc(g.title)}</h3><span class="in__tag in__tag--${g.status}">${esc(g.statusLabel)}</span></header>
      ${g.headline ? `<p class="in__head">${esc(g.headline)}</p>` : ''}
      ${g.items.length ? `<ul>${g.items.map((i) => `<li class="in__i in__i--${i.level}"><i aria-hidden="true"></i><span>${esc(i.text)}</span></li>`).join('')}</ul>` : '<p class="in__na">This could not be loaded just now. Try the refresh button.</p>'}
      <a class="in__link" href="${esc(g.href)}">Open ${esc(g.title.toLowerCase())}${icon('i-chev-r')}</a></section>`).join('');
  }

  // ---------------------------------------------------------------- live-map pins (dashboard only; the full Incident Map keeps EH.marker)
  // Shape says the kind as well as colour: incident = red dot, hazard = dark diamond, evacuation center = white shield.
  const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
  const TIP = { direction: 'top', offset: [0, -12], className: 'eh-tip', opacity: 1 };
  const tip = (title, sub) => `<b>${esc(title || '')}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  function pin(layer, lat, lng, kind, urgent) {
    const inner = kind === 'center' ? SHIELD : kind === 'hazard' ? '<b>!</b>' : '<b></b>';
    return L.marker([lat, lng], {
      keyboard: false, riseOnHover: true,
      icon: L.divIcon({ className: 'eh-pin-host', html: `<div class="eh-pin eh-pin--${kind}${urgent ? ' is-urgent' : ''}">${inner}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
    }).addTo(layer);
  }

  async function load() {
    const [stats, reports, centers, settings, blockages, announcements] = await Promise.all([api('/admin/stats'), api('/admin/reports'), api('/centers'), api('/admin/settings'),
      api('/admin/blockages').catch(() => null), api('/announcements').catch(() => null)]);   // these two only feed the "What the data says" section, so a failure must not break the page
    last = { stats, reports, settings, centers, blockages, announcements };
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
    try { renderForecast(); } catch (e) { console.warn('Forecast unavailable', e); }
    try { renderInterpret(); } catch (e) { console.warn('Interpretation unavailable', e); }

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
      const pts = [], n = { incident: 0, hazard: 0, center: 0 };
      reports.filter((r) => ['NEW', 'VERIFIED', 'DISPATCHED'].includes(r.status) && r.lat != null).forEach((r) => {
        const kind = r.kind === 'hazard' ? 'hazard' : 'incident', urgent = r.urgency === 'High' || r.urgency === 'Critical';
        pin(layer, r.lat, r.lng, kind, urgent).bindTooltip(tip(r.type, [r.locationText, r.urgency, r.createdAt ? ago(r.createdAt) : ''].filter(Boolean).join(' · ')), TIP);
        pts.push([r.lat, r.lng]); n[kind]++;
      });
      centers.filter((c) => c.lat != null).forEach((c) => {
        pin(layer, c.lat, c.lng, 'center', false).bindTooltip(tip(c.name, c.capacity ? `${c.occupied || 0} of ${c.capacity} in use · ${c.status}` : c.status), TIP);
        pts.push([c.lat, c.lng]); n.center++;
      });
      $('#mkI').textContent = n.incident; $('#mkH').textContent = n.hazard; $('#mkC').textContent = n.center;
      if (pts.length) map.fitBounds(pts, { padding: [56, 56], maxZoom: 16 }); else map.setView([settings.mapCenter.lat, settings.mapCenter.lng], 15);
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
