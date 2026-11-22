'use strict';
/** Time-zone helpers shared by the Reports Generator and its exporters. Everything is evaluated in one configured zone. */
const fmts = new Map();
const pad = (n, l = 2) => String(n).padStart(l, '0');

function formatter(tz) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmts.set(tz, f);
  }
  return f;
}
const validTz = (tz) => { try { formatter(tz); return true; } catch { return false; } };

/** Wall-clock parts of an instant in `tz`. wd: 0 = Sunday. */
function localParts(ms, tz) {
  const p = {};
  for (const x of formatter(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  const y = +p.year, m = +p.month, d = +p.day;
  return { y, m, d, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
/** The instant at which the wall clock in `tz` reads y-m-d h:mi. Overflowing months/days are normalised (m=13 -> January next year). */
function zonedToUtc(y, m, d, h, mi, tz) {
  const wall = Date.UTC(y, m - 1, d, h, mi);              // the wall-clock reading, treated as if it were UTC
  let t = wall;
  for (let i = 0; i < 3; i++) {                           // converge on the instant whose local reading equals `wall` (handles DST zones too)
    const lp = localParts(t, tz);
    const diff = Date.UTC(lp.y, lp.m - 1, lp.d, lp.h, lp.mi, lp.s) - t;
    const next = wall - diff;
    if (next === t) break;
    t = next;
  }
  return t;
}
const localMidnight = (y, m, d, tz) => zonedToUtc(y, m, d, 0, 0, tz);
const fmtDate = (ms, tz) => { const p = localParts(ms, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
const fmtDateTime = (ms, tz) => { const p = localParts(ms, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`; };
/** Excel date serial for the wall-clock time of an instant in `tz` (so the cell shows exactly what the PDF shows). */
function excelSerial(ms, tz) { const p = localParts(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) / 86400000 + 25569; }
/** "UTC+08:00" for display. */
function offsetLabel(ms, tz) {
  const p = localParts(ms, tz), diff = Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000);
  const sign = diff < 0 ? '-' : '+', a = Math.abs(diff);
  return `UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

module.exports = { localParts, zonedToUtc, localMidnight, fmtDate, fmtDateTime, excelSerial, offsetLabel, validTz, pad, MONTHS, MON, DOW };