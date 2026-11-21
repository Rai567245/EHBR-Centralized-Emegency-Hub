'use strict';
/**
 * Backup & Restore for the Emergency Hub server.
 *
 *  - A backup is ONE file:  <id>.tar.gz  (or <id>.tar.gz.enc when BACKUP_ENCRYPTION_KEY is set).
 *    It is a standard tar archive, so an administrator can open it with 7-Zip / tar to inspect it.
 *      data/<table>.json   every table (users, reports, announcements, centers, blockages, notifications, activity, meta)
 *      uploads/<file>      photos and announcement images
 *      manifest.json       counts + SHA-256 of every entry (written last)
 *  - Metadata lives next to the file (<id>.json), NOT in the database, so a restore can never erase backup history.
 *  - Every action is also appended to audit.jsonl (append-only) and to the normal activity log.
 *  - sessions (login tokens) and resets (one-time codes) are never backed up or touched by a restore.
 *
 * Env:  BACKUP_DIR (default ./backups)   BACKUP_ENCRYPTION_KEY (64 hex chars, optional)   BACKUP_TZ (default Asia/Manila)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Readable, Transform, pipeline } = require('stream');
const { once } = require('events');

const FORMAT = 1;                 // archive layout
const SCHEMA = 1;                 // bump when the data model changes in a way old backups cannot be restored into
const LISTS = ['users', 'reports', 'announcements', 'centers', 'blockages', 'notifications'];
const TABLES = [...LISTS, 'activity', 'meta'];
const MAGIC = Buffer.from('EHBK1');
const ID_RE = /^bk-\d{8}-\d{6}-[a-f0-9]{4}$/;
const UPLOAD_NAME_RE = /^[\w][\w.\-]{0,89}$/;
const MAX_JSON_ENTRY = 256 * 1024 * 1024;
const MAX_TOTAL = 4 * 1024 * 1024 * 1024;
const DOWNLOAD_TTL_MS = 60 * 1000;

/** Who may do what. Today every staff account is role 'admin'. When you split roles, list only 'superadmin'
 *  on restore / delete / download / schedule. A user can also be granted a single action with
 *  user.permissions = ['backup.restore', ...] without changing their role. */
const PERMS = {
  view: ['admin', 'superadmin'],
  create: ['admin', 'superadmin'],
  validate: ['admin', 'superadmin'],
  audit: ['admin', 'superadmin'],
  download: ['admin', 'superadmin'],
  schedule: ['admin', 'superadmin'],
  delete: ['admin', 'superadmin'],
  restore: ['admin', 'superadmin'],
};

const DEFAULT_CONFIG = {
  enabled: false, frequency: 'daily', time: '02:00', weekday: 1, retentionDays: 30, keepMinimum: 3,
  lastAutoKey: null, lastAutoAt: null, lastAutoStatus: null, lastCleanupKey: null, lastRestore: null,
};

/** A message that is safe to show an administrator. Anything else is logged and shown as a generic error. */
class BackupError extends Error {}
const safeMsg = (e) => (e instanceof BackupError ? e.message : 'Unexpected error. Check the server log.');

// ---------------------------------------------------------------- tar (minimal ustar writer / reader)
function tarHeader(name, size) {
  const nb = Buffer.from(name, 'utf8');
  if (nb.length > 100) throw new BackupError('File name too long for the archive.');
  const h = Buffer.alloc(512);
  nb.copy(h, 0);
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
  h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
const tarPad = (size) => Buffer.alloc((512 - (size % 512)) % 512);

/** Reads a tar stream. open(name, size) must return { write(chunk), end() }. Drains the stream to the very end so
 *  gzip CRC and AES-GCM authentication are always checked. */
async function untar(input, open) {
  const it = input[Symbol.asyncIterator]();
  let buf = Buffer.alloc(0);
  const fill = async (n) => {
    while (buf.length < n) {
      const r = await it.next();
      if (r.done) return false;
      buf = buf.length ? Buffer.concat([buf, r.value]) : r.value;
    }
    return true;
  };
  const truncated = () => new BackupError('The backup file is incomplete (truncated).');
  for (;;) {
    if (!(await fill(512))) { if (buf.length === 0) break; throw truncated(); }
    const h = buf.subarray(0, 512); buf = buf.subarray(512);
    if (h.every((b) => b === 0)) break;
    let sum = 0; for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : h[i];
    if (parseInt(h.toString('ascii', 148, 154), 8) !== sum) throw new BackupError('The backup archive is damaged (bad header).');
    const type = String.fromCharCode(h[156]);
    if (type !== '0' && type !== '\0') throw new BackupError('The backup archive contains an unsupported entry.');
    const name = h.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const size = parseInt(h.toString('ascii', 124, 135).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new BackupError('The backup archive is damaged (bad size).');
    const sink = await open(name, size);
    let left = size;
    while (left > 0) {
      if (!(await fill(1))) throw truncated();
      const k = Math.min(buf.length, left);
      await sink.write(buf.subarray(0, k)); buf = buf.subarray(k); left -= k;
    }
    const pad = (512 - (size % 512)) % 512;
    if (pad) { if (!(await fill(pad))) throw truncated(); buf = buf.subarray(pad); }
    await sink.end();
  }
  while (!(await it.next()).done) { /* drain: triggers CRC / auth-tag verification */ }
}

// ---------------------------------------------------------------- small helpers
const pad2 = (n) => String(n).padStart(2, '0');
function sha256File(file) {
  return new Promise((ok, no) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', no).on('end', () => ok(h.digest('hex')));
  });
}
const writeJsonAtomic = (file, obj) => { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 2), { mode: 0o600 }); fs.renameSync(t, file); };
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ } };

function register(ctx) {
  const { route, HttpError, UPLOAD_DIR, DATA_FILE, pg, maintenance } = ctx;
  const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, 'backups'));
  const TZ = process.env.BACKUP_TZ || 'Asia/Manila';
  const CONFIG_FILE = path.join(BACKUP_DIR, 'config.json');
  const AUDIT_FILE = path.join(BACKUP_DIR, 'audit.jsonl');
  const tokens = new Map();         // sha256(token) -> { id, userId, exp }
  let state = null;                 // the one running operation: { op, id, phase, startedAt }
  let keyError = '';
  let key = null;

  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  try {
    const k = process.env.BACKUP_ENCRYPTION_KEY || '';
    if (k) { if (!/^[a-f0-9]{64}$/i.test(k)) throw new Error('BACKUP_ENCRYPTION_KEY must be exactly 64 hex characters.'); key = Buffer.from(k, 'hex'); }
  } catch (e) { keyError = e.message; console.error('[backup]', e.message); }

  // ---- config (schedule + retention). Kept in BACKUP_DIR so a restore never reverts it.
  const readConfig = () => { try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { return { ...DEFAULT_CONFIG }; } };
  const writeConfig = (patch) => { const c = { ...readConfig(), ...patch }; writeJsonAtomic(CONFIG_FILE, c); return c; };

  // ---- permissions + audit
  const can = (user, action) => !!user && ((PERMS[action] || []).includes(user.role) || (Array.isArray(user.permissions) && user.permissions.includes('backup.' + action)));
  const need = (user, action, what) => { if (!can(user, action)) throw new HttpError(403, `You do not have permission to ${what}.`); };
  const whoName = (u) => (u ? ctx.fullName(u) : 'System (scheduled)');
  function audit(action, { id = null, user = null, status = 'ok', detail = '', source = 'admin' } = {}) {
    const rec = { at: ctx.nowIso(), action, id, userId: user ? user.id : null, by: whoName(user), source, status, detail: String(detail).slice(0, 300) };
    try { fs.appendFileSync(AUDIT_FILE, JSON.stringify(rec) + '\n', { mode: 0o600 }); } catch (e) { console.error('[backup] audit write failed:', e.message); }
    try { ctx.log(`Backup: ${action}${id ? ' ' + id : ''} – ${status} (${rec.by})`, 'audit'); ctx.save().catch(() => {}); } catch { /* the DB may be mid-restore */ }
  }

  // ---- metadata files
  const metaFile = (id) => path.join(BACKUP_DIR, id + '.json');
  const archiveFile = (m) => path.join(BACKUP_DIR, m.id + (m.encrypted ? '.tar.gz.enc' : '.tar.gz'));
  const saveMeta = (m) => writeJsonAtomic(metaFile(m.id), m);
  function getMeta(id) {
    if (!ID_RE.test(String(id))) throw new HttpError(404, 'Backup not found.');
    try { return JSON.parse(fs.readFileSync(metaFile(id), 'utf8')); } catch { throw new HttpError(404, 'Backup not found.'); }
  }
  function listMetas() {
    const out = [];
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (!/^bk-.*\.json$/.test(f)) continue;
      try { out.push(JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8'))); } catch { /* skip unreadable */ }
    }
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  const records = (m) => Object.values(m.counts || {}).reduce((a, b) => a + b, 0);
  const publicMeta = (m) => ({
    id: m.id, type: m.type, source: m.source, status: m.status, createdAt: m.createdAt, finishedAt: m.finishedAt || null,
    createdBy: m.createdByName, size: m.size || 0, encrypted: !!m.encrypted, protected: !!m.protected, notes: m.notes || '',
    records: records(m), uploads: m.uploads || 0, error: m.error || '',
    validation: { status: (m.validation && m.validation.status) || 'unchecked', checkedAt: m.validation && m.validation.checkedAt || null, error: m.validation && m.validation.error || '' },
    filename: `ehbr-${m.id}${m.encrypted ? '.tar.gz.enc' : '.tar.gz'}`,
  });
  const isUsable = (m) => m.status === 'completed' && m.validation && m.validation.status === 'valid';

  // ---- one operation at a time
  function acquire(op, id) {
    if (state) throw new HttpError(409, state.op === 'restore' ? 'A restore is in progress. Please wait.' : 'Another backup operation is already running. Please wait.');
    state = { op, id, phase: 'starting', startedAt: ctx.nowIso() };
  }
  const release = () => { state = null; };

  // ---- time zone helpers (schedule is evaluated in BACKUP_TZ)
  function localParts(d) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
  }
  function zonedToUtc(y, m, d, h, mi) {
    const guess = Date.UTC(y, m - 1, d, h, mi), lp = localParts(new Date(guess));
    return new Date(guess - (Date.UTC(lp.y, lp.m - 1, lp.d, lp.h, lp.mi) - guess));
  }
  function nextRunAt(cfg) {
    if (!cfg.enabled) return null;
    const [H, M] = cfg.time.split(':').map(Number), now = Date.now();
    for (let i = 0; i <= 8; i++) {
      const lp = localParts(new Date(now + i * 864e5));
      if (cfg.frequency === 'weekly' && lp.wd !== cfg.weekday) continue;
      const at = zonedToUtc(lp.y, lp.m, lp.d, H, M);
      const key = `${lp.y}-${pad2(lp.m)}-${pad2(lp.d)}`;
      if (at.getTime() > now || (i === 0 && cfg.lastAutoKey !== key)) return (at.getTime() > now ? at : new Date(now)).toISOString();
    }
    return null;
  }

  // ---------------------------------------------------------------- reading backups
  async function openArchive(m) {
    const file = archiveFile(m);
    let st; try { st = fs.statSync(file); } catch { throw new BackupError('The backup file is missing.'); }
    const gunzip = zlib.createGunzip();
    if (!m.encrypted) { pipeline(fs.createReadStream(file), gunzip, () => {}); return gunzip; }
    if (!key) throw new BackupError(keyError || 'This backup is encrypted but no encryption key is configured on the server.');
    if (st.size < MAGIC.length + 12 + 16 + 1) throw new BackupError('The backup file is incomplete (truncated).');
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(MAGIC.length + 12), tag = Buffer.alloc(16);
    try { fs.readSync(fd, head, 0, head.length, 0); fs.readSync(fd, tag, 0, 16, st.size - 16); } finally { fs.closeSync(fd); }
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupError('Unrecognised backup file format.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    pipeline(fs.createReadStream(file, { start: head.length, end: st.size - 17 }), decipher, gunzip, () => {});
    return gunzip;
  }

  /** Full integrity check. Returns { ok, error, manifest, tables }. With extractTo, uploads are written there (for a restore). */
  async function checkArchive(m, { extractTo = null } = {}) {
    try {
      if (m.status !== 'completed') throw new BackupError('This backup did not complete, so it cannot be used.');
      const file = archiveFile(m);
      let st; try { st = fs.statSync(file); } catch { throw new BackupError('The backup file is missing.'); }
      if (st.size !== m.size) throw new BackupError('The backup file size does not match its record (file changed or damaged).');
      if ((await sha256File(file)) !== m.sha256) throw new BackupError('Checksum mismatch: the backup file was modified or is corrupted.');
      if (extractTo) fs.mkdirSync(extractTo, { recursive: true });

      const seen = {}; let total = 0;
      const open = async (name, size) => {
        const isData = /^data\/[a-z]+\.json$/.test(name) && TABLES.includes(name.slice(5, -5));
        const isUp = name.startsWith('uploads/') && UPLOAD_NAME_RE.test(name.slice(8));
        if (!isData && !isUp && name !== 'manifest.json') throw new BackupError('The backup contains an unexpected entry and was rejected.');
        if (seen[name]) throw new BackupError('The backup contains a duplicate entry and was rejected.');
        total += size;
        if (total > MAX_TOTAL || (!isUp && size > MAX_JSON_ENTRY)) throw new BackupError('The backup is larger than the allowed limit.');
        const h = crypto.createHash('sha256'), chunks = isUp ? null : [];
        const ws = isUp && extractTo ? fs.createWriteStream(path.join(extractTo, name.slice(8)), { mode: 0o600 }) : null;
        return {
          async write(c) { h.update(c); if (chunks) chunks.push(c); if (ws && !ws.write(c)) await once(ws, 'drain'); },
          async end() { if (ws) { ws.end(); await once(ws, 'finish'); } seen[name] = { size, sha: h.digest('hex'), data: chunks ? Buffer.concat(chunks) : null }; },
        };
      };
      try { await untar(await openArchive(m), open); }
      catch (e) { if (e instanceof BackupError) throw e; throw new BackupError(m.encrypted ? 'Could not read the backup (damaged, or the encryption key is wrong).' : 'Could not read the backup (damaged archive).'); }

      if (!seen['manifest.json']) throw new BackupError('The backup has no manifest.');
      let manifest; try { manifest = JSON.parse(seen['manifest.json'].data.toString('utf8')); } catch { throw new BackupError('The backup manifest is unreadable.'); }
      if (manifest.app !== 'ehbr') throw new BackupError('This file is not an Emergency Hub backup.');
      if (manifest.format !== FORMAT) throw new BackupError(`Unsupported backup format (${manifest.format}).`);
      if (manifest.schema !== SCHEMA) throw new BackupError(`This backup was made by a different data version (${manifest.schema}; this server expects ${SCHEMA}) and cannot be restored here.`);
      for (const [name, f] of Object.entries(manifest.files || {})) {
        if (!seen[name] || seen[name].sha !== f.sha256 || seen[name].size !== f.size) throw new BackupError(`Integrity check failed for ${name}.`);
      }
      for (const name of Object.keys(seen)) if (name !== 'manifest.json' && !(manifest.files || {})[name]) throw new BackupError('The backup contains an entry that is not listed in its manifest.');
      const tables = {};
      for (const t of TABLES) {
        const e = seen[`data/${t}.json`];
        if (!e) throw new BackupError(`The backup is missing the ${t} data.`);
        let rows; try { rows = JSON.parse(e.data.toString('utf8')); } catch { throw new BackupError(`The ${t} data is unreadable.`); }
        if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.key !== 'string' || typeof r.doc !== 'object' || r.doc === null)) throw new BackupError(`The ${t} data has an invalid structure.`);
        if (rows.length !== (manifest.tables[t] || {}).count) throw new BackupError(`The ${t} record count does not match the manifest.`);
        tables[t] = rows;
      }
      if (!tables.meta.some((r) => r.key === 'settings')) throw new BackupError('The backup has no settings record.');
      return { ok: true, manifest, tables, uploadNames: Object.keys(seen).filter((n) => n.startsWith('uploads/')).map((n) => n.slice(8)) };
    } catch (e) {
      if (!(e instanceof BackupError)) console.error('[backup] check failed:', e);
      return { ok: false, error: safeMsg(e) };
    }
  }

  // ---------------------------------------------------------------- creating backups
  function newMeta({ type, source, user, notes = '' }) {
    const d = new Date(), id = `bk-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
    const m = {
      id, type, source, status: 'queued', createdAt: ctx.nowIso(), finishedAt: null, createdById: user ? user.id : null, createdByName: whoName(user),
      encrypted: !!key, size: 0, sha256: null, counts: {}, uploads: 0, notes: String(notes || '').slice(0, 200), protected: false,
      validation: { status: 'unchecked', checkedAt: null, error: '' }, error: '', engine: pg ? 'postgres' : 'file',
    };
    saveMeta(m);
    return m;
  }

  const fileTables = (db) => {
    const t = {};
    for (const n of LISTS) t[n] = db[n].map((d) => ({ key: String(d.id), doc: d, at: null }));
    t.activity = db.activity.map((d, i) => ({ key: String(i), doc: d, at: null }));
    t.meta = [{ key: 'settings', doc: db.settings, at: null }, { key: 'counters', doc: db.counters, at: null }];
    return JSON.parse(JSON.stringify(t));   // deep copy in one tick = consistent snapshot
  };
  const uploadFiles = () => { try { return fs.readdirSync(UPLOAD_DIR, { withFileTypes: true }).filter((e) => e.isFile() && UPLOAD_NAME_RE.test(e.name)).map((e) => e.name); } catch { return []; } };

  /** Does the work for an already-created meta. Never throws: failures are recorded on the meta. */
  async function runBackup(m, { releaseLock = true } = {}) {
    const part = path.join(BACKUP_DIR, m.id + '.part');
    try {
      if (keyError) throw new BackupError('The backup encryption key is invalid. Fix BACKUP_ENCRYPTION_KEY and restart the server.');
      m.status = 'in_progress'; saveMeta(m); if (state) { state.id = m.id; state.phase = 'snapshot'; }
      if (pg) await pg.flush();
      const tables = pg ? await pg.dumpAll() : fileTables(ctx.getDb());
      const names = uploadFiles();
      const jsonBufs = Object.fromEntries(TABLES.map((t) => [t, Buffer.from(JSON.stringify(tables[t] || []))]));
      let need = Object.values(jsonBufs).reduce((a, b) => a + b.length, 0);
      for (const n of names) { try { need += fs.statSync(path.join(UPLOAD_DIR, n)).size; } catch { /* vanished */ } }
      try { const s = fs.statfsSync(BACKUP_DIR); if (s.bavail * s.bsize < need + 20 * 1024 * 1024) throw new BackupError('Not enough free storage space to create a backup.'); } catch (e) { if (e instanceof BackupError) throw e; }

      if (state) state.phase = 'writing';
      const manifest = { app: 'ehbr', format: FORMAT, schema: SCHEMA, createdAt: m.createdAt, engine: m.engine, encrypted: !!key, tables: {}, files: {}, uploads: { count: 0, bytes: 0 } };
      async function* entries() {
        for (const t of TABLES) {
          const b = jsonBufs[t], name = `data/${t}.json`;
          manifest.tables[t] = { count: (tables[t] || []).length };
          manifest.files[name] = { size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
          yield tarHeader(name, b.length); yield b; yield tarPad(b.length);
        }
        for (const n of names) {
          let b; try { b = fs.readFileSync(path.join(UPLOAD_DIR, n)); } catch { continue; }   // file removed while we ran: skip it
          const name = `uploads/${n}`;
          manifest.files[name] = { size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
          manifest.uploads.count++; manifest.uploads.bytes += b.length;
          yield tarHeader(name, b.length); yield b; yield tarPad(b.length);
        }
        const mb = Buffer.from(JSON.stringify(manifest, null, 2));
        yield tarHeader('manifest.json', mb.length); yield mb; yield tarPad(mb.length);
        yield Buffer.alloc(1024);
      }
      const out = fs.createWriteStream(part, { mode: 0o600 });
      const stages = [Readable.from(entries()), zlib.createGzip({ level: 6 })];
      if (key) {
        const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        out.write(Buffer.concat([MAGIC, iv]));
        stages.push(cipher, new Transform({ transform(c, e, cb) { cb(null, c); }, flush(cb) { this.push(cipher.getAuthTag()); cb(); } }));
      }
      await new Promise((ok, no) => pipeline(...stages, out, (e) => (e ? no(e) : ok())));
      fs.renameSync(part, archiveFile(m));
      m.size = fs.statSync(archiveFile(m)).size; m.sha256 = await sha256File(archiveFile(m));
      m.counts = Object.fromEntries(TABLES.map((t) => [t, manifest.tables[t].count])); m.uploads = manifest.uploads.count;
      m.status = 'completed'; m.finishedAt = ctx.nowIso(); saveMeta(m);

      if (state) state.phase = 'verifying';
      const v = await checkArchive(m);
      m.validation = { status: v.ok ? 'valid' : 'invalid', checkedAt: ctx.nowIso(), error: v.ok ? '' : v.error };
      saveMeta(m);
      audit(m.type === 'pre-restore' ? 'safety backup created' : 'backup created', { id: m.id, user: m.createdById ? { id: m.createdById, firstName: m.createdByName, lastName: '' } : null, source: m.source, status: v.ok ? 'ok' : 'created-but-invalid', detail: v.ok ? `${m.type}, ${m.size} bytes` : v.error });
    } catch (e) {
      if (!(e instanceof BackupError)) console.error('[backup] failed:', e);
      m.status = 'failed'; m.error = safeMsg(e); m.finishedAt = ctx.nowIso(); saveMeta(m);
      rmrf(part); rmrf(archiveFile(m));
      audit('backup failed', { id: m.id, source: m.source, status: 'failed', detail: m.error });
    } finally { if (releaseLock) release(); }
    return m;
  }

  // ---------------------------------------------------------------- retention
  function cleanup(user = null, source = 'schedule') {
    const cfg = readConfig(), now = Date.now(), all = listMetas(), removed = [];
    const usable = all.filter(isUsable);                                   // newest first
    const keep = new Set(usable.slice(0, Math.max(1, cfg.keepMinimum)).map((m) => m.id));
    for (const m of all) {
      if (state && state.id === m.id) continue;
      if (m.status === 'failed') { if (now - Date.parse(m.createdAt) > 7 * 864e5) removed.push(m); continue; }   // clear failed debris after a week
      if (m.protected || keep.has(m.id) || m.status !== 'completed') continue;
      if (now - Date.parse(m.createdAt) > cfg.retentionDays * 864e5) removed.push(m);
    }
    for (const m of removed) { rmrf(archiveFile(m)); rmrf(metaFile(m.id)); }
    if (removed.length) audit('retention cleanup', { user, source, detail: `removed ${removed.length} expired backup(s)` });
    return removed.length;
  }

  // ---------------------------------------------------------------- restore
  async function applyBackup(v, extractedDir) {
    const tables = v.tables;
    if (pg) {
      await pg.flush();                                                     // no save may be in flight while tables are replaced
      await pg.restoreAll(tables);                                          // one transaction: all or nothing
      ctx.setDb(ctx.normalize(await pg.loadInto(ctx.emptyDb())));
      const have = await pg.countAll();
      for (const t of TABLES) if (have[t] !== v.manifest.tables[t].count) throw new BackupError(`Verification failed after restore (${t}).`);
    } else {
      const cur = ctx.getDb(), raw = {};
      for (const t of LISTS) raw[t] = tables[t].map((r) => r.doc);
      raw.activity = tables.activity.map((r) => r.doc);
      for (const r of tables.meta) raw[r.key] = r.doc;
      raw.sessions = cur.sessions; raw.resets = cur.resets;
      const tmp = DATA_FILE + '.restore.tmp';
      fs.writeFileSync(tmp, JSON.stringify(raw, null, 2)); fs.renameSync(tmp, DATA_FILE);
      ctx.setDb(ctx.normalize(raw));
      const db = ctx.getDb();
      for (const t of LISTS) if (db[t].length !== v.manifest.tables[t].count) throw new BackupError(`Verification failed after restore (${t}).`);
    }
    const db = ctx.getDb();                                                 // keep sessions only for users that still exist
    const ids = new Set(db.users.map((u) => u.id));
    for (const [tok, s] of Object.entries(db.sessions)) if (!ids.has(s.userId)) delete db.sessions[tok];
    if (extractedDir) {                                                     // photos: copy in, never delete newer files
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      for (const n of v.uploadNames) fs.copyFileSync(path.join(extractedDir, n), path.join(UPLOAD_DIR, n));
    }
    await ctx.save();
  }

  async function runRestore(m, v, extractedDir, user) {
    const why = (e) => (e instanceof BackupError ? e.message : 'The restore could not be completed.');
    const setPhase = (p) => { if (state) state.phase = p; };
    const result = { id: m.id, at: ctx.nowIso(), by: whoName(user), status: 'failed', message: '' };
    maintenance.on = true;
    let pre = null, rollbackDir = null;
    try {
      setPhase('safety backup');
      pre = newMeta({ type: 'pre-restore', source: 'restore', user, notes: `Automatic safety copy before restoring ${m.id}` });
      await runBackup(pre, { releaseLock: false });
      if (!isUsable(pre)) throw new BackupError('The safety backup could not be created, so the restore was cancelled. Nothing was changed.');
      setPhase('restoring');
      try {
        await applyBackup(v, extractedDir);
      } catch (e) {
        if (!(e instanceof BackupError)) console.error('[backup] restore failed:', e);
        setPhase('rolling back');
        try {
          rollbackDir = path.join(UPLOAD_DIR, `.rollback-${pre.id}`);
          const sv = await checkArchive(pre, { extractTo: rollbackDir });
          if (!sv.ok) throw new BackupError(sv.error);
          await applyBackup(sv, rollbackDir);
          throw new BackupError(`${why(e)} The system was returned to its previous state from the safety backup (${pre.id}).`);
        } catch (e2) {
          if (e2 instanceof BackupError && /returned to its previous state/.test(e2.message)) throw e2;
          console.error('[backup] ROLLBACK FAILED:', e2);
          throw new BackupError(`${why(e)} Automatic recovery also failed. Restore manually from safety backup ${pre.id}.`);
        }
      }
      result.status = 'completed'; result.message = `Restored from ${m.id}. A safety copy of the previous data was kept as ${pre.id}.`;
      audit('restore completed', { id: m.id, user, status: 'ok', detail: `safety backup ${pre.id}` });
    } catch (e) {
      result.message = safeMsg(e);
      audit('restore failed', { id: m.id, user, status: 'failed', detail: result.message });
    } finally {
      maintenance.on = false;
      rmrf(extractedDir); if (rollbackDir) rmrf(rollbackDir);
      try { writeConfig({ lastRestore: result }); } catch { /* ignore */ }
      release();
    }
  }

  // ---------------------------------------------------------------- re-authentication for high-risk actions
  async function reauth(user, password, ip, action, id) {
    const k = `${ip}|reauth:${user.id}`, pk = ctx.limiter.peek('loginFail', k);
    if (!pk.ok) throw new HttpError(429, 'Too many wrong passwords. Try again in a few minutes.', pk.retryAfter);
    const ok = await ctx.checkPw(typeof password === 'string' ? password.slice(0, 200) : '', user.passwordHash);
    if (!ok) { ctx.limiter.hit('loginFail', k); audit(action, { id, user, status: 'denied', detail: 'wrong password' }); throw new HttpError(403, 'Incorrect password.'); }
    ctx.limiter.reset('loginFail', k);
  }

  // ---------------------------------------------------------------- routes
  const summary = () => {
    const all = listMetas(), cfg = readConfig(), ok = all.filter(isUsable);
    let free = null; try { const s = fs.statfsSync(BACKUP_DIR); free = s.bavail * s.bsize; } catch { /* unavailable */ }
    return {
      total: all.filter((m) => m.status === 'completed').length, usable: ok.length,
      lastSuccessful: ok[0] ? publicMeta(ok[0]) : null, lastAttempt: all[0] ? publicMeta(all[0]) : null,
      storageBytes: all.reduce((a, m) => a + (m.size || 0), 0), freeBytes: free,
      encryption: { enabled: !!key, error: keyError },
      schedule: { enabled: cfg.enabled, frequency: cfg.frequency, time: cfg.time, weekday: cfg.weekday, retentionDays: cfg.retentionDays, keepMinimum: cfg.keepMinimum, timezone: TZ, nextRun: nextRunAt(cfg), lastAutoAt: cfg.lastAutoAt, lastAutoStatus: cfg.lastAutoStatus },
    };
  };
  const live = () => ({ operation: state ? { op: state.op, id: state.id, phase: state.phase, startedAt: state.startedAt } : null, lastRestore: readConfig().lastRestore });
  const my = (u) => ({ view: can(u, 'view'), create: can(u, 'create'), validate: can(u, 'validate'), download: can(u, 'download'), schedule: can(u, 'schedule'), delete: can(u, 'delete'), restore: can(u, 'restore'), audit: can(u, 'audit') });

  route('GET', '/api/admin/backups/status', 'user', ({ user }) => { need(user, 'view', 'view backups'); return { ...live(), lastAttempt: (listMetas()[0] && publicMeta(listMetas()[0])) || null }; });
  route('GET', '/api/admin/backups/audit', 'user', ({ user }) => {
    need(user, 'audit', 'view the backup audit history');
    let lines = []; try { lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean); } catch { /* none yet */ }
    return { items: lines.slice(-100).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) };
  });
  route('GET', '/api/admin/backups', 'user', ({ user }) => {
    need(user, 'view', 'view backups');
    return { items: listMetas().slice(0, 300).map(publicMeta), summary: summary(), ...live(), can: my(user) };
  });
  route('POST', '/api/admin/backups', 'user', ({ user, body }) => {
    need(user, 'create', 'create backups');
    if (keyError) throw new HttpError(409, 'The backup encryption key is invalid. Fix BACKUP_ENCRYPTION_KEY and restart the server.');
    acquire('backup', null);
    let m; try { m = newMeta({ type: 'manual', source: 'admin', user, notes: body.notes }); } catch (e) { release(); throw e; }
    runBackup(m).then(() => cleanup(user, 'admin')).catch((e) => console.error('[backup]', e));   // runs in the background; the page polls /status
    return publicMeta(m);
  });
  route('POST', '/api/admin/backups/:id/validate', 'user', async ({ user, params }) => {
    need(user, 'validate', 'validate backups');
    const m = getMeta(params.id); acquire('validate', m.id);
    try {
      state.phase = 'validating';
      const v = await checkArchive(m);
      m.validation = { status: v.ok ? 'valid' : 'invalid', checkedAt: ctx.nowIso(), error: v.ok ? '' : v.error }; saveMeta(m);
      audit('backup validated', { id: m.id, user, status: v.ok ? 'valid' : 'invalid', detail: v.ok ? '' : v.error });
      return publicMeta(m);
    } finally { release(); }
  });
  route('POST', '/api/admin/backups/:id/protect', 'user', ({ user, params, body }) => {
    need(user, 'delete', 'change backup protection');
    const m = getMeta(params.id); m.protected = !!body.protected; saveMeta(m);
    audit(m.protected ? 'backup protected' : 'backup unprotected', { id: m.id, user });
    return publicMeta(m);
  });
  route('POST', '/api/admin/backups/:id/download-link', 'user', async ({ user, params, body, ip }) => {
    need(user, 'download', 'download backups');
    const m = getMeta(params.id);
    if (m.status !== 'completed') throw new HttpError(409, 'This backup is not available for download.');
    await reauth(user, body.password, ip, 'download denied', m.id);
    for (const [h, t] of tokens) if (t.exp < Date.now()) tokens.delete(h);
    const raw = crypto.randomBytes(24).toString('hex');
    tokens.set(crypto.createHash('sha256').update(raw).digest('hex'), { id: m.id, userId: user.id, exp: Date.now() + DOWNLOAD_TTL_MS });
    audit('download link issued', { id: m.id, user });
    return { url: `/api/admin/backups/${m.id}/file?t=${raw}`, expiresInSeconds: DOWNLOAD_TTL_MS / 1000 };
  });
  // Single-use, 60-second link (a browser download cannot send the Authorization header).
  route('GET', '/api/admin/backups/:id/file', null, ({ res, params, query }) => {
    const h = crypto.createHash('sha256').update(query.get('t') || '').digest('hex'), t = tokens.get(h);
    tokens.delete(h);
    if (!t || t.id !== params.id || t.exp < Date.now()) throw new HttpError(403, 'This download link has expired. Request a new one.');
    const u = ctx.getDb().users.find((x) => x.id === t.userId);
    if (!can(u, 'download')) throw new HttpError(403, 'You do not have permission to download backups.');
    const m = getMeta(params.id), file = archiveFile(m);
    let st; try { st = fs.statSync(file); } catch { throw new HttpError(404, 'The backup file is missing.'); }
    audit('backup downloaded', { id: m.id, user: u });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="${publicMeta(m).filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    return { __handled: true };
  });
  route('POST', '/api/admin/backups/:id/delete', 'user', async ({ user, params, body, ip }) => {
    need(user, 'delete', 'delete backups');
    const m = getMeta(params.id);
    if (state && state.id === m.id) throw new HttpError(409, 'This backup is in use right now.');
    if (m.protected) throw new HttpError(409, 'This backup is protected. Remove protection first.');
    if (isUsable(m) && listMetas().filter(isUsable).length <= 1) throw new HttpError(409, 'This is the only usable backup, so it cannot be deleted.');
    await reauth(user, body.password, ip, 'delete denied', m.id);
    rmrf(archiveFile(m)); rmrf(metaFile(m.id));
    audit('backup deleted', { id: m.id, user });
    return { ok: true };
  });
  route('PUT', '/api/admin/backups/schedule', 'user', ({ user, body }) => {
    need(user, 'schedule', 'change the backup schedule');
    const frequency = body.frequency === 'weekly' ? 'weekly' : 'daily';
    const time = String(body.time || ''); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Enter the backup time as HH:MM (24-hour).');
    const weekday = Number(body.weekday); if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'Choose a day of the week.');
    const retentionDays = Number(body.retentionDays); if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new HttpError(400, 'Keep backups for 1 to 3650 days.');
    const keepMinimum = Number(body.keepMinimum); if (!Number.isInteger(keepMinimum) || keepMinimum < 1 || keepMinimum > 50) throw new HttpError(400, 'Always keep between 1 and 50 recent backups.');
    if (body.enabled && keyError) throw new HttpError(409, 'The backup encryption key is invalid, so scheduled backups cannot be enabled.');
    writeConfig({ enabled: !!body.enabled, frequency, time, weekday, retentionDays, keepMinimum });
    audit('schedule changed', { user, detail: `${body.enabled ? 'on' : 'off'}, ${frequency} ${time}, keep ${retentionDays}d / min ${keepMinimum}` });
    return summary().schedule;
  });
  route('POST', '/api/admin/backups/:id/restore', 'user', async ({ user, params, body, ip }) => {
    need(user, 'restore', 'restore backups');
    const m = getMeta(params.id);
    if (body.confirm !== 'RESTORE') throw new HttpError(400, 'Type RESTORE to confirm.');
    if (!isUsable(m)) throw new HttpError(409, 'Only a completed backup that passed validation can be restored.');
    await reauth(user, body.password, ip, 'restore denied', m.id);
    acquire('restore', m.id);
    const dir = path.join(UPLOAD_DIR, `.restore-${m.id}`);
    let v;
    try {
      state.phase = 'checking backup';
      v = await checkArchive(m, { extractTo: dir });                        // fresh integrity check, right now
      m.validation = { status: v.ok ? 'valid' : 'invalid', checkedAt: ctx.nowIso(), error: v.ok ? '' : v.error }; saveMeta(m);
      if (!v.ok) { audit('restore refused', { id: m.id, user, status: 'invalid', detail: v.error }); throw new HttpError(409, `This backup failed its integrity check and was NOT restored: ${v.error}`); }
    } catch (e) { rmrf(dir); release(); throw e; }
    audit('restore started', { id: m.id, user });
    runRestore(m, v, dir, user).catch((e) => console.error('[backup] restore crashed:', e));   // continues in the background in maintenance mode
    return { ok: true, started: true };
  });

  // ---------------------------------------------------------------- scheduler (server-side; no browser needed)
  async function tick() {
    try {
      const cfg = readConfig();
      if (state || keyError) return;
      const lp = localParts(new Date()), dateKey = `${lp.y}-${pad2(lp.m)}-${pad2(lp.d)}`;
      if (cfg.lastCleanupKey !== dateKey) { writeConfig({ lastCleanupKey: dateKey }); cleanup(null, 'schedule'); }
      if (!cfg.enabled) return;
      const [H, M] = cfg.time.split(':').map(Number);
      if (lp.h * 60 + lp.mi < H * 60 + M || cfg.lastAutoKey === dateKey) return;
      let due = cfg.frequency === 'daily' || lp.wd === cfg.weekday;
      if (!due && cfg.frequency === 'weekly' && Date.now() - (cfg.lastAutoAt ? Date.parse(cfg.lastAutoAt) : 0) > 8 * 864e5) due = true;   // missed the day (server was off)
      if (!due) return;
      writeConfig({ lastAutoKey: dateKey });                                // mark the attempt first so a failure cannot loop every minute
      acquire('backup', null);
      let m; try { m = newMeta({ type: 'auto', source: 'schedule', user: null }); } catch (e) { release(); throw e; }
      await runBackup(m);
      writeConfig({ lastAutoAt: ctx.nowIso(), lastAutoStatus: m.status });
      cleanup(null, 'schedule');
    } catch (e) { console.error('[backup] scheduler:', e.message); }
  }

  // anything left "running" by a crash is marked failed
  for (const m of listMetas()) if (m.status === 'queued' || m.status === 'in_progress') {
    m.status = 'failed'; m.error = 'Interrupted by a server restart.'; m.finishedAt = ctx.nowIso(); saveMeta(m); rmrf(path.join(BACKUP_DIR, m.id + '.part'));
  }
  for (const f of fs.readdirSync(BACKUP_DIR)) if (f.endsWith('.part')) rmrf(path.join(BACKUP_DIR, f));
  try { for (const f of fs.readdirSync(UPLOAD_DIR)) if (/^\.(restore|rollback)-/.test(f)) rmrf(path.join(UPLOAD_DIR, f)); } catch { /* no uploads yet */ }
  setInterval(tick, 60 * 1000).unref();
  setTimeout(tick, 15 * 1000).unref();
  console.log(`  Backups        ${BACKUP_DIR} (${key ? 'encrypted' : 'NOT encrypted – set BACKUP_ENCRYPTION_KEY'}, ${TZ})`);

  return { _test: { checkArchive, runBackup, newMeta, listMetas, getMeta, cleanup, nextRunAt, readConfig, writeConfig, tick, state: () => state, tokens } };
}

module.exports = { register, PERMS };