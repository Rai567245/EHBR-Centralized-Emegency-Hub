'use strict';
/**
 * PostgreSQL storage for the Emergency Hub server.
 *
 * The server keeps its working copy in memory (fast, simple) and calls save() after every change.
 * save() writes only the rows that actually changed, in one transaction, a moment later.
 * Each collection is a real table (id + a JSONB document), so you can browse and query it in pgAdmin.
 *
 * Used only when DATABASE_URL is set; otherwise the server keeps using data.json.
 */
const { Pool } = require('pg');

// array collections that have an `id`; activity has none (its position is the id)
const LISTS = ['users', 'reports', 'announcements', 'centers', 'blockages', 'notifications', 'resets'];
const TABLES = [...LISTS, 'activity', 'sessions', 'meta'];

function createStore(url, { ssl = process.env.DATABASE_SSL } = {}) {
  const pool = new Pool({
    connectionString: url,
    max: 5,
    ssl: ssl && ssl !== 'off' && ssl !== '0' ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  const last = Object.fromEntries(TABLES.map((t) => [t, new Map()])); // table -> key -> last written JSON text
  let timer = null, running = null, again = false, getDb = null;

  async function init() {
    for (const t of LISTS) {
      await pool.query(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, doc JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    }
    await pool.query('CREATE TABLE IF NOT EXISTS activity (pos INTEGER PRIMARY KEY, doc JSONB NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, doc JSONB NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, doc JSONB NOT NULL)');
    await pool.query('CREATE INDEX IF NOT EXISTS reports_user_idx ON reports ((doc->>\'userId\'))');
    await pool.query('CREATE INDEX IF NOT EXISTS users_contact_idx ON users ((doc->>\'contact\'))');
  }

  /** True when the database already holds data (so we must not overwrite it with an old data.json). */
  async function hasData() {
    const r = await pool.query("SELECT 1 FROM meta WHERE key = 'settings'");
    return r.rowCount > 0;
  }

  /** Reads everything into `base` (an emptyDb()). */
  async function loadInto(base) {
    for (const t of LISTS) {
      const r = await pool.query(`SELECT id, doc FROM ${t} ORDER BY updated_at, id`);
      base[t] = r.rows.map((x) => x.doc);
      last[t] = new Map(r.rows.map((x) => [x.id, JSON.stringify(x.doc)]));
    }
    const a = await pool.query('SELECT pos, doc FROM activity ORDER BY pos');
    base.activity = a.rows.map((x) => x.doc);
    last.activity = new Map(a.rows.map((x) => [String(x.pos), JSON.stringify(x.doc)]));
    const s = await pool.query('SELECT token, doc FROM sessions');
    base.sessions = Object.fromEntries(s.rows.map((x) => [x.token, x.doc]));
    last.sessions = new Map(s.rows.map((x) => [x.token, JSON.stringify(x.doc)]));
    const m = await pool.query('SELECT key, doc FROM meta');
    last.meta = new Map(m.rows.map((x) => [x.key, JSON.stringify(x.doc)]));
    for (const x of m.rows) {
      if (x.key === 'settings') base.settings = { ...base.settings, ...x.doc };
      if (x.key === 'counters') base.counters = { ...base.counters, ...x.doc };
    }
    return base;
  }

  // Desired rows for the current in-memory copy.
  function snapshot(db) {
    const out = {};
    for (const t of LISTS) out[t] = new Map(db[t].map((d) => [String(d.id), d]));
    out.activity = new Map(db.activity.map((d, i) => [String(i), d]));
    out.sessions = new Map(Object.entries(db.sessions));
    out.meta = new Map([['settings', db.settings], ['counters', db.counters]]);
    return out;
  }

  async function flushNow() {
    const db = getDb();
    const want = snapshot(db);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const done = [];
      for (const t of TABLES) {
        const keyCol = t === 'activity' ? 'pos' : t === 'sessions' ? 'token' : t === 'meta' ? 'key' : 'id';
        const wantRows = want[t], have = last[t];
        const next = new Map();
        for (const [k, doc] of wantRows) {
          const text = JSON.stringify(doc);
          next.set(k, text);
          if (have.get(k) === text) continue;
          const key = t === 'activity' ? Number(k) : k;
          const stamp = LISTS.includes(t) ? ', updated_at = now()' : '';
          await client.query(`INSERT INTO ${t} (${keyCol}, doc) VALUES ($1, $2) ON CONFLICT (${keyCol}) DO UPDATE SET doc = EXCLUDED.doc${stamp}`, [key, text]);
        }
        const gone = [...have.keys()].filter((k) => !wantRows.has(k));
        if (gone.length) await client.query(`DELETE FROM ${t} WHERE ${keyCol} = ANY($1)`, [t === 'activity' ? gone.map(Number) : gone]);
        done.push([t, next]);
      }
      await client.query('COMMIT');
      for (const [t, next] of done) last[t] = next; // only trust the cache once the commit succeeded
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // Phase 1 (SEC-06): Force synchronous durability. save() now returns a Promise
  // that resolves only after PostgreSQL COMMIT succeeds.
  async function schedule() {
    if (running) await running;
    try {
      running = flushNow();
      await running;
    } catch (e) {
      console.error('[db] SAVE FAILED:', e.message);
      throw e; // Throw so the API route can catch it and return a 503
    } finally {
      running = null;
    }
  }

  // ---- Backup & Restore support -------------------------------------------------------------
  // Tables that are backed up. sessions (login tokens) and resets (one-time codes) are deliberately
  // left out: they are short-lived secrets and must never be resurrected from an old file.
  const BACKUP_TABLES = [...LISTS.filter((t) => t !== 'resets'), 'activity', 'meta'];
  const keyColOf = (t) => (t === 'activity' ? 'pos' : t === 'meta' ? 'key' : 'id');

  /** Consistent point-in-time copy of every backed-up table (one REPEATABLE READ transaction). */
  async function dumpAll() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const out = {};
      for (const t of BACKUP_TABLES) {
        const k = keyColOf(t);
        const stamp = LISTS.includes(t) ? ', updated_at' : '';
        const r = await client.query(`SELECT ${k} AS key, doc${stamp} FROM ${t} ORDER BY ${t === 'activity' ? 'pos' : LISTS.includes(t) ? 'updated_at, id' : 'key'}`);
        out[t] = r.rows.map((x) => ({ key: String(x.key), doc: x.doc, at: x.updated_at ? new Date(x.updated_at).toISOString() : null }));
      }
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }

  /** Replaces every backed-up table with `tables` in ONE transaction: all-or-nothing. sessions/resets are untouched. */
  async function restoreAll(tables) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of BACKUP_TABLES) {
        const k = keyColOf(t), rows = tables[t] || [];
        await client.query(`DELETE FROM ${t}`);
        const base = Date.now();
        for (let i = 0; i < rows.length; i += 300) {
          const chunk = rows.slice(i, i + 300), args = [], vals = [];
          chunk.forEach((row, j) => {
            const n = i + j, key = t === 'activity' ? Number(row.key) : row.key;
            args.push(key, JSON.stringify(row.doc));
            if (LISTS.includes(t)) { args.push(row.at || new Date(base + n).toISOString()); vals.push(`($${args.length - 2}, $${args.length - 1}, $${args.length})`); }
            else vals.push(`($${args.length - 1}, $${args.length})`);
          });
          await client.query(`INSERT INTO ${t} (${k}, doc${LISTS.includes(t) ? ', updated_at' : ''}) VALUES ${vals.join(',')}`, args);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }

  /** Row counts straight from the database (used to verify a restore). */
  async function countAll() {
    const out = {};
    for (const t of BACKUP_TABLES) out[t] = Number((await pool.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
    return out;
  }

  return {
    init, hasData, loadInto, dumpAll, restoreAll, countAll, BACKUP_TABLES,
    /** Call after every change. */
    save: schedule,
    /** Must be called once, before the first save(). */
    bind(fn) { getDb = fn; },
    /** Writes everything right now (used by the importer and on shutdown). */
    async flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      while (running) await running;
      await flushNow();
    },
    async close() { await pool.end(); },
  };
}

module.exports = { createStore };
