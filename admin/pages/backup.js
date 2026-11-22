'use strict';
(async () => {
  if (!EH.init()) return;
  const { $, $$, esc, api, ago, fail, toast, modal, confirmBox } = EH;
  const ico = (n) => `<svg class="icon"><use href="#${n}"/></svg>`;

  let data = { items: [], summary: null, operation: null, lastRestore: null, can: {} };
  const filt = { type: '', status: '', valid: '' };
  let page = 1, tab = 'history', pollTimer = null, wasRestoring = false, schedFilled = false, refill = false;
  const SIZE = 8;

  // ------------------------------------------------------------- formatting
  const bytes = (n) => {
    if (n == null) return 'Unavailable';
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
  };
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const TYPE = { manual: 'Manual', auto: 'Scheduled', 'pre-restore': 'Safety (pre-restore)' };
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const pill = (tone, text) => `<span class="pill pill--${tone} pill--sm">${esc(text)}</span>`;
  const statusPill = (m) => ({ completed: pill('green', 'Completed'), in_progress: pill('blue', 'In progress'), queued: pill('gray', 'Queued'), failed: pill('red', 'Failed') }[m.status] || pill('gray', m.status));
  const validPill = (m) => {
    if (m.status !== 'completed') return '<span class="muted">—</span>';
    const v = m.validation.status;
    return v === 'valid' ? pill('green', 'Valid') : v === 'invalid' ? pill('red', 'Invalid') : pill('amber', 'Not validated');
  };
  const scheduleText = (s) => (s.enabled ? `${s.frequency === 'weekly' ? `Weekly · ${DAYS[s.weekday]}` : 'Daily'} at ${s.time}` : 'Off');
  const phaseText = (op) => {
    const what = { backup: 'Creating a backup', validate: 'Validating a backup', restore: 'Restoring from a backup' }[op.op] || 'Working';
    return `${what}${op.phase && op.phase !== 'starting' ? ` – ${op.phase}` : ''}…`;
  };

  // ------------------------------------------------------------- rendering
  function drawCards() {
    const s = data.summary; if (!s) return;
    const last = s.lastSuccessful, att = s.lastAttempt, sch = s.schedule;
    const card = (icon, label, value, note) => `<div class="br-card"><p class="br-card__label">${ico(icon)}${esc(label)}</p><p class="br-card__value">${value}</p><p class="br-card__note">${note}</p></div>`;
    $('#cards').innerHTML = [
      card('i-check', 'Last successful backup', last ? esc(ago(last.createdAt)) : 'None yet', last ? `${esc(when(last.createdAt))} · ${esc(bytes(last.size))}` : 'Create your first backup now'),
      card('i-clock', 'Backup schedule', esc(scheduleText(sch)), sch.enabled ? `Next: ${esc(when(sch.nextRun))} (${esc(sch.timezone)})` : 'Automatic backups are not enabled'),
      card('i-db', 'Available backups', `${s.usable} usable`, `${esc(bytes(s.storageBytes))} used · ${s.freeBytes == null ? 'free space unavailable' : esc(bytes(s.freeBytes)) + ' free'}`),
      card('i-shield', 'Latest backup status', att ? { completed: 'Completed', failed: 'Failed', in_progress: 'In progress', queued: 'Queued' }[att.status] : 'No backups yet', att ? `${esc(TYPE[att.type] || att.type)} · ${esc(when(att.createdAt))}` : 'Nothing has been backed up'),
    ].join('');
    $('#tzName').textContent = sch.timezone;
  }

  function drawBanners() {
    const s = data.summary, out = [];
    const note = (tone, icon, html) => out.push(`<div class="br-note${tone ? ` br-note--${tone}` : ''}">${icon}<span>${html}</span></div>`);
    if (data.operation) note('', '<i class="br-spin"></i>', `<b>${esc(phaseText(data.operation))}</b>${data.operation.op === 'restore' ? ' Do not close this page or restart the server.' : ''}`);
    const lr = data.lastRestore;
    if (lr && Date.now() - new Date(lr.at).getTime() < 24 * 3600e3 && !data.operation) {
      note(lr.status === 'completed' ? 'green' : 'red', ico(lr.status === 'completed' ? 'i-check' : 'i-warn'), `<b>Last restore ${lr.status === 'completed' ? 'completed' : 'failed'}</b> (${esc(when(lr.at))}, ${esc(lr.by)}). ${esc(lr.message)}`);
    }
    if (s) {
      if (s.encryption.error) note('red', ico('i-warn'), `<b>Encryption key problem.</b> ${esc(s.encryption.error)} Backups are disabled until this is fixed.`);
      else if (!s.encryption.enabled) note('amber', ico('i-warn'), '<b>Backups are not encrypted.</b> Ask your system administrator to set <code>BACKUP_ENCRYPTION_KEY</code> on the server so backup files are protected at rest.');
      const att = s.lastAttempt;
      if (att && att.status === 'failed' && !data.operation) note('red', ico('i-warn'), `<b>The most recent backup failed</b> (${esc(when(att.createdAt))}). ${esc(att.error || '')}`);
      if (!s.lastSuccessful && !data.operation && !att) note('amber', ico('i-warn'), '<b>No backup exists yet.</b> Create one now so the data can be recovered if something goes wrong.');
    }
    $('#banners').innerHTML = out.join('');
    // a restore blocks the whole page: the server is in maintenance mode and the data is being replaced
    const restoring = !!(data.operation && data.operation.op === 'restore');
    let lock = $('#lockOverlay');
    if (restoring && !lock) {
      lock = document.createElement('div'); lock.id = 'lockOverlay'; lock.className = 'br-lock';
      lock.innerHTML = '<div class="br-lock__box"><i class="br-spin"></i><h2>Restoring data…</h2><p id="lockPhase"></p><p style="margin-top:10px">Please keep this page open. The system is paused while the data is replaced.</p></div>';
      document.body.appendChild(lock);
    }
    if (lock && !restoring) lock.remove();
    if (lock && restoring) $('#lockPhase').textContent = phaseText(data.operation);
  }

  const filtered = () => data.items.filter((m) => (!filt.type || m.type === filt.type) && (!filt.status || m.status === filt.status) && (!filt.valid || (m.status === 'completed' && m.validation.status === filt.valid)));

  function drawTable() {
    const can = data.can || {}, rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / SIZE));
    page = Math.min(Math.max(1, page), pages);
    $('#cCount').textContent = data.items.length;
    const busy = !!data.operation;
    $('#body').innerHTML = rows.slice((page - 1) * SIZE, page * SIZE).map((m) => {
      const done = m.status === 'completed', usable = done && m.validation.status === 'valid';
      const btn = (act, label, cls = '', dis = false, title = '') => `<button class="btn btn--sm ${cls}" type="button" data-act="${act}"${dis ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
      const acts = [];
      if (done && can.validate) acts.push(btn('validate', 'Validate', '', busy));
      if (done && can.download) acts.push(btn('download', `${ico('i-dl')}Download`, '', busy));
      if (done && can.restore) acts.push(btn('restore', `${ico('i-undo')}Restore`, 'btn--danger', busy || !usable, usable ? '' : 'Only a validated backup can be restored'));
      if (done && can.delete) acts.push(`<button class="x-btn br-lockbtn" type="button" data-act="protect" aria-pressed="${m.protected}" title="${m.protected ? 'Protected from automatic cleanup. Click to remove protection' : 'Protect from automatic cleanup'}" aria-label="Toggle protection"${busy ? ' disabled' : ''}>${ico('i-lock')}</button>`);
      if (can.delete && m.status !== 'in_progress' && m.status !== 'queued') acts.push(`<button class="x-btn" type="button" data-act="delete" title="Delete backup" aria-label="Delete backup"${busy || m.protected ? ' disabled' : ''}>${ico('i-trash')}</button>`);
      return `<tr data-id="${esc(m.id)}">
        <td><div class="br-first"><b>${esc(m.id)}</b>
          <span class="br-sub">${esc(m.notes || (done ? `${m.records.toLocaleString()} records · ${m.uploads} photo${m.uploads === 1 ? '' : 's'}` : ''))}</span>
          ${m.status === 'failed' && m.error ? `<span class="br-sub br-sub--bad">${esc(m.error)}</span>` : ''}
          ${m.validation.status === 'invalid' && m.validation.error ? `<span class="br-sub br-sub--bad">${esc(m.validation.error)}</span>` : ''}
          <span class="br-tags">${m.protected ? pill('blue', 'Protected') : ''}${m.encrypted ? pill('gray', 'Encrypted') : ''}</span></div></td>
        <td data-label="Type"><span class="br-val">${esc(TYPE[m.type] || m.type)}<span class="br-sub">${esc(m.createdBy)}</span></span></td>
        <td data-label="Created"><span class="br-val">${esc(when(m.createdAt))}<span class="br-sub">${esc(ago(m.createdAt))}</span></span></td>
        <td data-label="Size">${done ? esc(bytes(m.size)) : '—'}</td>
        <td data-label="Validation"><span class="br-val">${validPill(m)}${m.validation.checkedAt ? `<span class="br-sub">${esc(ago(m.validation.checkedAt))}</span>` : ''}</span></td>
        <td data-label="Status">${statusPill(m)}</td>
        <td data-label="Actions" class="br-actions-cell"><div class="br-actions">${acts.join('')}</div></td></tr>`;
    }).join('');
    $('#empty').innerHTML = rows.length ? '' : `<div class="empty"><b>${data.items.length ? 'No backups match these filters' : 'No backups yet'}</b>${data.items.length ? '' : 'Press “Create backup” to make the first one.'}</div>`;
    const chev = (n) => `<svg class="icon" aria-hidden="true"><use href="#${n}"/></svg>`;
    $('#pager').innerHTML = `<button type="button" class="btn btn--fit" data-pg="prev"${page <= 1 ? ' disabled' : ''}>${chev('i-chev-l')}Prev</button><span class="bk__pager-info">${page} of ${pages}</span><button type="button" class="btn btn--fit" data-pg="next"${page >= pages ? ' disabled' : ''}>Next${chev('i-chev-r')}</button>`;
    const c = $('#createBtn'); c.disabled = busy || !can.create; c.title = !can.create ? 'You do not have permission to create backups' : busy ? 'Another operation is running' : '';
  }

  function fillSchedule() {
    const s = data.summary && data.summary.schedule; if (!s) return;
    $('#sEnabled').checked = s.enabled; $('#sFreq').value = s.frequency; $('#sDay').value = String(s.weekday); $('#sTime').value = s.time;
    $('#sKeepDays').value = s.retentionDays; $('#sKeepMin').value = s.keepMinimum; $('#rowDay').hidden = s.frequency !== 'weekly';
    const can = (data.can || {}).schedule; $$('#schedForm input, #schedForm select, #schedSave').forEach((e) => { e.disabled = !can; });
  }

  async function drawAudit() {
    if (!(data.can || {}).audit) { $('#auditBody').innerHTML = ''; $('#auditEmpty').innerHTML = '<div class="empty empty--sm">You do not have permission to view the audit log.</div>'; return; }
    try {
      const { items } = await api('/admin/backups/audit');
      $('#auditBody').innerHTML = items.map((a) => `<tr><td style="white-space:nowrap">${esc(when(a.at))}</td><td data-label="Action">${esc(a.action)}</td><td data-label="Backup">${esc(a.id || '—')}</td><td data-label="By">${esc(a.by)}</td><td data-label="Source">${esc(a.source === 'schedule' ? 'Scheduled' : a.source === 'restore' ? 'Restore' : 'Admin console')}</td><td data-label="Result">${a.status === 'ok' || a.status === 'valid' ? pill('green', a.status) : pill(a.status === 'denied' || a.status === 'failed' || a.status === 'invalid' ? 'red' : 'amber', a.status)}</td><td data-label="Details">${esc(a.detail || '—')}</td></tr>`).join('');
      $('#auditEmpty').innerHTML = items.length ? '' : '<div class="empty empty--sm">Nothing has been logged yet.</div>';
    } catch (e) { $('#auditEmpty').innerHTML = '<div class="empty empty--sm">Could not load the audit log.</div>'; }
  }

  const drawAll = () => { drawCards(); drawBanners(); drawTable(); };

  // ------------------------------------------------------------- loading + polling
  async function load({ quiet = false } = {}) {
    try {
      data = await api('/admin/backups');
      drawAll();
      if (!schedFilled || refill) { fillSchedule(); schedFilled = true; refill = false; }   // never overwrite edits the person is typing
      if (data.operation) startPoll(); else if (tab === 'audit') drawAudit();
    } catch (e) {
      if (!quiet) { $('#empty').innerHTML = '<div class="empty"><b>Could not load backups</b>' + esc(e.message || '') + '</div>'; if (e.status === 403) $('#createBtn').disabled = true; }
    }
  }
  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const st = await api('/admin/backups/status');
        wasRestoring = wasRestoring || !!(st.operation && st.operation.op === 'restore');
        data.operation = st.operation; data.lastRestore = st.lastRestore; drawBanners();
        if (!st.operation) {
          clearInterval(pollTimer); pollTimer = null;
          await load();
          if (wasRestoring) { wasRestoring = false; const r = data.lastRestore; if (r) toast(r.status === 'completed' ? 'Restore completed' : 'Restore failed – see the notice above', r.status === 'completed' ? 'ok' : 'error'); }
          else if (data.summary && data.summary.lastAttempt) { const a = data.summary.lastAttempt; toast(a.status === 'completed' ? (a.validation.status === 'valid' ? 'Backup created and verified' : 'Backup created, but validation failed') : 'Backup failed', a.status === 'completed' && a.validation.status === 'valid' ? 'ok' : 'error'); }
        }
      } catch (e) { /* the server may be busy for a moment while restoring: keep trying */ }
    }, 2000);
  }

  // ------------------------------------------------------------- tabs
  function showTab(t) {
    tab = ['history', 'schedule', 'audit'].includes(t) ? t : 'history';
    $$('#tabs .tab').forEach((a) => a.classList.toggle('is-on', a.dataset.tab === tab));
    ['history', 'schedule', 'audit'].forEach((n) => { $('#tab-' + n).hidden = n !== tab; });
    if (tab === 'audit') drawAudit();
  }
  $('#tabs').addEventListener('click', (e) => { const a = e.target.closest('.tab'); if (!a) return; e.preventDefault(); history.replaceState(null, '', '#' + a.dataset.tab); showTab(a.dataset.tab); });

  // ------------------------------------------------------------- actions
  const find = (id) => data.items.find((m) => m.id === id);
  const detail = (m) => `${when(m.createdAt)} · ${TYPE[m.type] || m.type} · ${bytes(m.size)} · ${m.records.toLocaleString()} records, ${m.uploads} photos`;

  $('#createBtn').addEventListener('click', async () => {
    if (!(await confirmBox('Create a backup now?', 'A full copy of the Emergency Hub data (residents, reports, announcements, settings and photos) will be saved and checked. It runs in the background and the system stays online.', 'Create backup'))) return;
    try { await api('/admin/backups', { method: 'POST', body: {} }); toast('Backup started', 'ok'); await load(); } catch (e) { fail(e); }
  });

  async function validate(m) {
    try {
      const r = await api(`/admin/backups/${m.id}/validate`, { method: 'POST' });
      toast(r.validation.status === 'valid' ? 'Backup is valid and safe to restore' : `Validation failed: ${r.validation.error}`, r.validation.status === 'valid' ? 'ok' : 'error');
    } catch (e) { fail(e); }
    load();
  }
  async function download(m) {
    const out = await modal({
      title: 'Download backup', sub: `${m.id}. This file contains confidential resident and account information. Keep it somewhere safe and never share it. Enter your password to continue; the download link works once and expires in one minute.`, submit: 'Download',
      fields: [{ name: 'password', label: 'Your password', type: 'password', required: true, full: true }],
      onSubmit: (v) => api(`/admin/backups/${m.id}/download-link`, { method: 'POST', body: { password: v.password } }),
    });
    if (!out || !out.url) return;
    const a = document.createElement('a'); a.href = out.url; a.download = m.filename; document.body.appendChild(a); a.click(); a.remove();
    toast('Download started', 'ok'); setTimeout(() => { if (tab === 'audit') drawAudit(); }, 1500);
  }
  async function restore(m) {
    const out = await modal({
      title: 'Restore this backup?', danger: true, submit: 'Restore now',
      sub: `Backup ${m.id} (${detail(m)}). This REPLACES the current data (residents, reports, announcements, blockages, settings and activity) with the data saved in this backup. Anything added or changed after ${when(m.createdAt)} will be lost. A safety copy of the current data is made first, and the system pauses for a short time while it restores (the resident app will show “busy”). Newer photos are kept. This cannot be undone except by restoring the safety copy.`,
      fields: [
        { name: 'password', label: 'Your password', type: 'password', required: true, full: true },
        { name: 'confirm', label: 'Type RESTORE to confirm', type: 'text', required: true, full: true }],
      onSubmit: async (v) => {
        if (String(v.confirm).trim() !== 'RESTORE') throw new Error('Type the word RESTORE (capital letters) to confirm.');
        return api(`/admin/backups/${m.id}/restore`, { method: 'POST', body: { password: v.password, confirm: 'RESTORE' } });
      },
    });
    if (out) { toast('Restore started', 'ok'); wasRestoring = true; await load(); }
  }
  async function remove(m) {
    const out = await modal({
      title: 'Delete this backup?', danger: true, submit: 'Delete backup',
      sub: `Backup ${m.id} (${detail(m)}). The file is permanently deleted. Enter your password to confirm.`,
      fields: [{ name: 'password', label: 'Your password', type: 'password', required: true, full: true }],
      onSubmit: (v) => api(`/admin/backups/${m.id}/delete`, { method: 'POST', body: { password: v.password } }),
    });
    if (out) { toast('Backup deleted', 'ok'); load(); }
  }
  async function protect(m) {
    try { await api(`/admin/backups/${m.id}/protect`, { method: 'POST', body: { protected: !m.protected } }); toast(m.protected ? 'Protection removed' : 'Backup protected from automatic cleanup', 'ok'); load(); } catch (e) { fail(e); }
  }

  $('#body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const m = find(b.closest('tr').dataset.id); if (!m) return;
    ({ validate, download, restore, delete: remove, protect })[b.dataset.act](m);
  });
  $('#pager').addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (!b || b.disabled) return; page += b.dataset.pg === 'next' ? 1 : -1; drawTable(); });
  [['#fType', 'type'], ['#fStatus', 'status'], ['#fValid', 'valid']].forEach(([sel, k]) => $(sel).addEventListener('change', (e) => { filt[k] = e.target.value; page = 1; drawTable(); }));

  // schedule form
  $('#sFreq').addEventListener('change', () => { $('#rowDay').hidden = $('#sFreq').value !== 'weekly'; });
  $('#schedForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#schedErr'); err.hidden = true;
    try {
      const s = await api('/admin/backups/schedule', { method: 'PUT', body: { enabled: $('#sEnabled').checked, frequency: $('#sFreq').value, weekday: Number($('#sDay').value), time: $('#sTime').value, retentionDays: Number($('#sKeepDays').value), keepMinimum: Number($('#sKeepMin').value) } });
      toast(s.enabled ? `Automatic backups on – next: ${when(s.nextRun)}` : 'Automatic backups are off', 'ok');
      refill = true; await load();
    } catch (x) { err.textContent = x.message || 'Could not save the schedule.'; err.hidden = false; }
  });

  // ------------------------------------------------------------- start
  showTab(location.hash.slice(1));
  await load();
  setInterval(() => { if (!document.hidden && !data.operation && !document.querySelector('.modal')) load({ quiet: true }); }, 30000);
})();