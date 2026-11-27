'use strict';
/* Plain-language reading of the whole site: reports, road blockages, evacuation centers and announcements.
   Works in the browser (global `Interpret`) and in Node (module.exports), so it can be tested without a page.

   Interpret.run({ reports, blockages, centers, announcements, now })
     -> { lead, groups: [{ id, title, href, headline, status, statusLabel, items: [{ level, text }] }] }

   Each item has a level: 'act' (needs action), 'watch' (keep an eye on it), 'info' (just context), 'ok' (all good).
   The text only says what the numbers show. It never guesses causes. A group is 'na' when its data could not be loaded.
   Pass null for a list that could not be loaded. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Interpret = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 864e5, OPEN = ['NEW', 'VERIFIED', 'DISPATCHED'];
  const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + 's')}`;
  const isAre = (n) => (n === 1 ? 'is' : 'are');
  const andList = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
  const time = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : NaN; };
  const tally = (arr, fn) => {
    const m = new Map();
    arr.forEach((x) => { const k = fn(x); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  };
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const daysAgo = (ms, now) => Math.max(0, Math.floor((now - ms) / DAY));
  const agoText = (d) => (d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);

  // ------------------------------------------------------------------ reports
  function reports(rs, now) {
    const items = [], d0 = startOfDay(now - 6 * DAY), at = (r) => time(r.createdAt);
    const wk = rs.filter((r) => at(r) >= d0), prev = rs.filter((r) => at(r) >= d0 - 7 * DAY && at(r) < d0), diff = wk.length - prev.length;
    if (!wk.length && !prev.length) items.push({ level: 'info', text: 'No reports in the last 14 days.' });
    else {
      const cmp = diff === 0 ? 'the same as the previous 7 days' : `${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than the previous 7 days`;
      items.push({ level: wk.length >= 5 && diff >= 3 && wk.length >= prev.length * 1.5 ? 'watch' : 'info', text: `${plural(wk.length, 'report')} in the last 7 days, ${cmp}.` });
    }
    if (wk.length >= 5) {
      const t = tally(wk, (r) => r.type);
      if (t.length) {
        const top = t.filter((x) => x[1] === t[0][1]);
        items.push({ level: 'info', text: top.length > 1 ? `${andList(top.map((x) => x[0]))} are tied as the most common type this week (${t[0][1]} each).` : `${t[0][0]} is the most common type this week (${t[0][1]} of ${wk.length}, ${pct(t[0][1], wk.length)}%).` });
      }
    }
    if (wk.length >= 8) {
      const z = tally(wk, (r) => r.reporterZone).filter((x) => x[1] >= 3)[0];
      if (z && z[1] / wk.length >= 0.4) items.push({ level: 'info', text: `${z[0]} sent ${pct(z[1], wk.length)}% of this week's reports (${z[1]} of ${wk.length}).` });
    }
    const open = rs.filter((r) => OPEN.includes(r.status)), high = open.filter((r) => r.urgency === 'High' || r.urgency === 'Critical').length;
    const waiting = rs.filter((r) => r.status === 'NEW' && now - at(r) > DAY).length;
    if (!open.length) items.push({ level: 'ok', text: 'No open reports. Everything filed has been handled.' });
    else {
      items.push({ level: high ? 'act' : 'info', text: `${plural(open.length, 'report')} still open${high ? `, ${high} of high or critical urgency` : ''}.` });
      if (waiting) items.push({ level: 'act', text: `${plural(waiting, 'new report')} ${isAre(waiting)} still waiting for verification after more than 24 hours.` });
    }
    if (wk.length >= 5) {
      const res = wk.filter((r) => r.status === 'RESOLVED').length;
      items.push({ level: 'info', text: `${res} of this week's ${wk.length} reports ${res === 1 ? 'is' : 'are'} resolved (${pct(res, wk.length)}%).` });
    }
    return { id: 'reports', title: 'Reports', href: 'reports.html', headline: `${wk.length} this week`, items };
  }

  // ------------------------------------------------------------------ road blockages
  function blockages(list, now) {
    if (!list) return { id: 'blockages', title: 'Road blockages', href: 'blockages.html', na: true, items: [] };
    const items = [], expired = (b) => (b.expired !== undefined ? !!b.expired : !!b.until && now > time(b.until));
    const active = list.filter((b) => !expired(b)), stale = list.filter(expired);
    if (!active.length) items.push({ level: 'ok', text: 'No roads are blocked right now.' });
    else {
      const why = tally(active, (b) => String(b.reason || 'other').toLowerCase()).map(([r, n]) => `${n} ${r}`);
      items.push({ level: active.length >= 3 ? 'act' : 'watch', text: active.length === 1 ? `1 road is blocked right now (${String(active[0].reason || 'other').toLowerCase()}).` : `${active.length} roads are blocked right now: ${andList(why)}.` });
      const noEnd = active.filter((b) => !b.until).length;
      if (noEnd) items.push({ level: 'info', text: `${noEnd} ${noEnd === 1 ? 'has' : 'have'} no expected end time, so ${noEnd === 1 ? 'it stays' : 'they stay'} on the map until someone removes ${noEnd === 1 ? 'it' : 'them'}.` });
      const oldest = active.map((b) => ({ b, t: time(b.createdAt) })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t)[0];
      if (oldest && daysAgo(oldest.t, now) >= 2) items.push({ level: daysAgo(oldest.t, now) >= 3 ? 'watch' : 'info', text: `The longest-running one, "${oldest.b.title}", has been blocked for ${daysAgo(oldest.t, now)} days.` });
    }
    if (stale.length) items.push({ level: 'watch', text: `${plural(stale.length, 'blockage')} ${isAre(stale.length)} past ${stale.length === 1 ? 'its' : 'their'} end time but still on the list. Remove ${stale.length === 1 ? 'it' : 'them'} if the road is clear.` });
    const fresh = list.filter((b) => now - time(b.createdAt) < DAY).length;
    if (fresh) items.push({ level: 'info', text: `${plural(fresh, 'blockage')} added in the last 24 hours.` });
    return { id: 'blockages', title: 'Road blockages', href: 'blockages.html', headline: `${active.length} active`, items, _active: active.length };
  }

  // ------------------------------------------------------------------ evacuation centers
  function centers(list) {
    if (!list) return { id: 'centers', title: 'Evacuation centers', href: 'database.html#centers', na: true, items: [] };
    const items = [], open = list.filter((c) => c.status === 'open'), standby = list.filter((c) => c.status === 'standby');
    if (!list.length) items.push({ level: 'watch', text: 'No evacuation centers have been set up yet.' });
    else {
      items.push({ level: open.length ? 'info' : 'watch', text: `${open.length} of ${plural(list.length, 'center')} ${open.length === 1 ? 'is' : 'are'} open${standby.length ? `, ${standby.length} on standby` : ''}.` });
      const cap = open.reduce((n, c) => n + (c.capacity || 0), 0), occ = open.reduce((n, c) => n + (c.occupied || 0), 0);
      if (open.length && cap > 0) items.push({ level: pct(occ, cap) >= 85 ? 'act' : 'info', text: `${occ.toLocaleString()} of ${cap.toLocaleString()} spaces are in use across the open centers (${pct(occ, cap)}%), ${Math.max(0, cap - occ).toLocaleString()} left.` });
      open.filter((c) => c.capacity > 0 && c.occupied / c.capacity >= 0.85).slice(0, 3)
        .forEach((c) => items.push({ level: 'act', text: `${c.name} is ${pct(c.occupied, c.capacity)}% full, ${Math.max(0, c.capacity - c.occupied)} ${c.capacity - c.occupied === 1 ? 'space' : 'spaces'} left.` }));
      open.filter((c) => !(c.capacity > 0)).forEach((c) => items.push({ level: 'watch', text: `${c.name} is open but has no capacity set.` }));
      const nomap = list.filter((c) => c.lat == null || c.lng == null).length;
      if (nomap) items.push({ level: 'watch', text: `${plural(nomap, 'center')} ${nomap === 1 ? 'has' : 'have'} no map location, so residents cannot find ${nomap === 1 ? 'it' : 'them'} on the map.` });
    }
    return { id: 'centers', title: 'Evacuation centers', href: 'database.html#centers', headline: `${open.length} open`, items };
  }

  // ------------------------------------------------------------------ announcements
  function announcements(list, now, ctx) {
    if (!list) return { id: 'announcements', title: 'Announcements', href: 'announcements.html', na: true, items: [] };
    const items = [], wk = list.filter((a) => now - time(a.createdAt) < 7 * DAY), latest = list.map((a) => time(a.createdAt)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (!list.length) items.push({ level: 'watch', text: 'No announcements have been published yet.' });
    else {
      const mix = tally(wk, (a) => a.category).map(([c, n]) => `${n} ${c}`);
      items.push({ level: 'info', text: `${plural(list.length, 'announcement')} published in total, ${wk.length} in the last 7 days${mix.length ? ` (${andList(mix)})` : ''}.` });
      if (latest !== undefined) items.push({ level: 'info', text: `The latest one was posted ${agoText(daysAgo(latest, now))}.` });
      const why = [];
      if (ctx.activeBlockages) why.push(plural(ctx.activeBlockages, 'active road blockage'));
      if (ctx.highOpen) why.push(`${ctx.highOpen} open ${ctx.highOpen === 1 ? 'report' : 'reports'} of high or critical urgency`);
      if (!wk.length && why.length) items.push({ level: 'watch', text: `There ${why.length === 1 && (ctx.activeBlockages === 1 || (!ctx.activeBlockages && ctx.highOpen === 1)) ? 'is' : 'are'} ${andList(why)}, but nothing was announced in the last 7 days. Residents may not know.` });
      const top = tally(list, (a) => a.category);
      if (list.length >= 4 && top.length) items.push({ level: 'info', text: `Most are ${top[0][0]} announcements (${top[0][1]} of ${list.length}).` });
    }
    return { id: 'announcements', title: 'Announcements', href: 'announcements.html', headline: `${wk.length} this week`, items };
  }

  const RANK = { ok: 0, info: 0, watch: 1, act: 2 };
  const STATUS = [['ok', 'All clear'], ['watch', 'Keep an eye'], ['act', 'Needs action']];

  function run({ reports: rs, blockages: bl, centers: ce, announcements: an, now = Date.now() } = {}) {
    rs = Array.isArray(rs) ? rs : [];
    const rep = reports(rs, now), blk = blockages(Array.isArray(bl) ? bl : null, now), cen = centers(Array.isArray(ce) ? ce : null);
    const highOpen = rs.filter((r) => OPEN.includes(r.status) && (r.urgency === 'High' || r.urgency === 'Critical')).length;
    const ann = announcements(Array.isArray(an) ? an : null, now, { activeBlockages: blk._active || 0, highOpen });
    const groups = [rep, blk, cen, ann].map((g) => {
      if (g.na) return { ...g, status: 'na', statusLabel: 'Not available', headline: '' };
      const r = Math.max(0, ...g.items.map((i) => RANK[i.level]));
      return { ...g, status: STATUS[r][0], statusLabel: STATUS[r][1] };
    });
    const act = groups.filter((g) => g.status === 'act').map((g) => g.title), watch = groups.filter((g) => g.status === 'watch').map((g) => g.title), na = groups.filter((g) => g.status === 'na').map((g) => g.title);
    const lead = (act.length ? `Needs action: ${andList(act)}.${watch.length ? ` Worth keeping an eye on: ${andList(watch)}.` : ''}`
      : watch.length ? `Nothing urgent. Worth keeping an eye on: ${andList(watch)}.` : 'Everything looks calm right now.')
      + (na.length ? ` Could not load: ${andList(na)}.` : '');
    return { lead, groups };
  }

  return { run, STATUS };
});
