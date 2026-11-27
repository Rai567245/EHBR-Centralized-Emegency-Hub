'use strict';
/* Incident forecast for the dashboard.
   Runs in the browser from the reports the dashboard already loads (no server change needed).

   Method (kept simple on purpose, so staff can explain it):
   1. Count reports per day (rejected reports are left out).
   2. Learn a day-of-week pattern (only with 4+ weeks of data, and shrunk toward "no pattern").
   3. Fit damped-trend exponential smoothing (Holt) on the pattern-adjusted counts.
      Smoothing settings are picked by back-testing one-day-ahead errors.
   4. Project the next N days, put the pattern back, and add an 80% range from the back-test errors.
   5. Compare with a plain "recent average" so staff can see whether the model adds anything.

   Works as a browser global (Forecast) and as a Node module (for tests). */
(function (root) {
  const DAY = 864e5;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const Z80 = 1.28;                       // 80% interval
  const PHI = 0.9;                        // trend damping: a trend fades instead of running away
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  // opts.utc = true: the timestamps are "wall-clock as UTC" (the server shifts them into the barangay's time zone first),
  // so days and hours are cut with UTC maths and the result does not depend on the machine's own time zone.
  let UTC = false;
  const sod = (t) => { const d = new Date(t); if (UTC) d.setUTCHours(0, 0, 0, 0); else d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (t, n) => { const d = new Date(t); if (UTC) d.setUTCDate(d.getUTCDate() + n); else d.setDate(d.getDate() + n); return d.getTime(); };
  const gDay = (t) => (UTC ? new Date(t).getUTCDay() : new Date(t).getDay());
  const gHour = (t) => (UTC ? new Date(t).getUTCHours() : new Date(t).getHours());
  const round1 = (x) => Math.round(x * 10) / 10;
  const hourLabel = (h) => { h = ((h % 24) + 24) % 24; return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };

  function run(reports, opts) {
    const o = Object.assign({ now: Date.now(), horizon: 7, scope: 'all', maxHistory: 90, utc: false }, opts);
    UTC = !!o.utc;
    const at = (r) => new Date(r.reportedAt || r.createdAt).getTime();
    const pool = (reports || []).filter((r) => r.status !== 'REJECTED' && (o.scope === 'all' || r.kind === o.scope) && Number.isFinite(at(r)));
    const out = { ok: false, scope: o.scope, horizon: o.horizon, reportCount: pool.length, now: o.now };
    if (!pool.length) { out.reason = 'empty'; return out; }

    const today = sod(o.now);
    const first = sod(Math.min(...pool.map(at)));
    const start = Math.max(first, addDays(today, -o.maxHistory));
    const n = Math.round((today - start) / DAY);          // completed days (up to yesterday)
    out.historyDays = n;
    if (n < 7) { out.reason = 'short'; return out; }

    const dayAt = (i) => addDays(start, i);
    const wdAt = (i) => gDay(dayAt(i));
    const y = new Array(n).fill(0);
    let todaySoFar = 0;
    pool.forEach((r) => {
      const d = sod(at(r));
      if (d === today) { todaySoFar++; return; }
      const i = Math.round((d - start) / DAY);
      if (i >= 0 && i < n) y[i]++;
    });
    out.todaySoFar = todaySoFar;
    const inHistory = y.reduce((s, v) => s + v, 0);
    out.historyReports = inHistory;

    // ---- 2. day-of-week pattern (needs 4+ weeks; shrunk toward 1)
    let f = new Array(7).fill(1), usedPattern = false;
    const m = mean(y);
    if (n >= 28 && m > 0) {
      const sum = new Array(7).fill(0), cnt = new Array(7).fill(0);
      y.forEach((v, i) => { const w = wdAt(i); sum[w] += v; cnt[w]++; });
      const w = n / (n + 28);
      f = sum.map((s, k) => 1 + (s / cnt[k] / m - 1) * w);
      const fm = mean(f); f = f.map((x) => Math.max(0.2, x / fm));
      usedPattern = true;
    }
    out.usedPattern = usedPattern;
    const fac = y.map((_, i) => f[wdAt(i)]);
    const z = y.map((v, i) => v / fac[i]);

    // ---- 3. Holt damped trend; choose smoothing by one-day-ahead back-test
    const burn = Math.min(7, n - 3);
    const pass = (a, b) => {
      let L = mean(z.slice(0, Math.min(7, n))), T = 0;
      const err = [];
      for (let i = 0; i < n; i++) {
        const p = L + PHI * T;
        err.push(y[i] - Math.max(0, p) * fac[i]);
        const Ln = a * z[i] + (1 - a) * p;
        T = b * (Ln - L) + (1 - b) * PHI * T; L = Ln;
      }
      return { L, T, err };
    };
    let best = null;
    for (const a of [0.05, 0.1, 0.2, 0.3, 0.5]) for (const b of [0, 0.05, 0.1, 0.2]) {
      const p = pass(a, b);
      const sse = p.err.slice(burn).reduce((s, e) => s + e * e, 0);
      if (!best || sse < best.sse) best = { a, b, sse, ...p };
    }
    const errs = best.err.slice(burn);
    const rmse = Math.sqrt(mean(errs.map((e) => e * e)));

    // accuracy vs. "average of the previous 14 days" over the last 14 days (needs 3+ weeks)
    let accuracy = null;
    if (n >= 21) {
      const k = Math.min(14, n - burn);
      const idx = Array.from({ length: k }, (_, j) => n - k + j);
      const mae = mean(idx.map((i) => Math.abs(best.err[i])));
      const base = mean(idx.map((i) => Math.abs(y[i] - mean(y.slice(Math.max(0, i - 14), i)))));
      accuracy = { mae: round1(mae), baselineMae: round1(base), days: k, better: mae <= base };
    }
    out.accuracy = accuracy;

    // ---- 4. forecast
    const base28 = mean(y.slice(-28));
    const cap = base28 * 2.5 + 1;
    const days = [];
    let ds = 0, total = 0, varSum = 0;
    for (let k = 1; k <= o.horizon; k++) {
      ds += Math.pow(PHI, k);
      const ts = addDays(today, k - 1);
      const w = gDay(ts);
      const pred = Math.min(cap, Math.max(0, best.L + ds * best.T)) * f[w];
      const sd = Math.sqrt(Math.max(rmse * rmse, pred)) * Math.sqrt(1 + 0.1 * (k - 1));
      days.push({ ts, pred: round1(pred), lo: round1(Math.max(0, pred - Z80 * sd)), hi: round1(pred + Z80 * sd) });
      total += pred; varSum += sd * sd;
    }
    const tsd = Math.sqrt(1.25 * varSum);                 // 1.25: daily errors are not fully independent
    out.forecast = days;
    out.total = { pred: round1(total), lo: Math.max(0, Math.round(total - Z80 * tsd)), hi: Math.round(total + Z80 * tsd) };

    // ---- outlook vs. usual
    const usual = base28 * o.horizon;
    const diff = total - usual, ratio = usual > 0 ? total / usual : null;
    let risk = 'usual';
    if (n < 14 || inHistory < 8) risk = 'unknown';
    else if (diff >= 2 && (ratio === null || ratio >= 1.4)) risk = 'higher';
    else if (diff <= -2 && ratio !== null && ratio <= 0.7) risk = 'lower';
    out.outlook = { risk, usual: round1(usual), pct: ratio === null ? null : Math.round((ratio - 1) * 100) };

    // ---- confidence
    let level = 'High', why = `${n} days and ${inHistory} reports of history`;
    if (n < 14 || inHistory < 10) { level = 'Low'; why = `only ${n} days and ${inHistory} reports of history`; }
    else if (n < 42 || inHistory < 40) { level = 'Medium'; why = `${n} days and ${inHistory} reports of history; more data will sharpen it`; }
    if (accuracy && !accuracy.better && level === 'High') { level = 'Medium'; why += '; a simple average has been about as accurate'; }
    out.confidence = { level, why };

    // ---- history for the chart (last 28 completed days)
    const hn = Math.min(28, n);
    out.history = Array.from({ length: hn }, (_, j) => { const i = n - hn + j; return { ts: dayAt(i), v: y[i] }; });

    // ---- what drives it: type mix, busiest weekday, busiest hours
    const recent = pool.filter((r) => at(r) >= addDays(today, -60));
    const byType = new Map();
    recent.forEach((r) => byType.set(r.type || 'Other', (byType.get(r.type || 'Other') || 0) + 1));
    out.mix = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([type, c]) => ({ type, recent: c, share: recent.length ? c / recent.length : 0, expected: round1((recent.length ? c / recent.length : 0) * total) }));

    out.peakDay = null;
    if (n >= 28 && m > 0) {
      const sum = new Array(7).fill(0), cnt = new Array(7).fill(0);
      y.forEach((v, i) => { const w = wdAt(i); sum[w] += v; cnt[w]++; });
      const means = sum.map((s, k) => s / cnt[k]);
      const top = means.indexOf(Math.max(...means));
      // only call it out when it is clearly more than chance (Poisson z-score over the weekdays seen)
      const expected = m * cnt[top], z = (sum[top] - expected) / Math.sqrt(Math.max(expected, 1));
      if (means[top] >= 1.3 * m && z >= 2.5) out.peakDay = { day: WEEKDAYS[top], avg: round1(means[top]), overall: round1(m) };
    }
    out.peakHours = null;
    const hist90 = pool.filter((r) => at(r) >= addDays(today, -o.maxHistory));
    if (hist90.length >= 10) {
      const hc = new Array(24).fill(0); hist90.forEach((r) => { hc[gHour(at(r))]++; });
      let bs = 0, bv = -1;
      for (let s = 0; s < 24; s++) { const v = hc[s] + hc[(s + 1) % 24] + hc[(s + 2) % 24] + hc[(s + 3) % 24]; if (v > bv) { bv = v; bs = s; } }
      const share = bv / hist90.length;
      if (share >= 0.4) out.peakHours = { label: `${hourLabel(bs)} and ${hourLabel(bs + 4)}`, share };
    }
    out.params = { alpha: best.a, beta: best.b, rmse: round1(rmse), weekdayPattern: usedPattern };
    out.ok = true;
    return out;
  }

  // Plain-language reading of a result. Returns short sentences (no HTML).
  function describe(res) {
    const lines = [];
    const word = res.scope === 'incident' ? 'incident' : res.scope === 'hazard' ? 'hazard' : '';
    const noun = (c) => `${word ? word + ' ' : ''}report${c === 1 ? '' : 's'}`;
    const H = res.horizon, t = res.total;
    const approx = Math.round(t.pred);
    lines.push(`About ${approx} ${noun(approx)} expected over the next ${H} days (likely range ${t.lo} to ${t.hi}).`);
    const o = res.outlook;
    if (o.risk === 'unknown') lines.push('There is not enough history yet to say whether this is higher or lower than usual.');
    else if (o.risk === 'higher') lines.push(`That is about ${Math.abs(o.pct)}% higher than the usual ${Math.round(o.usual)} for ${H} days. Check that responder teams and evacuation centers are ready.`);
    else if (o.risk === 'lower') lines.push(o.pct <= -85 ? `That is far below the usual ${Math.round(o.usual)} for ${H} days. Recent days have been very quiet.` : `That is about ${Math.abs(o.pct)}% lower than the usual ${Math.round(o.usual)} for ${H} days.`);
    else lines.push(`That is in line with the recent average of about ${Math.round(o.usual)} for ${H} days.`);
    if (res.peakDay) lines.push(`${res.peakDay.day} is usually the busiest day (about ${res.peakDay.avg} a day, against ${res.peakDay.overall} on average).`);
    if (res.peakHours) lines.push(`${Math.round(res.peakHours.share * 100)}% of reports come in between ${res.peakHours.label}.`);
    if (res.mix.length) { const m = res.mix[0]; lines.push(`The most common type lately is ${m.type} (${Math.round(m.share * 100)}% of the last 60 days).`); }
    if (res.accuracy) {
      const a = res.accuracy;
      lines.push(a.better
        ? `Back-test: over the last ${a.days} days the forecast was off by about ${a.mae} a day, against ${a.baselineMae} for a simple average.`
        : `Back-test: a simple average (off by ${a.baselineMae} a day) did as well as this model (${a.mae}), so treat the trend with care.`);
    }
    if (res.confidence.level === 'Low') lines.push(`Confidence is low: ${res.confidence.why}. Use this as a rough guide only.`);
    return lines;
  }

  const api = { run, describe, WEEKDAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Forecast = api;
})(typeof window !== 'undefined' ? window : globalThis);
