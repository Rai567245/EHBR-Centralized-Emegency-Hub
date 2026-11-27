'use strict';
(async () => {
  if (!EH.init()) return;
  const { $, $$, esc, api, ago, fail, toast, modal, confirmBox } = EH;
  const API = '/admin/report-generator';
  const ico = (n) => `<svg class="icon"><use href="#${n}"/></svg>`;

  let historyItems = [], meta = null, timer = null, reqId = 0, doc = null, exporting = false, tab = 'generate';
  const state = { category: 'incident-summary', pType: 'month', date: '', from: '', to: '', filters: {}, includeLocation: false };

  const FILTER_LABEL = { types: 'Type', urgencies: 'Urgency', statuses: 'Status', sources: 'Source', zones: "Reporter's zone", team: 'Assigned team', reasons: 'Reason', blockStatus: 'Blockage status', annCategories: 'Announcement category' };
  const OPTION_TEXT = { sources: { resident: 'Resident-submitted', admin: 'Admin-created' }, blockStatus: { active: 'Active', expired: 'Expired' } };
  const optText = (key, v) => (OPTION_TEXT[key] && OPTION_TEXT[key][v]) || v;
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const isNum = (c) => ['int', 'pct', 'num', 'minutes'].includes(c.type);
  const catOf = (id) => meta.categories.find((c) => c.id === id);
  // the top bar stays on screen while scrolling, so sticky parts of this page must sit below it
  const topbar = document.querySelector('.topbar');
  const setTop = () => { const fixed = topbar && ['sticky', 'fixed'].includes(getComputedStyle(topbar).position); document.documentElement.style.setProperty('--rg-top', (fixed ? Math.round(topbar.getBoundingClientRect().height) : 0) + 'px'); };
  setTop(); window.addEventListener('resize', setTop);

  // ------------------------------------------------------------- configuration panel
  function drawCategory() {
    $('#cat').innerHTML = meta.categories.map((c) => `<option value="${esc(c.id)}"${c.id === state.category ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
    $('#catDesc').textContent = catOf(state.category).desc;
    syncPeriodStep();
  }
  // A forecast looks ahead from today, so there is no period to choose.
  function syncPeriodStep() { const el = $('#periodStep'); if (el) el.hidden = !!catOf(state.category).noPeriod; }
  function drawPeriod() {
    $$('#seg button').forEach((b) => { const on = b.dataset.p === state.pType; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    const t = state.pType, d = state.date;
    $('#pInputs').innerHTML =
      t === 'day' ? `<input class="input" type="date" id="pDate" value="${esc(d)}" aria-label="Day">` :
      t === 'week' ? `<input class="input" type="date" id="pDate" value="${esc(d)}" aria-label="Any day in the week"><p class="rg__desc">Pick any day. The report covers that week, Monday to Sunday.</p>` :
      t === 'month' ? `<input class="input" type="month" id="pMonth" value="${esc(d.slice(0, 7))}" aria-label="Month">` :
      t === 'year' ? `<input class="input" type="number" id="pYear" min="2000" max="2100" step="1" value="${esc(d.slice(0, 4))}" aria-label="Year">` :
      `<div class="rg-two"><div><label for="pFrom">From</label><input class="input" type="date" id="pFrom" value="${esc(state.from)}"></div><div><label for="pTo">To (included)</label><input class="input" type="date" id="pTo" value="${esc(state.to)}"></div></div>`;
  }
  function drawFilters() {
    const cat = catOf(state.category);
    $('#filtersStep').hidden = !cat.filters.length;
    $('#filters').innerHTML = cat.filters.map((key) => {
      const opts = meta.options[key] || [], cur = state.filters[key];
      if (key === 'team') return `<div class="rg-filter"><div class="rg-filter__t"><span>${FILTER_LABEL[key]}</span></div><select class="sel" data-f="team" aria-label="${FILTER_LABEL[key]}"><option value="">All teams</option>${opts.map((o) => `<option${cur === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
      const sel = Array.isArray(cur) ? cur : [];
      return `<div class="rg-filter"><div class="rg-filter__t"><span>${FILTER_LABEL[key]}</span>${sel.length ? `<button type="button" data-clear="${key}">Clear</button>` : '<span style="font-weight:400;color:var(--muted);font-size:11.5px">All</span>'}</div>
        <div class="rg-checks" data-f="${key}">${opts.length ? opts.map((o) => `<label><input type="checkbox" value="${esc(o)}"${sel.includes(o) ? ' checked' : ''}>${esc(optText(key, o))}</label>`).join('') : '<span class="rg__desc" style="margin:4px">No values recorded yet</span>'}</div></div>`;
    }).join('');
    const detail = cat.detail && meta.can.detail;
    $('#optStep').hidden = !detail; if (!detail) { state.includeLocation = false; $('#optLoc').checked = false; }
  }
  const config = () => {
    const period = { type: state.pType, date: state.date, from: state.from, to: state.to };
    const filters = {}; for (const [k, v] of Object.entries(state.filters)) if ((Array.isArray(v) && v.length) || (typeof v === 'string' && v)) filters[k] = v;
    return { category: state.category, period, filters, includeLocation: state.includeLocation };
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(preview, 300); };
  // An unfinished period (a half-typed year, an empty date, start after end) is caught here, so it shows a hint instead of a server error.
  function periodProblem() {
    if (catOf(state.category).noPeriod) return '';
    const t = state.pType;
    if (t === 'custom') {
      if (!state.from || !state.to) return 'Choose both a start date and an end date.';
      if (state.from > state.to) return 'The start date is after the end date.';
    } else if (!state.date) return t === 'year' ? 'Type a four-digit year, for example 2026.' : 'Choose a date for the report period.';
    return '';
  }
  const announce = (text) => { const s = $('#rgStatus'); if (s) s.textContent = text; };
  // Update only the "Clear / All" label of one filter. A full redraw would reset the list's scroll position and drop keyboard focus from the checkbox.
  function syncFilterHeader(wrap, key) {
    const t = wrap && wrap.querySelector('.rg-filter__t'); if (!t) return;
    [...t.children].slice(1).forEach((x) => x.remove());
    t.insertAdjacentHTML('beforeend', (state.filters[key] || []).length ? `<button type="button" data-clear="${key}">Clear</button>` : '<span style="font-weight:400;color:var(--muted);font-size:11.5px">All</span>');
  }

  // ------------------------------------------------------------- pagination (one section per page, plus paging inside the long report list)
  const pages = new Map(); // block key -> current page; cleared whenever a new preview arrives
  const PAGE_ROWS = 10, PAGE_CARDS = 5;
  function paginate(box, key, items, size, tail) {
    const old = box.querySelector(':scope > .rg-pager'); if (old) old.remove();
    items.forEach((r) => { r.style.display = ''; }); if (tail) tail.style.display = '';
    const n = Math.max(1, Math.ceil(items.length / size));
    if (n < 2) return;
    const p = Math.min(Math.max(pages.get(key) || 0, 0), n - 1); pages.set(key, p);
    items.forEach((r, i) => { r.style.display = i >= p * size && i < (p + 1) * size ? '' : 'none'; });
    if (tail) tail.style.display = p === n - 1 ? '' : 'none';
    box.insertAdjacentHTML('beforeend', `<div class="rg-pager" data-key="${key}"><button type="button" data-pg="prev"${p === 0 ? ' disabled' : ''}>&lsaquo; Prev</button><span>${p + 1} of ${n}</span><button type="button" data-pg="next"${p === n - 1 ? ' disabled' : ''}>Next &rsaquo;</button></div>`);
  }
  function setupPagers() {
    // 1) the long list of matching reports pages its own rows
    Array.from($$('#result .rg-sec--list .table-card')).forEach((card) => {
      const rows = Array.from(card.querySelectorAll('tbody tr:not(.rg-total)'));
      rows.forEach((r) => { r.style.display = ''; });
      const probe = rows[0] && rows[0].querySelector('td[data-label]'), th = card.querySelector('thead');
      const stacked = (!!probe && getComputedStyle(probe).display !== 'table-cell') || (!!th && getComputedStyle(th).display === 'none') || (card.clientWidth > 0 && card.clientWidth < 560);
      paginate(card, 'list', rows, stacked ? PAGE_CARDS : PAGE_ROWS, null);
    });
    // 2) overall: one report section per page (chart + table together)
    const box = $('#result .rg-secs');
    if (box) paginate(box, 'sec', Array.from(box.children).filter((x) => x.classList.contains('rg-sec')), 1, null);
  }

  // ------------------------------------------------------------- preview
  const table = (cols, cells, total, wide = false) => `<div class="table-card db__card"><div class="db__scroll"><table class="tbl${wide ? ' rg-table--wide' : ''}"><thead><tr>${cols.map((c) => `<th${isNum(c) ? ' class="rg-num"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${cells.map((r) => `<tr>${r.map((v, i) => `<td${i ? ` data-label="${esc(cols[i].label)}"` : ''}${isNum(cols[i]) ? ' class="rg-num"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}${total ? `<tr class="rg-total">${total.map((v, i) => `<td${i ? ` data-label="${esc(cols[i].label)}"` : ''}${isNum(cols[i]) ? ' class="rg-num"' : ''}>${esc(v)}</td>`).join('')}</tr>` : ''}</tbody></table></div></div>`;
  function chart(c) {
    if (!c || !c.items.length) return '';
    const max = Math.max(...c.items.map((i) => i.value), 1);
    if (c.type === 'column') {
      const step = Math.max(1, Math.ceil(c.items.length / 12));
      return `<div class="rg-cols" role="img" aria-label="${esc(c.unit)}">${c.items.map((i, k) => `<div class="rg-col" title="${esc(i.label)}: ${esc(i.display)}"><span class="rg-col__v">${c.items.length <= 16 && i.value ? i.value : ''}</span><i style="height:${(i.value / max) * 100}%"></i>${k % step === 0 ? `<span class="rg-col__l">${esc(i.label)}</span>` : ''}</div>`).join('')}</div><p class="rg-unit">${esc(c.unit)}</p>`;
    }
    return `<div class="rg-bars">${c.items.slice(0, 14).map((i) => `<div class="rg-bar"><span class="rg-bar__l" title="${esc(i.label)}">${esc(i.label)}</span><span class="rg-bar__t"><i style="width:${(i.value / max) * 100}%"></i></span><b>${esc(i.display)}</b></div>`).join('')}</div><p class="rg-unit">${esc(c.unit)}</p>`;
  }
  function renderDoc(d) {
    const can = meta.can, off = d.empty || !can.export || exporting;
    const fmtBtn = (f, label) => `<button class="btn btn--sm${f === 'pdf' ? ' btn--primary' : ''}" type="button" data-fmt="${f}"${off ? ' disabled' : ''} title="${f === 'csv' ? 'CSV: ' + esc(catOf(d.category).csv) : ''}">${ico('i-dl')}${label}</button>`;
    const chips = [['Period', d.period.label], ...d.filters, ['Time zone', `${d.tz} (${d.tzOffset})`], ['Records', d.matching.toLocaleString()]].map(([k, v]) => `<span class="rg-chip"><b>${esc(k)}:</b> ${esc(v)}</span>`).join('');
    let h = `<div class="rg-head"><div><h2>${esc(d.title)}</h2><p>${esc(d.barangay)} · ${esc(d.period.label)}</p></div><div class="rg-export">${can.export ? fmtBtn('pdf', 'PDF') + fmtBtn('xlsx', 'Excel') + fmtBtn('csv', 'CSV') : '<span class="rg__desc">You can preview reports but not export them.</span>'}</div></div><div class="rg-chips">${chips}</div>`;
    if (d.empty && (catOf(state.category) || {}).noPeriod) h += `<div class="rg-empty"><b>No forecast yet</b><span>${esc((d.notes || [])[0] || 'There is not enough report history.')} No file can be exported until a forecast can be made.</span></div>`;
    else if (d.empty) h += '<div class="rg-empty"><b>No records match</b><span>Nothing was recorded for this period and these filters. Try a longer period or remove a filter. No file can be exported for an empty report.</span></div>';
    if (d.summary.length) h += `<div class="rg-cards">${d.summary.map((c) => `<div class="rg-card"><p class="rg-card__l">${esc(c.label)}</p><p class="rg-card__v">${esc(c.value)}</p>${c.note ? `<p class="rg-card__n">${esc(c.note)}</p>` : ''}</div>`).join('')}</div>`;
    if (d.notes.length) h += `<div class="rg-note"><b>Data notes</b><ul>${d.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`;
    if (!d.empty) {
      h += '<div class="rg-secs">';
      for (const s of d.sections) h += `<div class="rg-sec"><h3>${esc(s.title)}</h3>${s.note ? `<p>${esc(s.note)}</p>` : ''}${chart(s.chart)}${s.cells.length ? table(s.columns, s.cells, s.total) : '<p>No rows for this section.</p>'}</div>`;
      if (d.list) h += `<div class="rg-sec rg-sec--list"><h3>${esc(d.list.title)}</h3><p>${d.list.total > d.list.cells.length ? `Showing the first ${d.list.cells.length.toLocaleString()} of ${d.list.total.toLocaleString()} rows. The exported file has them all.` : `${d.list.total.toLocaleString()} row(s).`}</p>${table(d.list.columns, d.list.cells, null, true)}</div>`;
      h += '</div>';
    }
    if (d.definitions.length) h += `<details class="rg-defs"><summary>What these numbers mean</summary><dl>${d.definitions.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>`;
    $('#result').innerHTML = h;
    setupPagers();
    announce(d.empty ? 'No records match this period and these filters.' : `Preview updated: ${d.matching.toLocaleString()} records.`);
  }
  async function preview() {
    const id = ++reqId, box = $('#result');
    const problem = periodProblem();
    if (problem) { doc = null; box.classList.remove('rg-loading'); box.innerHTML = `<div class="rg-note rg-note--blue"><b>Finish choosing the period</b>${esc(problem)}</div>`; announce(problem); return; }
    box.classList.add('rg-loading');
    try {
      const d = await api(`${API}/preview`, { method: 'POST', body: { config: config() } });
      if (id !== reqId) return;
      doc = d; pages.clear(); renderDoc(d);
    } catch (e) {
      if (id !== reqId) return;
      doc = null; box.innerHTML = `<div class="rg-note rg-note--red"><b>This report cannot be built yet</b>${esc(e.message || 'Something went wrong.')}</div>`; announce('The report could not be built. ' + (e.message || ''));
    } finally { if (id === reqId) box.classList.remove('rg-loading'); }
  }

  // ------------------------------------------------------------- export
  function startDownload(url, name) { const a = document.createElement('a'); a.href = url; a.download = name || ''; document.body.appendChild(a); a.click(); a.remove(); }
  async function exportAs(fmt) {
    if (exporting) return;
    const cfg = config(), body = (password) => ({ config: cfg, format: fmt, ...(password ? { password } : {}) });
    exporting = true; if (doc) renderDoc(doc);
    try {
      let res;
      if (cfg.includeLocation) {
        res = await modal({
          title: 'Include location details?', danger: true, submit: 'Generate file',
          sub: 'This file will contain location text typed by reporters, which can include home addresses. It will be marked CONFIDENTIAL and the export is recorded in the audit log. Enter your password to continue.',
          fields: [{ name: 'password', label: 'Your password', type: 'password', required: true, full: true }],
          onSubmit: (v) => api(`${API}/generate`, { method: 'POST', body: body(v.password) }),
        });
        if (!res) return;
      } else res = await api(`${API}/generate`, { method: 'POST', body: body() });
      startDownload(res.url, res.filename); toast(`${res.formatLabel} report created`, 'ok'); loadHistory();
    } catch (e) { fail(e); } finally { exporting = false; if (doc) renderDoc(doc); }
  }

  // ------------------------------------------------------------- history + audit
  async function loadHistory() {
    try {
      const { items } = await api(`${API}/history`);
      historyItems = items;
      $('#cHist').textContent = items.length;
      $('#histBody').innerHTML = items.map((m) => `<tr data-id="${esc(m.id)}"><td><div class="rg-first"><b>${esc(m.categoryLabel)}</b><span class="rg-sub">${esc(m.filters)}</span>${m.detailed ? '<span class="pill pill--red pill--sm">Confidential</span>' : ''}${m.status === 'failed' ? `<span class="rg-sub" style="color:#b42318">${esc(m.error || 'Failed')}</span>` : ''}</div></td>
        <td data-label="Period"><span class="rg-val">${esc(m.period)}<span class="rg-sub">${Number(m.matching || 0).toLocaleString()} record(s)</span></span></td><td data-label="Format"><span class="rg-val">${esc(m.formatLabel)}${m.encrypted ? '<span class="rg-sub">Encrypted</span>' : ''}</span></td>
        <td data-label="Generated"><span class="rg-val">${esc(when(m.createdAt))}<span class="rg-sub">${esc(m.createdBy)}</span></span></td><td data-label="Size">${m.status === 'completed' ? esc(bytes(Number(m.size) || 0)) : '—'}</td><td data-label="Expires">${esc(when(m.expiresAt))}</td>
        <td data-label="Actions" class="rg-actions-cell"><div class="rg-actions">${m.status === 'completed' && meta.can.download ? `<button class="btn btn--sm" type="button" data-act="dl">${ico('i-dl')}Download</button>` : ''}${meta.can.delete ? `<button class="x-btn" type="button" data-act="rm" title="Delete file" aria-label="Delete file">${ico('i-trash')}</button>` : ''}</div></td></tr>`).join('');
      $('#histEmpty').innerHTML = items.length ? '' : '<div class="empty"><b>Nothing generated yet</b>Files you export appear here until they expire.</div>';
      $('#histNote').textContent = `Generated files are kept for ${meta.retentionDays} days, then removed automatically. The audit log keeps the record that they were created.`;
    } catch (e) { $('#histEmpty').innerHTML = '<div class="empty empty--sm">Could not load the history.</div>'; }
  }
  $('#histBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('tr').dataset.id;
    if (b.dataset.act === 'dl') {
      try {
        const item = historyItems.find((m) => m.id === id) || {};
        const out = item.detailed
          ? await modal({ title: 'Confirm your password', submit: 'Download', sub: 'This file contains confidential location details. Enter your password to download it.', fields: [{ name: 'password', label: 'Your password', type: 'password', required: true, full: true }], onSubmit: (v) => api(`${API}/history/${id}/download-link`, { method: 'POST', body: { password: v.password } }) })
          : await api(`${API}/history/${id}/download-link`, { method: 'POST', body: {} });
        if (out && out.url) { startDownload(out.url, out.filename); toast('Download started', 'ok'); }
      } catch (x) { fail(x); }
    } else if (await confirmBox('Delete this file?', 'The generated file is removed. You can generate the report again at any time.', 'Delete')) {
      try { await api(`${API}/history/${id}/delete`, { method: 'POST', body: {} }); toast('File deleted', 'ok'); loadHistory(); } catch (x) { fail(x); }
    }
  });
  async function loadAudit() {
    if (!meta.can.audit) { $('#auditBody').innerHTML = ''; $('#auditEmpty').innerHTML = '<div class="empty empty--sm">You do not have permission to view the audit log.</div>'; return; }
    try {
      const { items } = await api(`${API}/audit`);
      const tone = (s) => (s === 'ok' ? 'green' : ['denied', 'failed'].includes(s) ? 'red' : 'amber');
      $('#auditBody').innerHTML = items.map((a) => `<tr><td style="white-space:nowrap">${esc(when(a.at))}</td><td data-label="Action">${esc(a.action)}</td><td data-label="File">${esc(a.id || '—')}</td><td data-label="By">${esc(a.by)}</td><td data-label="Result"><span class="pill pill--${tone(a.status)} pill--sm">${esc(a.status)}</span></td><td data-label="Details">${esc(a.detail || '—')}</td></tr>`).join('');
      $('#auditEmpty').innerHTML = items.length ? '' : '<div class="empty empty--sm">Nothing has been logged yet.</div>';
    } catch (e) { $('#auditEmpty').innerHTML = '<div class="empty empty--sm">Could not load the audit log.</div>'; }
  }

  // ------------------------------------------------------------- events
  $('#cat').addEventListener('change', (e) => { state.category = e.target.value; state.filters = {}; state.includeLocation = false; $('#optLoc').checked = false; $('#catDesc').textContent = catOf(state.category).desc; syncPeriodStep(); drawFilters(); schedule(); });
  $('#seg').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; state.pType = b.dataset.p; if (state.pType === 'custom' && !state.from) { state.from = state.date; state.to = state.date; } drawPeriod(); schedule(); });
  $('#presets').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (!b) return; state.pType = { today: 'day', week: 'week', month: 'month', year: 'year' }[b.dataset.preset]; state.date = meta.today; drawPeriod(); schedule(); });
  $('#pInputs').addEventListener('input', (e) => {
    const id = e.target.id, v = e.target.value;
    if (id === 'pDate') state.date = v; else if (id === 'pMonth') state.date = v ? `${v}-01` : ''; else if (id === 'pYear') state.date = /^\d{4}$/.test(v) ? `${v}-01-01` : '';
    else if (id === 'pFrom') state.from = v; else if (id === 'pTo') state.to = v; else return;
    schedule();
  });
  $('#filters').addEventListener('change', (e) => {
    const box = e.target.closest('[data-f]'); if (!box && !e.target.dataset.f) return;
    if (e.target.dataset.f === 'team') state.filters.team = e.target.value;
    else { const key = box.dataset.f; state.filters[key] = $$('input:checked', box).map((i) => i.value); syncFilterHeader(box.closest('.rg-filter'), key); }
    schedule();
  });
  $('#filters').addEventListener('click', (e) => { const b = e.target.closest('[data-clear]'); if (!b) return; delete state.filters[b.dataset.clear]; drawFilters(); schedule(); });
  $('#optLoc').addEventListener('change', (e) => { state.includeLocation = e.target.checked; schedule(); });
  $('#result').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pg]'); if (!b || b.disabled) return;
    const card = b.closest('.rg-pager').parentElement, key = b.closest('.rg-pager').dataset.key;
    pages.set(key, (pages.get(key) || 0) + (b.dataset.pg === 'next' ? 1 : -1)); setupPagers();
    if (card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start' });
  });
  if (window.ResizeObserver) { let w = 0; new ResizeObserver(() => { const nw = $('#result').clientWidth; if (nw !== w) { w = nw; setupPagers(); } }).observe($('#result')); }  // table <-> card layout switch changes the page size
  $('#result').addEventListener('click', (e) => { const b = e.target.closest('[data-fmt]'); if (b && !b.disabled) exportAs(b.dataset.fmt); });
  $('#tabs').addEventListener('click', (e) => { const a = e.target.closest('.tab'); if (!a) return; e.preventDefault(); history.replaceState(null, '', '#' + a.dataset.tab); showTab(a.dataset.tab); });
  function showTab(t) {
    tab = ['generate', 'history', 'audit'].includes(t) ? t : 'generate';
    $$('#tabs .tab').forEach((a) => a.classList.toggle('is-on', a.dataset.tab === tab));
    ['generate', 'history', 'audit'].forEach((n) => { $('#tab-' + n).hidden = n !== tab; });
    if (tab === 'history') loadHistory(); if (tab === 'audit') loadAudit();
  }

  // ------------------------------------------------------------- start
  try { meta = await api(`${API}/meta`); } catch (e) {
    $('#panel').hidden = true; $('#result').innerHTML = `<div class="rg-note rg-note--red"><b>Reports Generator unavailable</b>${esc(e.status === 403 ? 'You do not have permission to use this page.' : e.message || 'Could not load.')}</div>`; return;
  }
  state.date = meta.today;
  $('#tzNote').textContent = `Periods and times use ${meta.tz} (${meta.tzOffset}).`;
  if (meta.keyError) $('#result').insertAdjacentHTML('beforebegin', `<div class="rg-note rg-note--red">${esc(meta.keyError)} Files cannot be generated until this is fixed.</div>`);
  drawCategory(); drawPeriod(); drawFilters(); showTab(location.hash.slice(1)); preview(); loadHistory();
})();
