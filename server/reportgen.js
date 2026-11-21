'use strict';
/**
 * Reports Generator for the Emergency Hub server.
 *
 * Builds consolidated summaries from the records EHBR already stores (reports, road blockages, announcements, residents).
 * Nothing is sampled, estimated or invented:
 *   - a value that is not stored is shown as "not recorded" (null), never as 0;
 *   - timing statistics use only records that really have both timestamps, and say how many were left out;
 *   - the zone of a report is the REPORTER'S registered zone (EHBR does not store an incident zone) and is labelled that way.
 * One neutral `doc` object feeds the on-screen preview, the PDF, the XLSX and the CSV, so they always agree.
 *
 * Env:  REPORT_DIR (default ./generated-reports)  REPORT_TZ (default BACKUP_TZ or Asia/Manila)  REPORT_RETENTION_DAYS (default 30)
 *       BACKUP_ENCRYPTION_KEY (optional; generated files are encrypted at rest with a key derived from it)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const T = require('./timeutil');
const X = require('./exporters');

const MAX_RECORDS = 50000;           // refuse to build a file bigger than this (narrow the filters instead)
const PDF_ROWS = 1500;               // the PDF lists at most this many rows; XLSX/CSV carry everything
const PREVIEW_ROWS = 50;
const SMALL_CELL = 3;                // resident-activity zone groups smaller than this are hidden
const DOWNLOAD_TTL_MS = 60 * 1000;
const ID_RE = /^rg-\d{8}-\d{6}-[a-f0-9]{4}$/;
const MAGIC = Buffer.from('EHRG1');
const ZONE_ANON = 'Anonymous (zone hidden)', ZONE_NA = 'Not recorded';
const SRC = { resident: 'Resident-submitted', admin: 'Admin-created' };
const FORMATS = { pdf: { ext: 'pdf', mime: 'application/pdf', label: 'PDF' }, xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel (XLSX)' }, csv: { ext: 'csv', mime: 'text/csv; charset=utf-8', label: 'CSV' } };

/** Same model as backup.js: today every staff account is 'admin'. Tighten these lists when roles are split.
 *  'detail' = may include the reporter-typed location text in an export (marked CONFIDENTIAL, password required). */
const PERMS = {
  view: ['admin', 'superadmin'], export: ['admin', 'superadmin'], download: ['admin', 'superadmin'],
  detail: ['admin', 'superadmin'], delete: ['admin', 'superadmin'], audit: ['admin', 'superadmin'],
};

const CATEGORIES = {
  'incident-summary': { label: 'Incident Reports Summary', desc: 'Totals, type, urgency, status, source, trend and reporter zone for the reports received, plus the list of matching reports.', filters: ['types', 'urgencies', 'statuses', 'sources', 'zones', 'team'], list: true, detail: true },
  'emergency-stats': { label: 'Emergency Statistics', desc: 'Statistics on emergency activity: type, urgency, trend over time and comparison with the previous period.', filters: ['types', 'urgencies', 'statuses', 'sources', 'zones'], list: false, detail: false },
  'response': { label: 'Response Report', desc: 'Dispatch activity and response times, using only reports that have the needed timestamps.', filters: ['types', 'urgencies', 'statuses', 'sources', 'zones', 'team'], list: true, detail: true },
  'resolution': { label: 'Resolution Report', desc: 'Resolved, open and rejected reports, outcomes, and time to resolution where recorded.', filters: ['types', 'urgencies', 'statuses', 'sources', 'zones', 'team'], list: true, detail: true },
  'blockages': { label: 'Road Blockages Report', desc: 'Road blockage records in the period by reason, status and date.', filters: ['reasons', 'blockStatus'], list: true, detail: false },
  'resident-activity': { label: 'Resident Activity Summary', desc: 'Privacy-safe summary of reports submitted by residents. No names, contact details or addresses.', filters: ['types', 'urgencies', 'zones'], list: false, detail: false },
  'announcements': { label: 'Announcements Report', desc: 'Announcements published in the period, by category and date.', filters: ['annCategories'], list: true, detail: false },
};

// ---------------------------------------------------------------- small helpers
const str = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (n) => Number(n).toLocaleString('en-US');
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const pctOf = (n, t) => (t ? (n / t) * 100 : null);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function register(ctx) {
  const { route, HttpError, ALL_TYPES, URGENCIES, STATUSES } = ctx;
  const bad = (m) => new HttpError(400, m);
  const REPORT_DIR = path.resolve(process.env.REPORT_DIR || path.join(__dirname, 'generated-reports'));
  const TZ = process.env.REPORT_TZ || process.env.BACKUP_TZ || 'Asia/Manila';
  const RETENTION_DAYS = Math.max(1, Number(process.env.REPORT_RETENTION_DAYS) || 30);
  const AUDIT_FILE = path.join(REPORT_DIR, 'audit.jsonl');
  if (!T.validTz(TZ)) throw new Error(`REPORT_TZ "${TZ}" is not a valid time zone`);
  fs.mkdirSync(REPORT_DIR, { recursive: true, mode: 0o700 });

  // ---- at-rest encryption (optional, reuses the backup key via a derived sub-key)
  let fileKey = null, keyError = '';
  try {
    const k = process.env.BACKUP_ENCRYPTION_KEY || '';
    if (k) { if (!/^[a-f0-9]{64}$/i.test(k)) throw new Error('BACKUP_ENCRYPTION_KEY must be exactly 64 hex characters.'); fileKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(k, 'hex'), Buffer.alloc(0), 'ehbr-report-files', 32)); }
  } catch (e) { keyError = e.message; }
  const seal = (buf) => { if (!fileKey) return buf; const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', fileKey, iv), enc = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([MAGIC, iv, c.getAuthTag(), enc]); };
  const unseal = (buf, encrypted) => {
    if (!encrypted) return buf;
    if (!fileKey) throw new HttpError(409, 'This file is encrypted but no encryption key is configured on the server.');
    try { const d = crypto.createDecipheriv('aes-256-gcm', fileKey, buf.subarray(MAGIC.length, MAGIC.length + 12)); d.setAuthTag(buf.subarray(MAGIC.length + 12, MAGIC.length + 28)); return Buffer.concat([d.update(buf.subarray(MAGIC.length + 28)), d.final()]); }
    catch { throw new HttpError(409, 'This file could not be decrypted (wrong key or the file was altered).'); }
  };

  // ---- permissions, audit, re-authentication
  const can = (user, action) => !!user && ((PERMS[action] || []).includes(user.role) || (Array.isArray(user.permissions) && user.permissions.includes('reportgen.' + action)));
  const need = (user, action, what) => { if (!can(user, action)) throw new HttpError(403, `You do not have permission to ${what}.`); };
  function audit(action, { id = null, user = null, status = 'ok', detail = '' } = {}) {
    const rec = { at: ctx.nowIso(), action, id, userId: user ? user.id : null, by: user ? ctx.fullName(user) : 'System', status, detail: String(detail).slice(0, 300) };
    try { fs.appendFileSync(AUDIT_FILE, JSON.stringify(rec) + '\n', { mode: 0o600 }); } catch (e) { console.error('[reports] audit write failed:', e.message); }
    try { ctx.log(`Report generator: ${action}${id ? ' ' + id : ''} – ${status} (${rec.by})`, 'audit'); ctx.save().catch(() => {}); } catch { /* ignore */ }
  }
  async function reauth(user, password, ip, action, id) {
    if (typeof password !== 'string' || !password) throw new HttpError(403, 'Enter your password to continue.');   // not a wrong guess: no lockout count, no audit noise
    const k = `${ip}|reauth:${user.id}`, pk = ctx.limiter.peek('loginFail', k);
    if (!pk.ok) throw new HttpError(429, 'Too many wrong passwords. Try again in a few minutes.', pk.retryAfter);
    if (!(await ctx.checkPw(typeof password === 'string' ? password.slice(0, 200) : '', user.passwordHash))) { ctx.limiter.hit('loginFail', k); audit(action, { id, user, status: 'denied', detail: 'wrong password' }); throw new HttpError(403, 'Incorrect password.'); }
    ctx.limiter.reset('loginFail', k);
  }
  const hits = new Map();   // tiny per-user throttle so nobody can hammer file generation
  function throttle(user, bucket, max, windowMs = 60000) {
    const k = bucket + user.id, now = Date.now(), a = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (a.length >= max) throw new HttpError(429, 'Too many requests. Please wait a moment and try again.', Math.ceil(windowMs / 1000));
    a.push(now); hits.set(k, a);
  }

  // ---------------------------------------------------------------- periods (all boundaries are local midnight in TZ)
  const parseDate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3], t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && y >= 2000 && y <= 2100 ? { y, m: mo, d } : null;
  };
  const dayLabel = (p) => `${T.MON[p.m - 1]} ${p.d}, ${p.y}`;
  function rangeFor(period, now) {
    const lp = T.localParts(now, TZ);
    let a = { y: lp.y, m: lp.m, d: lp.d };
    if (period.type !== 'custom' && period.date) { a = parseDate(period.date); if (!a) throw bad('Choose a valid date.'); }
    const mid = (y, m, d) => T.localMidnight(y, m, d, TZ);
    let start, end, label, prevStart, prevEnd;
    switch (period.type) {
      case 'day': {
        start = mid(a.y, a.m, a.d); end = mid(a.y, a.m, a.d + 1); prevStart = mid(a.y, a.m, a.d - 1); prevEnd = start;
        label = `${T.DOW[new Date(Date.UTC(a.y, a.m - 1, a.d)).getUTCDay()]}, ${dayLabel(a)}`; break;
      }
      case 'week': {
        const dow = (new Date(Date.UTC(a.y, a.m - 1, a.d)).getUTCDay() + 6) % 7;        // Monday = 0
        start = mid(a.y, a.m, a.d - dow); end = mid(a.y, a.m, a.d - dow + 7); prevStart = mid(a.y, a.m, a.d - dow - 7); prevEnd = start;
        const s = T.localParts(start, TZ), e = T.localParts(end - 1000, TZ);
        label = `${T.MON[s.m - 1]} ${s.d}${s.y !== e.y ? ', ' + s.y : ''} – ${T.MON[e.m - 1]} ${e.d}, ${e.y} (Mon–Sun)`; break;
      }
      case 'month': start = mid(a.y, a.m, 1); end = mid(a.y, a.m + 1, 1); prevStart = mid(a.y, a.m - 1, 1); prevEnd = start; label = `${T.MONTHS[a.m - 1]} ${a.y}`; break;
      case 'year': start = mid(a.y, 1, 1); end = mid(a.y + 1, 1, 1); prevStart = mid(a.y - 1, 1, 1); prevEnd = start; label = String(a.y); break;
      case 'custom': {
        const f = parseDate(period.from), t = parseDate(period.to);
        if (!f || !t) throw bad('Choose a start and an end date.');
        start = mid(f.y, f.m, f.d); end = mid(t.y, t.m, t.d + 1);
        if (end <= start) throw bad('The end date cannot be before the start date.');
        if ((end - start) / 864e5 > 3660) throw bad('A custom period can cover at most 10 years.');
        prevStart = start - (end - start); prevEnd = start; label = f.y === t.y && f.m === t.m && f.d === t.d ? dayLabel(f) : `${dayLabel(f)} – ${dayLabel(t)}`; break;
      }
      default: throw bad('Choose a period: day, week, month, year or custom.');
    }
    return { type: period.type, start, end, prevStart, prevEnd, label, inProgress: end > now };
  }
  /** Buckets for the trend table/chart: hourly for one day, daily up to ~2 months, otherwise monthly. */
  function buckets(range) {
    const days = Math.round((range.end - range.start) / 864e5), keys = [], labels = [], index = new Map();
    const add = (k, l) => { index.set(k, keys.length); keys.push(k); labels.push(l); };
    let unit;
    if (days <= 1) { unit = 'hour'; for (let h = 0; h < 24; h++) add(String(h), `${T.pad(h)}:00`); }
    else if (days <= 62) {
      unit = 'day'; const s = T.localParts(range.start, TZ);
      for (let i = 0, t = range.start; t < range.end; t = T.localMidnight(s.y, s.m, s.d + ++i, TZ)) { const p = T.localParts(t, TZ); add(`${p.y}-${p.m}-${p.d}`, days <= 8 ? `${T.DOW[p.wd]} ${T.MON[p.m - 1]} ${p.d}` : `${T.MON[p.m - 1]} ${p.d}`); }
    } else {
      unit = 'month'; const s = T.localParts(range.start, TZ);
      for (let i = 0, t = range.start; t < range.end; t = T.localMidnight(s.y, s.m + ++i, 1, TZ)) { const p = T.localParts(t, TZ); add(`${p.y}-${p.m}`, `${T.MON[p.m - 1]} ${p.y}`); }
    }
    const keyOf = (ms) => { const p = T.localParts(ms, TZ); return unit === 'hour' ? String(p.h) : unit === 'day' ? `${p.y}-${p.m}-${p.d}` : `${p.y}-${p.m}`; };
    return { unit, keys, labels, at: (ms) => index.get(keyOf(ms)) };
  }

  // ---------------------------------------------------------------- facts about each report (derived only from stored fields)
  const ms = (v) => (v ? Date.parse(v) : NaN);
  const teamsOf = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  function facts(r, usersById) {
    const tl = Array.isArray(r.timeline) ? r.timeline : [];
    const first = (re) => { let best = NaN; for (const e of tl) { if (!re.test(String((e && e.text) || ''))) continue; const t = ms(e.at); if (!Number.isNaN(t) && (Number.isNaN(best) || t < best)) best = t; } return best; };
    const u = usersById.get(r.userId);
    return {
      r, id: r.id, type: r.type, urgency: r.urgency, status: r.status, source: r.source === 'admin' ? 'admin' : 'resident', anonymous: !!r.anonymous, userId: r.userId,
      rep: ms(r.reportedAt || r.createdAt),
      zone: r.anonymous ? ZONE_ANON : (u && u.zone) || ZONE_NA,
      teams: teamsOf(r.assignedTo),
      verifiedAt: first(/^Verified by admin \([^:]*\)$/), dispatchedAt: first(/^Responders dispatched \([^:]*\)$/),
      onSiteAt: ms(r.onSiteAt), resolvedAt: r.status === 'RESOLVED' && r.resolution ? ms(r.resolution.at) : NaN,
      reopened: tl.some((e) => /^Reopened \([^:]*\)$/.test(String((e && e.text) || ''))),
    };
  }
  /** Minutes between two instants, or why it cannot be computed. */
  const gap = (a, b) => (!Number.isFinite(a) || !Number.isFinite(b) ? { missing: true } : b < a ? { invalid: true } : { min: (b - a) / 60000 });
  function timing(items, from, to, label) {
    const vals = []; let missing = 0, invalid = 0;
    for (const f of items) { const g = gap(from(f), to(f)); if (g.min !== undefined) vals.push(g.min); else if (g.invalid) invalid++; else missing++; }
    return { label, n: vals.length, missing, invalid, med: r1(median(vals)), mean: r1(mean(vals)), min: r1(vals.length ? Math.min(...vals) : null), max: r1(vals.length ? Math.max(...vals) : null), vals };
  }
  const timingRow = (t) => ({ k: t.label, n: t.n, miss: t.missing + t.invalid, med: t.med, mean: t.mean, min: t.min, max: t.max });
  const timingCols = (what = 'Records with both times') => [{ key: 'k', label: 'Metric', type: 'text' }, { key: 'n', label: what, type: 'int' }, { key: 'miss', label: 'Not recorded / not valid', type: 'int' }, { key: 'med', label: 'Median', type: 'minutes' }, { key: 'mean', label: 'Average', type: 'minutes' }, { key: 'min', label: 'Fastest', type: 'minutes' }, { key: 'max', label: 'Slowest', type: 'minutes' }];

  // ---------------------------------------------------------------- inputs: option lists, validation
  function optionSets(db) {
    const usersById = new Map(db.users.map((u) => [u.id, u]));
    const set = (...lists) => [...new Set(lists.flat().filter(Boolean))];
    const teams = set((db.settings.teams || []).map((t) => t.name), db.reports.flatMap((r) => teamsOf(r.assignedTo)));
    return {
      types: set(ALL_TYPES, db.reports.map((r) => r.type)).sort(), urgencies: [...URGENCIES].reverse(), statuses: [...STATUSES],
      sources: ['resident', 'admin'], zones: set(db.settings.zones || [], db.users.filter((u) => u.role === 'resident').map((u) => u.zone), [ZONE_ANON, ZONE_NA]),
      team: teams.sort(), reasons: set(db.blockages.map((b) => b.reason)).sort(), blockStatus: ['active', 'expired'],
      annCategories: set(['alert', 'event', 'advisory'], db.announcements.map((a) => a.category)).sort(),
      _usersById: usersById,
    };
  }
  const FILTER_LABEL = { types: 'Type', urgencies: 'Urgency', statuses: 'Status', sources: 'Source', zones: "Reporter's zone", team: 'Assigned team', reasons: 'Reason', blockStatus: 'Blockage status', annCategories: 'Announcement category' };
  const FILTER_SHOW = { sources: (v) => SRC[v] || v, blockStatus: (v) => (v === 'active' ? 'Active' : 'Expired') };
  function cleanConfig(raw, opts) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const category = str(raw.category, 40), cat = CATEGORIES[category];
    if (!cat) throw bad('Choose a report category.');
    const p = raw.period && typeof raw.period === 'object' ? raw.period : {};
    const period = { type: str(p.type, 10), date: str(p.date, 10), from: str(p.from, 10), to: str(p.to, 10) };
    const filters = {};
    for (const key of cat.filters) {
      let v = raw.filters ? raw.filters[key] : undefined;
      if (key === 'team') { v = str(v, 80); if (v && !opts.team.includes(v)) throw bad('That team is not in the system.'); if (v) filters.team = v; continue; }
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      if (!Array.isArray(v) || v.length > 30) throw bad('Invalid filter.');
      const list = [...new Set(v.map((x) => str(x, 80)))];
      for (const x of list) if (!opts[key].includes(x)) throw bad(`"${x}" is not a valid ${FILTER_LABEL[key].toLowerCase()}.`);
      filters[key] = list;
    }
    return { category, period, filters, includeLocation: !!(raw.includeLocation && cat.detail) };
  }
  const filterSummary = (cfg) => Object.entries(cfg.filters).map(([k, v]) => [FILTER_LABEL[k], (Array.isArray(v) ? v : [v]).map((x) => (FILTER_SHOW[k] ? FILTER_SHOW[k](x) : x)).join(', ')]);

  // ---------------------------------------------------------------- selecting records
  function selectReports(db, cfg, start, end, opts) {
    const F = cfg.filters, out = []; let noDate = 0;
    for (const r of db.reports) {
      const f = facts(r, opts._usersById);
      if (!Number.isFinite(f.rep)) { noDate++; continue; }
      if (f.rep < start || f.rep >= end) continue;
      if (F.types && !F.types.includes(f.type)) continue;
      if (F.urgencies && !F.urgencies.includes(f.urgency)) continue;
      if (F.statuses && !F.statuses.includes(f.status)) continue;
      if (F.sources && !F.sources.includes(f.source)) continue;
      if (F.zones && !F.zones.includes(f.zone)) continue;
      if (F.team && !f.teams.includes(F.team)) continue;
      out.push(f);
    }
    return { recs: out, noDate };
  }

  // ---------------------------------------------------------------- section helpers
  const cols3 = (label, noun = 'Reports') => [{ key: 'k', label, type: 'text' }, { key: 'n', label: noun, type: 'int' }, { key: 'p', label: 'Share of total', type: 'pct' }];
  function countRows(arr, keyFn, order) {
    const m = new Map(); for (const x of arr) { const k = keyFn(x); m.set(k, (m.get(k) || 0) + 1); }
    const idx = (k) => { const i = order ? order.indexOf(k) : -1; return i < 0 ? 999 : i; };
    const keys = [...m.keys()].sort(order ? (a, b) => idx(a) - idx(b) || String(a).localeCompare(String(b)) : (a, b) => m.get(b) - m.get(a) || String(a).localeCompare(String(b)));
    return keys.map((k) => ({ k: String(k ?? 'Not recorded'), n: m.get(k), p: pctOf(m.get(k), arr.length) }));
  }
  const countSection = (id, title, arr, keyFn, { label, order, note, noun = 'Reports', chart = 'bar', unit } = {}) => ({
    id, title, note, columns: cols3(label, noun), rows: countRows(arr, keyFn, order), total: { k: 'Total', n: arr.length, p: arr.length ? 100 : null },
    chart: arr.length ? { type: chart, labelKey: 'k', valueKey: 'n', unit: unit || `Number of ${noun.toLowerCase()}` } : null,
  });
  function trendSection(arr, atFn, range, noun = 'Reports') {
    const b = buckets(range), counts = new Array(b.keys.length).fill(0);
    for (const x of arr) { const i = b.at(atFn(x)); if (i !== undefined) counts[i]++; }
    const unitWord = { hour: 'hour', day: 'day', month: 'month' }[b.unit];
    return {
      id: 'trend', title: `${noun} by ${unitWord}`, note: `Counted in ${TZ} time. A ${unitWord} with no ${noun.toLowerCase()} shows 0; that is a real count of none.`,
      columns: [{ key: 'k', label: unitWord[0].toUpperCase() + unitWord.slice(1), type: 'text' }, { key: 'n', label: noun, type: 'int' }],
      rows: b.labels.map((l, i) => ({ k: l, n: counts[i] })), total: { k: 'Total', n: counts.reduce((a, c) => a + c, 0) },
      chart: arr.length ? { type: 'column', labelKey: 'k', valueKey: 'n', unit: `${noun} per ${unitWord} (${TZ})` } : null,
    };
  }
  const URG_ORDER = [...URGENCIES].reverse();
  const reportListCols = (extra = [], loc = false) => [
    { key: 'id', label: 'Report ID', type: 'text' }, { key: 'rep', label: 'Reported', type: 'datetime' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'urgency', label: 'Urgency', type: 'text' }, { key: 'status', label: 'Status', type: 'text' },
    ...extra, { key: 'source', label: 'Source', type: 'text' }, { key: 'zone', label: "Reporter's zone", type: 'text' }, { key: 'team', label: 'Assigned team', type: 'text' },
    ...(loc ? [{ key: 'loc', label: 'Location (as typed by reporter)', type: 'text' }] : []),
  ];
  const baseRow = (f, loc) => ({ id: f.id, rep: f.rep, type: f.type, urgency: f.urgency, status: f.status, source: SRC[f.source], zone: f.zone, team: f.teams.join(', ') || null, ...(loc ? { loc: f.r.locationText || null } : {}) });
  const ts = (v) => (Number.isFinite(v) ? v : null);
  const mins = (a, b) => { const g = gap(a, b); return g.min === undefined ? null : r1(g.min); };

  // ---------------------------------------------------------------- the seven report categories
  const ZONE_NOTE = "Zone means the reporter's registered zone. EHBR does not store the incident's own zone. Anonymous reports hide it, and reports for people without an account show \"Not recorded\".";
  const DEF = {
    total: ['Total reports', 'Reports whose reported time falls inside the period and that match every filter. Rejected reports are included unless filtered out.'],
    open: ['Open', 'Reports still in progress: status New, Verified or Dispatched.'],
    zone: ["Reporter's zone", "The zone saved on the reporting resident's profile. It is not the location of the incident."],
    source: ['Source', 'Resident-submitted = filed through the app. Admin-created = recorded by barangay staff (walk-in or phone-in).'],
  };
  const common = (ctxt, notes) => { if (ctxt.noDate) notes.push(`${num(ctxt.noDate)} report(s) have no valid reported time and could not be placed in any period.`); };

  function buildIncidentSummary(c) {
    const { recs, cfg } = c, n = recs.length, notes = [ZONE_NOTE]; common(c, notes);
    const rej = recs.filter((f) => f.status === 'REJECTED').length;
    if (rej) notes.push(`${num(rej)} rejected report(s) are included in the totals. Use the Status filter to leave them out.`);
    const open = recs.filter((f) => ['NEW', 'VERIFIED', 'DISPATCHED'].includes(f.status)).length;
    return {
      summary: [{ label: 'Total reports', value: num(n), note: 'Reported in the period' }, { label: 'Resident-submitted', value: num(recs.filter((f) => f.source === 'resident').length) }, { label: 'Admin-created', value: num(recs.filter((f) => f.source === 'admin').length) },
        { label: 'Resolved', value: num(recs.filter((f) => f.status === 'RESOLVED').length) }, { label: 'Open', value: num(open), note: 'New, Verified or Dispatched' }],
      notes, definitions: [DEF.total, DEF.open, DEF.source, DEF.zone],
      sections: [
        countSection('type', 'Reports by type', recs, (f) => f.type, { label: 'Type' }),
        countSection('urgency', 'Reports by urgency', recs, (f) => f.urgency, { label: 'Urgency', order: URG_ORDER }),
        countSection('status', 'Reports by status', recs, (f) => f.status, { label: 'Status', order: STATUSES }),
        countSection('source', 'Reports by source', recs, (f) => SRC[f.source], { label: 'Source', order: [SRC.resident, SRC.admin] }),
        trendSection(recs, (f) => f.rep, c.range),
        countSection('zone', "Reports by reporter's zone", recs, (f) => f.zone, { label: "Reporter's zone", note: ZONE_NOTE }),
      ],
      list: { title: 'Matching reports', columns: reportListCols([], c.loc), rows: recs.slice().sort((a, b) => b.rep - a.rep).map((f) => baseRow(f, c.loc)) },
    };
  }

  function buildEmergencyStats(c) {
    const { recs, cfg } = c, n = recs.length, notes = [ZONE_NOTE]; common(c, notes);
    const prev = selectReports(c.db, cfg, c.range.prevStart, c.range.prevEnd, c.opts).recs.length;
    const change = prev ? `${n >= prev ? '+' : '−'}${Math.abs(((n - prev) / prev) * 100).toFixed(1)}% vs previous` : n ? 'No reports in the previous period' : '';
    const byType = countRows(recs, (f) => f.type), top = byType.filter((r) => r.n === (byType[0] ? byType[0].n : 0));
    const mostFreq = !n ? '—' : top.length === 1 ? top[0].k : `Tie (${top.length} types)`;
    const critHigh = recs.filter((f) => f.urgency === 'Critical' || f.urgency === 'High').length;
    if (n > 0 && n < 10) notes.push(`Only ${num(n)} report(s) match, so shares, trends and the "most frequent" type rest on a very small number of reports.`);
    if (c.range.inProgress) notes.push('The period has not ended yet. Figures cover the time up to now, so comparing with the full previous period may understate the change.');
    return {
      summary: [{ label: 'Total reports', value: num(n) }, { label: 'Previous period', value: num(prev), note: `${T.fmtDate(c.range.prevStart, TZ)} to ${T.fmtDate(c.range.prevEnd - 1000, TZ)}. ${change}` },
        { label: 'Most frequent type', value: mostFreq, note: top.length > 1 && n ? `${top.map((r) => r.k).join(', ')} (${top[0].n} each)` : top[0] ? `${top[0].n} report(s)` : '' }, { label: 'Critical + High urgency', value: num(critHigh), note: n ? `${pctOf(critHigh, n).toFixed(1)}% of reports` : '' }],
      notes, definitions: [DEF.total, DEF.zone, ['Most frequent type', 'Named only when exactly one type has the highest count. A tie is reported as a tie.'], ['Previous period', 'The period of the same length immediately before the selected one, with the same filters.']],
      sections: [
        countSection('type', 'Reports by type', recs, (f) => f.type, { label: 'Type' }),
        countSection('urgency', 'Reports by urgency', recs, (f) => f.urgency, { label: 'Urgency', order: URG_ORDER }),
        trendSection(recs, (f) => f.rep, c.range),
        countSection('zone', "Reports by reporter's zone", recs, (f) => f.zone, { label: "Reporter's zone", note: ZONE_NOTE }),
      ], list: null,
    };
  }

  function buildResponse(c) {
    const { recs } = c, notes = []; common(c, notes);
    const reopened = recs.filter((f) => f.reopened), elig = recs.filter((f) => !f.reopened);
    if (reopened.length) notes.push(`${num(reopened.length)} reopened report(s) are left out of the timing figures, because their times span more than one handling of the case.`);
    const dispatched = recs.filter((f) => Number.isFinite(f.dispatchedAt));
    const noTime = recs.filter((f) => f.status === 'DISPATCHED' && !Number.isFinite(f.dispatchedAt)).length;
    if (noTime) notes.push(`${num(noTime)} dispatched report(s) have no recorded dispatch time and are not in the timing figures.`);
    notes.push('Response times are calculated only from timestamps EHBR actually stored when a status was changed. Nothing is estimated.');
    const toDisp = timing(elig, (f) => f.rep, (f) => f.dispatchedAt, 'Report received to responders dispatched');
    const toSite = timing(elig, (f) => f.dispatchedAt, (f) => f.onSiteAt, 'Dispatched to responders on site');
    const rows = [timing(elig, (f) => f.rep, (f) => f.verifiedAt, 'Report received to verified'), toDisp, toSite, timing(elig, (f) => f.rep, (f) => f.onSiteAt, 'Report received to responders on site')];
    const byUrg = URG_ORDER.map((u) => { const g = elig.filter((f) => f.urgency === u); const t = timing(g, (f) => f.rep, (f) => f.dispatchedAt, u); return { k: u, n: t.n, miss: t.missing + t.invalid, med: t.med, mean: t.mean }; }).filter((r) => r.n || r.miss);
    const teamMap = new Map(); for (const f of dispatched) for (const t of f.teams.length ? f.teams : ['No team recorded']) { if (!teamMap.has(t)) teamMap.set(t, []); teamMap.get(t).push(f); }
    const byTeam = [...teamMap.entries()].map(([k, g]) => { const t = timing(g.filter((f) => !f.reopened), (f) => f.rep, (f) => f.dispatchedAt, k); return { k, n: g.length, med: t.med }; }).sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
    if (!dispatched.length && recs.length) notes.push('No report in this period has a recorded dispatch.');
    return {
      summary: [{ label: 'Reports in period', value: num(recs.length) }, { label: 'Dispatched', value: num(dispatched.length), note: 'Reports with a recorded dispatch' }, { label: 'Median time to dispatch', value: toDisp.n ? X.fmtDuration(toDisp.med) : 'Not available', note: `Based on ${num(toDisp.n)} report(s)` },
        { label: 'Median dispatch to on site', value: toSite.n ? X.fmtDuration(toSite.med) : 'Not available', note: `Based on ${num(toSite.n)} report(s)` }],
      notes, definitions: [DEF.total, ['Dispatched', 'The report has a "Responders dispatched" entry in its history. The time is the first such entry.'], ['Median', 'The middle value. Half the reports were faster, half slower. Less affected by one unusually slow case than the average.'], ['Not recorded / not valid', 'The report never reached that step, the time was not stored, or the stored times are out of order.']],
      sections: [
        { id: 'timing', title: 'Response times', note: 'Each row uses only reports that have both timestamps.', columns: timingCols(), rows: rows.map(timingRow), total: null, chart: null },
        { id: 'urgency', title: 'Time to dispatch by urgency', columns: [{ key: 'k', label: 'Urgency', type: 'text' }, { key: 'n', label: 'Reports with a dispatch time', type: 'int' }, { key: 'miss', label: 'Not recorded / not valid', type: 'int' }, { key: 'med', label: 'Median', type: 'minutes' }, { key: 'mean', label: 'Average', type: 'minutes' }], rows: byUrg, total: null, chart: null },
        { id: 'team', title: 'Dispatched reports by team', note: 'A report assigned to several teams is counted once for each team, so these rows can add up to more than the number of dispatched reports.', columns: [{ key: 'k', label: 'Assigned team', type: 'text' }, { key: 'n', label: 'Dispatched reports', type: 'int' }, { key: 'med', label: 'Median time to dispatch', type: 'minutes' }], rows: byTeam, total: null, chart: byTeam.length ? { type: 'bar', labelKey: 'k', valueKey: 'n', unit: 'Dispatched reports' } : null },
      ],
      list: dispatched.length || recs.some((f) => f.status === 'DISPATCHED') ? { title: 'Dispatched reports', columns: reportListCols([{ key: 'disp', label: 'Dispatched', type: 'datetime' }, { key: 'toDisp', label: 'Time to dispatch', type: 'minutes' }, { key: 'site', label: 'On site', type: 'datetime' }, { key: 'toSite', label: 'Dispatch to on site', type: 'minutes' }], c.loc),
        rows: recs.filter((f) => Number.isFinite(f.dispatchedAt) || f.status === 'DISPATCHED').sort((a, b) => b.rep - a.rep).map((f) => ({ ...baseRow(f, c.loc), disp: ts(f.dispatchedAt), toDisp: f.reopened ? null : mins(f.rep, f.dispatchedAt), site: ts(f.onSiteAt), toSite: f.reopened ? null : mins(f.dispatchedAt, f.onSiteAt) })) } : null,
    };
  }

  function buildResolution(c) {
    const { recs } = c, notes = []; common(c, notes);
    const resolved = recs.filter((f) => f.status === 'RESOLVED'), open = recs.filter((f) => ['NEW', 'VERIFIED', 'DISPATCHED'].includes(f.status)), rejected = recs.filter((f) => f.status === 'REJECTED');
    const reopened = resolved.filter((f) => f.reopened);
    if (reopened.length) notes.push(`${num(reopened.length)} resolved report(s) were reopened at some point and are left out of the time-to-resolution figures.`);
    const noRes = resolved.filter((f) => !Number.isFinite(f.resolvedAt)).length;
    if (noRes) notes.push(`${num(noRes)} resolved report(s) have no recorded resolution time and are not in the time-to-resolution figures.`);
    const elig = resolved.filter((f) => !f.reopened), all = timing(elig, (f) => f.rep, (f) => f.resolvedAt, 'All resolved reports');
    const byUrg = URG_ORDER.map((u) => timing(elig.filter((f) => f.urgency === u), (f) => f.rep, (f) => f.resolvedAt, u)).filter((t) => t.n + t.missing + t.invalid > 0).map(timingRow);
    const now = Date.parse(c.generatedAt);
    const openRows = open.slice().sort((a, b) => a.rep - b.rep).slice(0, 200).map((f) => ({ id: f.id, type: f.type, urgency: f.urgency, status: f.status, rep: f.rep, age: r1((now - f.rep) / 60000), team: f.teams.join(', ') || null }));
    const outcome = (f) => (f.r.resolution && f.r.resolution.outcome) || 'Not specified', reason = (f) => f.r.rejectReason || 'Not specified';
    return {
      summary: [{ label: 'Reports in period', value: num(recs.length) }, { label: 'Resolved', value: num(resolved.length), note: recs.length ? `${pctOf(resolved.length, recs.length).toFixed(1)}% of reports in the period` : '' }, { label: 'Still requiring action', value: num(open.length), note: 'New, Verified or Dispatched' },
        { label: 'Rejected', value: num(rejected.length) }, { label: 'Median time to resolution', value: all.n ? X.fmtDuration(all.med) : 'Not available', note: `Based on ${num(all.n)} report(s)` }],
      notes, definitions: [DEF.total, ['Resolved', 'Status Resolved, using the time the administrator marked it resolved.'], ['Still requiring action', 'Open reports as of the time this report was generated.'], ['Time to resolution', 'From the time reported to the time marked resolved, for resolved reports that were never reopened.']],
      sections: [
        countSection('status', 'Reports by status', recs, (f) => f.status, { label: 'Status', order: STATUSES }),
        countSection('outcome', 'Resolution outcomes', resolved, outcome, { label: 'Outcome', note: 'Resolved reports only, grouped by the outcome the administrator selected.' }),
        countSection('reject', 'Reasons for rejection', rejected, reason, { label: 'Reason', note: 'Rejected reports only. Free-text notes are not included.' }),
        { id: 'ttr', title: 'Time to resolution', columns: timingCols('Resolved reports with both times'), rows: [...byUrg, timingRow(all)], total: null, chart: null, note: 'By urgency; the last row covers all resolved reports in the period.' },
        { id: 'open', title: 'Reports still requiring action', note: open.length > 200 ? 'Showing the 200 oldest. The full list is in the XLSX / CSV.' : 'Oldest first. Age is measured up to the moment this report was generated.',
          columns: [{ key: 'id', label: 'Report ID', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'urgency', label: 'Urgency', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'rep', label: 'Reported', type: 'datetime' }, { key: 'age', label: 'Open for', type: 'minutes' }, { key: 'team', label: 'Assigned team', type: 'text' }], rows: openRows, total: null, chart: null },
      ],
      list: { title: 'Reports and their outcome', columns: reportListCols([{ key: 'res', label: 'Resolved', type: 'datetime' }, { key: 'ttr', label: 'Time to resolution', type: 'minutes' }, { key: 'outcome', label: 'Outcome', type: 'text' }, { key: 'reason', label: 'Rejection reason', type: 'text' }], c.loc),
        rows: recs.slice().sort((a, b) => b.rep - a.rep).map((f) => ({ ...baseRow(f, c.loc), res: ts(f.resolvedAt), ttr: f.reopened ? null : mins(f.rep, f.resolvedAt), outcome: f.status === 'RESOLVED' ? outcome(f) : null, reason: f.status === 'REJECTED' ? reason(f) : null })) },
    };
  }

  function buildBlockages(c) {
    const { db, cfg } = c, F = cfg.filters, now = Date.parse(c.generatedAt), notes = [];
    const expired = (b) => !!b.until && now > Date.parse(b.until);
    const items = db.blockages.filter((b) => { const t = ms(b.createdAt); return Number.isFinite(t) && t >= c.range.start && t < c.range.end && (!F.reasons || F.reasons.includes(b.reason)) && (!F.blockStatus || F.blockStatus.includes(expired(b) ? 'expired' : 'active')); });
    const active = items.filter((b) => !expired(b)).length, openEnded = items.filter((b) => !b.until).length;
    notes.push('A blockage that has been cleared is removed from EHBR, so only blockages still on the list appear here and no "cleared" date exists.');
    notes.push('Status is as of the time this report was generated. Blockages are not linked to incident reports in EHBR, so nothing is counted twice.');
    return {
      matching: items.length,
      summary: [{ label: 'Blockages in period', value: num(items.length), note: 'By the date they were recorded' }, { label: 'Active now', value: num(active) }, { label: 'Expired, still listed', value: num(items.length - active), note: 'Past their expected end time' }, { label: 'No end time set', value: num(openEnded), note: 'Active until removed' }],
      notes, definitions: [['Active', 'No expected end time, or the expected end time has not passed yet.'], ['Expired, still listed', 'The expected end time has passed but nobody has removed the record yet.'], ['Recorded', 'The date and time the blockage was added to EHBR.']],
      sections: [
        countSection('reason', 'Blockages by reason', items, (b) => b.reason || 'Not recorded', { label: 'Reason', noun: 'Blockages' }),
        countSection('status', 'Blockages by status', items, (b) => (expired(b) ? 'Expired, still listed' : b.until ? 'Active (end time set)' : 'Active (no end time)'), { label: 'Status', noun: 'Blockages' }),
        trendSection(items, (b) => Date.parse(b.createdAt), c.range, 'Blockages'),
      ],
      list: { title: 'Blockage records', columns: [{ key: 'at', label: 'Recorded', type: 'datetime' }, { key: 'where', label: 'Road / location', type: 'text' }, { key: 'reason', label: 'Reason', type: 'text' }, { key: 'until', label: 'Expected end', type: 'datetime' }, { key: 'status', label: 'Status', type: 'text' }],
        rows: items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => ({ at: Date.parse(b.createdAt), where: b.title || null, reason: b.reason || null, until: ts(ms(b.until)), status: expired(b) ? 'Expired' : 'Active' })) },
    };
  }

  function buildResidentActivity(c) {
    const { recs, db } = c, res = recs.filter((f) => f.source === 'resident'), staff = recs.length - res.length, notes = [];
    common(c, notes);
    notes.push('This summary contains counts only. It has no names, phone numbers, e-mail addresses, home addresses or account details.');
    if (staff) notes.push(`${num(staff)} report(s) recorded by barangay staff on behalf of residents are not counted here.`);
    notes.push(`Zone groups with fewer than ${SMALL_CELL} reports are combined, so a small group cannot point to an individual.`);
    const anon = res.filter((f) => f.anonymous).length, named = new Set(res.filter((f) => !f.anonymous && f.userId).map((f) => f.userId)).size;
    const registered = db.users.filter((u) => u.role === 'resident').length;
    const zoneRows = countRows(res, (f) => f.zone), special = new Set([ZONE_ANON, ZONE_NA]);
    const keep = zoneRows.filter((r) => special.has(r.k) || r.n >= SMALL_CELL), hidden = zoneRows.filter((r) => !special.has(r.k) && r.n < SMALL_CELL), hn = hidden.reduce((a, r) => a + r.n, 0);
    if (hn) keep.push({ k: `Other zones (fewer than ${SMALL_CELL} reports each)`, n: hn, p: pctOf(hn, res.length) });
    const zoneSec = { id: 'zone', title: "Reports by reporter's zone", note: ZONE_NOTE, columns: cols3("Reporter's zone"), rows: keep, total: { k: 'Total', n: res.length, p: res.length ? 100 : null }, chart: res.length ? { type: 'bar', labelKey: 'k', valueKey: 'n', unit: 'Number of reports' } : null };
    return {
      matching: res.length,
      summary: [{ label: 'Reports by residents', value: num(res.length) }, { label: 'Anonymous', value: num(anon), note: 'Identity hidden by the resident' }, { label: 'Residents who reported', value: num(named), note: `Named reports only. ${num(registered)} residents are registered now.` }, { label: 'Via SOS button', value: num(res.filter((f) => f.type === 'SOS Emergency').length) }],
      notes, definitions: [['Reports by residents', 'Resident-submitted reports in the period that match the filters.'], ['Residents who reported', 'Different residents with at least one non-anonymous report. Only a count, never names.'], ['Channel', 'SOS button = the one-touch SOS alert in the app; Report form = the regular report form.']],
      sections: [
        countSection('channel', 'Reports by channel', res, (f) => (f.type === 'SOS Emergency' ? 'SOS button' : 'Report form'), { label: 'Channel' }),
        trendSection(res, (f) => f.rep, c.range, 'Reports'),
        countSection('type', 'Reports by category', res, (f) => f.type, { label: 'Category' }),
        countSection('urgency', 'Reports by urgency', res, (f) => f.urgency, { label: 'Urgency', order: URG_ORDER }),
        zoneSec,
      ], list: null,
    };
  }

  function buildAnnouncements(c) {
    const { db, cfg } = c, F = cfg.filters;
    const items = db.announcements.filter((a) => { const t = ms(a.createdAt); return Number.isFinite(t) && t >= c.range.start && t < c.range.end && (!F.annCategories || F.annCategories.includes(a.category)); });
    const byCat = countRows(items, (a) => a.category || 'Not recorded');
    return {
      matching: items.length,
      summary: [{ label: 'Announcements', value: num(items.length), note: 'Published in the period' }, ...byCat.slice(0, 3).map((r) => ({ label: `Category: ${r.k}`, value: num(r.n) }))],
      notes: ['EHBR publishes an announcement as soon as it is saved, so there is no draft, scheduled or archived status to report.', 'Only the title, category and date are listed. Message text is not included.'],
      definitions: [['Published', 'The date and time the announcement was saved in EHBR.'], ['Category', 'Alert, event or advisory, as chosen by the author.']],
      sections: [countSection('category', 'Announcements by category', items, (a) => a.category || 'Not recorded', { label: 'Category', noun: 'Announcements' }), trendSection(items, (a) => Date.parse(a.createdAt), c.range, 'Announcements')],
      list: { title: 'Announcements', columns: [{ key: 'at', label: 'Published', type: 'datetime' }, { key: 'cat', label: 'Category', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'img', label: 'Has image', type: 'text' }],
        rows: items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((a) => ({ at: Date.parse(a.createdAt), cat: a.category || null, title: a.title || null, img: a.image ? 'Yes' : 'No' })) },
    };
  }

  const BUILDERS = { 'incident-summary': buildIncidentSummary, 'emergency-stats': buildEmergencyStats, response: buildResponse, resolution: buildResolution, blockages: buildBlockages, 'resident-activity': buildResidentActivity, announcements: buildAnnouncements };

  /** Builds the neutral doc from a cleaned config. Runs synchronously over the in-memory records = one consistent snapshot. */
  function buildDoc(cfg, user, { canLocation = false } = {}) {
    const db = ctx.getDb(), opts = optionSets(db), generatedAt = ctx.nowIso(), cat = CATEGORIES[cfg.category];
    const range = rangeFor(cfg.period, Date.parse(generatedAt));
    const isReports = ['incident-summary', 'emergency-stats', 'response', 'resolution', 'resident-activity'].includes(cfg.category);
    const sel = isReports ? selectReports(db, cfg, range.start, range.end, opts) : { recs: [], noDate: 0 };
    const loc = !!(cfg.includeLocation && canLocation && cat.detail);
    const part = BUILDERS[cfg.category]({ db, cfg, opts, range, recs: sel.recs, noDate: sel.noDate, loc, generatedAt });
    const matching = part.matching !== undefined ? part.matching : sel.recs.length;
    const notes = [...(part.notes || [])];
    if (range.inProgress) notes.unshift('This period has not ended yet. The figures cover the time up to the moment of generation.');
    if (loc) notes.unshift('This export includes the location text typed by reporters, which can contain addresses. Handle it as confidential.');
    const b = db.settings.barangay || {};
    return {
      category: cfg.category, title: cat.label, barangay: [b.name, b.city].filter(Boolean).join(', ') || 'Barangay',
      period: { label: range.label, start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString(), type: range.type }, tz: TZ, tzOffset: T.offsetLabel(Date.parse(generatedAt), TZ),
      filters: filterSummary(cfg), generatedAt, generatedBy: ctx.fullName(user), matching, empty: matching === 0,
      confidentiality: loc ? 'CONFIDENTIAL – contains location details typed by reporters. Do not share.' : 'INTERNAL – Barangay use only. No resident names or contact details.',
      summary: part.summary, notes, definitions: part.definitions || [], sections: part.sections, list: part.list || null, detailed: loc,
    };
  }

  /** Display-ready copy for the page: every value already formatted by the same code the PDF uses. */
  function previewOf(doc) {
    const fmtRows = (cols, rows) => rows.map((r) => cols.map((c) => X.formatCell(r[c.key], c, doc.tz)));
    const out = { ...doc, sections: doc.sections.map((s) => ({ id: s.id, title: s.title, note: s.note || '', columns: s.columns.map((c) => ({ label: c.label, type: c.type })), cells: fmtRows(s.columns, s.rows), total: s.total ? s.columns.map((c, i) => (i === 0 ? String(s.total[c.key] ?? 'Total') : X.formatCell(s.total[c.key], c, doc.tz))) : null,
      chart: s.chart ? { type: s.chart.type, unit: s.chart.unit, items: s.rows.map((r) => ({ label: String(r[s.chart.labelKey]), value: Number(r[s.chart.valueKey]) || 0, display: X.formatCell(r[s.chart.valueKey], s.columns.find((c) => c.key === s.chart.valueKey) || {}, doc.tz) })) } : null })) };
    out.list = doc.list ? { title: doc.list.title, total: doc.list.rows.length, columns: doc.list.columns.map((c) => ({ label: c.label, type: c.type })), cells: fmtRows(doc.list.columns, doc.list.rows.slice(0, PREVIEW_ROWS)) } : null;
    return out;
  }

  // ---------------------------------------------------------------- stored files + history
  const fileOf = (m) => path.join(REPORT_DIR, `${m.id}.${m.format}.bin`), metaOf = (id) => path.join(REPORT_DIR, `${id}.json`);
  const writeJson = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2), { mode: 0o600 }); fs.renameSync(t, f); };
  function getMeta(id) { if (!ID_RE.test(String(id))) throw new HttpError(404, 'Report not found.'); try { return JSON.parse(fs.readFileSync(metaOf(id), 'utf8')); } catch { throw new HttpError(404, 'Report not found.'); } }
  const listMetas = () => fs.readdirSync(REPORT_DIR).filter((f) => /^rg-.*\.json$/.test(f)).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const publicMeta = (m) => ({ id: m.id, category: m.category, categoryLabel: m.categoryLabel, period: m.period, filters: m.filters, format: m.format, formatLabel: FORMATS[m.format].label, status: m.status, createdAt: m.createdAt, createdBy: m.createdBy, size: m.size || 0, matching: m.matching, detailed: !!m.detailed, encrypted: !!m.encrypted, expiresAt: m.expiresAt, error: m.error || '', filename: m.filename });
  const tokens = new Map();
  function issueToken(m, user) {
    for (const [h, t] of tokens) if (t.exp < Date.now()) tokens.delete(h);
    const raw = crypto.randomBytes(24).toString('hex');
    tokens.set(crypto.createHash('sha256').update(raw).digest('hex'), { id: m.id, userId: user.id, exp: Date.now() + DOWNLOAD_TTL_MS });
    return `/api/admin/report-generator/history/${m.id}/file?t=${raw}`;
  }
  function cleanup() {
    const cutoff = Date.now() - RETENTION_DAYS * 864e5; let n = 0;
    for (const m of listMetas()) if (Date.parse(m.createdAt) < cutoff) { try { fs.rmSync(fileOf(m), { force: true }); fs.rmSync(metaOf(m.id), { force: true }); n++; } catch { /* ignore */ } }
    if (n) audit('expired files removed', { detail: `${n} generated report(s) older than ${RETENTION_DAYS} days` });
  }

  // ---------------------------------------------------------------- routes
  const BASE = '/api/admin/report-generator';
  route('GET', BASE + '/meta', 'user', ({ user }) => {
    need(user, 'view', 'use the Reports Generator');
    const db = ctx.getDb(), o = optionSets(db); delete o._usersById;
    return {
      tz: TZ, tzOffset: T.offsetLabel(Date.now(), TZ), today: T.fmtDate(Date.now(), TZ), retentionDays: RETENTION_DAYS, encrypted: !!fileKey, keyError, barangay: [db.settings.barangay.name, db.settings.barangay.city].filter(Boolean).join(', '),
      categories: Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, desc: c.desc, filters: c.filters, detail: c.detail, formats: Object.keys(FORMATS), csv: c.list ? 'Record list' : 'Summary tables' })),
      formats: Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => [k, v.label])), options: o, urgencies: URG_ORDER,
      can: { view: can(user, 'view'), export: can(user, 'export'), download: can(user, 'download'), detail: can(user, 'detail'), delete: can(user, 'delete'), audit: can(user, 'audit') },
    };
  });
  route('POST', BASE + '/preview', 'user', ({ user, body }) => {
    need(user, 'view', 'preview reports'); throttle(user, 'preview', 40);
    const cfg = cleanConfig(body.config, optionSets(ctx.getDb()));
    return previewOf(buildDoc(cfg, user, { canLocation: false }));
  });
  route('POST', BASE + '/generate', 'user', async ({ user, body, ip }) => {
    need(user, 'export', 'generate report files'); throttle(user, 'gen', 8);
    if (keyError) throw new HttpError(409, 'The encryption key setting is invalid, so files cannot be generated. Ask your system administrator to fix BACKUP_ENCRYPTION_KEY.');
    const format = str(body.format, 8); if (!FORMATS[format]) throw bad('Choose PDF, Excel (XLSX) or CSV.');
    const cfg = cleanConfig(body.config, optionSets(ctx.getDb()));
    let canLocation = false;
    if (cfg.includeLocation) { need(user, 'detail', 'include location details in an export'); await reauth(user, body.password, ip, 'report denied', null); canLocation = true; }
    const d = new Date(), id = `rg-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
    audit('report requested', { id, user, detail: `${cfg.category}, ${format}, ${JSON.stringify(cfg.period)}${filterSummary(cfg).length ? ', filters: ' + filterSummary(cfg).map(([k, v]) => `${k}=${v}`).join('; ') : ''}${canLocation ? ', with location text' : ''}` });
    const doc = buildDoc(cfg, user, { canLocation });
    const rows = doc.list ? doc.list.rows.length : 0;
    if (doc.empty) { audit('report not generated', { id, user, status: 'empty', detail: 'no records matched' }); throw new HttpError(409, 'No records match this period and these filters, so no file was created.'); }
    if (rows > MAX_RECORDS) { audit('report not generated', { id, user, status: 'too-large', detail: `${rows} rows` }); throw new HttpError(413, `That is ${num(rows)} records, more than the ${num(MAX_RECORDS)} a single file can hold. Choose a shorter period or add filters.`); }
    const stamp = T.fmtDateTime(Date.parse(doc.generatedAt), TZ).replace(/[-:]/g, '').replace(' ', '-');
    const filename = `EHBR_${slug(CATEGORIES[cfg.category].label)}_${slug(doc.period.label)}_${stamp}.${FORMATS[format].ext}`;
    const m = { id, category: cfg.category, categoryLabel: CATEGORIES[cfg.category].label, period: doc.period.label, filters: doc.filters.map(([k, v]) => `${k}: ${v}`).join(' · ') || 'No filters', format, status: 'failed', createdAt: doc.generatedAt, createdBy: ctx.fullName(user), createdById: user.id, matching: doc.matching, detailed: doc.detailed, encrypted: !!fileKey, size: 0, filename, expiresAt: new Date(Date.parse(doc.generatedAt) + RETENTION_DAYS * 864e5).toISOString(), error: '' };
    try {
      const buf = format === 'pdf' ? X.toPdf(doc) : format === 'xlsx' ? X.toXlsx(doc) : X.toCsv(doc);
      const sealed = seal(buf);
      fs.writeFileSync(fileOf(m), sealed, { mode: 0o600 });
      m.size = buf.length; m.status = 'completed'; writeJson(metaOf(id), m);
      audit('report generated', { id, user, detail: `${cfg.category}, ${format}, ${num(doc.matching)} record(s), ${buf.length} bytes` });
    } catch (e) {
      console.error('[reports] generation failed:', e);
      m.error = 'The file could not be created.'; try { fs.rmSync(fileOf(m), { force: true }); } catch { /* ignore */ }
      writeJson(metaOf(id), m); audit('report failed', { id, user, status: 'failed', detail: m.error });
      throw new HttpError(500, 'The report file could not be created. Nothing was saved. Please try again.');
    }
    return { ...publicMeta(m), url: issueToken(m, user), expiresInSeconds: DOWNLOAD_TTL_MS / 1000 };
  });
  route('GET', BASE + '/history', 'user', ({ user }) => { need(user, 'view', 'view report history'); return { items: listMetas().slice(0, 200).map(publicMeta), retentionDays: RETENTION_DAYS }; });
  route('POST', BASE + '/history/:id/download-link', 'user', async ({ user, params, body, ip }) => {
    need(user, 'download', 'download reports');
    const m = getMeta(params.id);
    if (m.status !== 'completed' || !fs.existsSync(fileOf(m))) throw new HttpError(404, 'This file is no longer available.');
    if (m.detailed) await reauth(user, body.password, ip, 'download denied', m.id);
    audit('download link issued', { id: m.id, user });
    return { url: issueToken(m, user), expiresInSeconds: DOWNLOAD_TTL_MS / 1000, filename: m.filename };
  });
  route('GET', BASE + '/history/:id/file', null, ({ res, params, query }) => {
    const h = crypto.createHash('sha256').update(query.get('t') || '').digest('hex'), t = tokens.get(h);
    tokens.delete(h);
    if (!t || t.id !== params.id || t.exp < Date.now()) throw new HttpError(403, 'This download link has expired. Request a new one.');
    const u = ctx.getDb().users.find((x) => x.id === t.userId);
    if (!can(u, 'download')) throw new HttpError(403, 'You do not have permission to download reports.');
    const m = getMeta(params.id);
    let raw; try { raw = fs.readFileSync(fileOf(m)); } catch { throw new HttpError(404, 'This file is no longer available.'); }
    const buf = unseal(raw, m.encrypted);
    audit('report downloaded', { id: m.id, user: u });
    res.writeHead(200, { 'Content-Type': FORMATS[m.format].mime, 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename="${m.filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.end(buf);
    return { __handled: true };
  });
  route('POST', BASE + '/history/:id/delete', 'user', ({ user, params }) => {
    need(user, 'delete', 'delete generated reports');
    const m = getMeta(params.id); fs.rmSync(fileOf(m), { force: true }); fs.rmSync(metaOf(m.id), { force: true });
    audit('generated report deleted', { id: m.id, user }); return { ok: true };
  });
  route('GET', BASE + '/audit', 'user', ({ user }) => {
    need(user, 'audit', 'view the report audit history');
    let lines = []; try { lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean); } catch { /* none yet */ }
    return { items: lines.slice(-100).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) };
  });

  // failed leftovers from a crash, then retention
  for (const f of fs.readdirSync(REPORT_DIR)) if (f.endsWith('.tmp')) fs.rmSync(path.join(REPORT_DIR, f), { force: true });
  cleanup(); setInterval(cleanup, 6 * 3600 * 1000).unref();
  console.log(`  Report files   ${REPORT_DIR} (kept ${RETENTION_DAYS} days, ${fileKey ? 'encrypted' : 'NOT encrypted – set BACKUP_ENCRYPTION_KEY'}, ${TZ})`);
  return { _test: { buildDoc, cleanConfig, optionSets, previewOf, rangeFor, cleanup, listMetas, getMeta, tokens, CATEGORIES } };
}

module.exports = { register, PERMS, CATEGORIES };