'use strict';
/* Shared helpers for every admin page. */
const EH = (() => {
  const TOKEN = 'ehbr_admin_token', USER = 'ehbr_admin_user';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function logout() {
    const t = localStorage.getItem(TOKEN);
    if (t) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }).catch(() => {});
    localStorage.removeItem(TOKEN); localStorage.removeItem(USER);
    location.href = 'login.html';
  }

  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const t = localStorage.getItem(TOKEN);
    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(auth && t ? { Authorization: 'Bearer ' + t } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new Error('Cannot reach the server. Is it running?'); }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && auth) { logout(); throw new Error('Session expired'); }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 14) return Math.floor(s / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function toast(msg, type = '') {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' toast--' + type : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }
  const fail = (e) => toast(e && e.message ? e.message : String(e), 'error');

  // ---- modal (form + confirm)
  function fieldHtml(f) {
    const label = `<span>${esc(f.label)}${f.required ? ' <em>*</em>' : ''}</span>`;
    const cls = 'fld' + (f.full ? ' full' : '');
    const v = f.value ?? '';
    if (f.type === 'select') {
      return `<label class="${cls}">${label}<select name="${esc(f.name)}"${f.required ? ' required' : ''}>${(f.options || []).map((o) => {
        const val = typeof o === 'string' ? o : o.value, lab = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`;
      }).join('')}</select></label>`;
    }
    if (f.type === 'checkbox') return `<label class="fld full chk"><input type="checkbox" name="${esc(f.name)}"${f.value ? ' checked' : ''}><span>${esc(f.label)}</span></label>`;
    if (f.type === 'textarea') return `<label class="${cls}">${label}<textarea name="${esc(f.name)}" maxlength="${f.max || 2000}"${f.required ? ' required' : ''} placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea></label>`;
    return `<label class="${cls}">${label}<input class="input" name="${esc(f.name)}" type="${f.type || 'text'}" value="${esc(v)}"${f.step ? ` step="${f.step}"` : ''}${f.min !== undefined ? ` min="${f.min}"` : ''}${f.required ? ' required' : ''} maxlength="${f.max || 200}" placeholder="${esc(f.placeholder || '')}" autocomplete="off"></label>`;
  }
  // ---- Incident Map chip row: finds the real chip container, makes it a swipe/drag/wheel scroller
  function setupChipStrip() {
    const bar = $('.im__bar, .rp__bar'); if (!bar) return;
    let wired = null;
    const wire = (strip) => {
      if (wired === strip) return; wired = strip;
      let down = null, moved = false;
      strip.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;      // touch scrolls natively
        down = { x: e.clientX, left: strip.scrollLeft }; moved = false;
      });
      addEventListener('pointermove', (e) => {
        if (!down) return;
        const dx = e.clientX - down.x;
        if (!moved && Math.abs(dx) > 5) { moved = true; strip.classList.add('is-dragging'); }
        if (moved) strip.scrollLeft = down.left - dx;
      });
      const end = () => { if (!down) return; down = null; strip.classList.remove('is-dragging'); };
      addEventListener('pointerup', end); addEventListener('pointercancel', end);
      strip.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
      strip.addEventListener('wheel', (e) => {                        // mouse wheel scrolls the chips sideways when they overflow
        if (strip.scrollWidth <= strip.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        const max = strip.scrollWidth - strip.clientWidth;
        if ((e.deltaY < 0 && strip.scrollLeft <= 0) || (e.deltaY > 0 && strip.scrollLeft >= max - 1)) return;
        e.preventDefault(); strip.scrollLeft += e.deltaY;
      }, { passive: false });
    };
    const apply = () => {
      // tag empty layout spacers in the bar so phones can hide them (they push the filters off to the right)
      [...bar.children].forEach((c) => {
        if (!c.classList.contains('is-spacer') && !c.children.length && !c.textContent.trim() && !/^(INPUT|SELECT|HR|IMG)$/.test(c.tagName)) c.classList.add('is-spacer');
      });
      const first = $('.chip', bar); if (!first) return;
      let strip = first.parentElement;
      if (strip === bar) {                                            // chips sit directly in the bar: group them
        strip = document.createElement('div'); first.before(strip);
        [...bar.querySelectorAll(':scope > .chip')].forEach((c) => strip.appendChild(c));
      }
      if (!strip.classList.contains('chip-strip')) strip.classList.add('chip-strip');
      wire(strip);
    };
    apply();
    new MutationObserver(apply).observe(bar, { childList: true, subtree: true });
  }
  // ---- Reports table: copies each column header onto its cells (data-label) so rows can render as cards on phones
  function setupResponsiveTables() {
    const host = $('.rp, .db'); if (!host) return;
    const label = () => host.querySelectorAll('table.tbl').forEach((tbl) => {
      const heads = [...tbl.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      tbl.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (heads[i] && td.dataset.label !== heads[i]) td.dataset.label = heads[i]; }));
    });
    label();
    new MutationObserver(label).observe(host, { childList: true, subtree: true });
  }
  // ---- Announcements feed: category filter chips, 3-line messages with "Read more", and "Show 5 more".
  // Works on the rendered cards (.an__item), wherever they are, and re-applies itself whenever the page redraws the list.
  function setupAnnouncementsFeed() {
    if (!$('.an, .an__list, .an__form')) return;
    const root = $('.content') || document.body;
    const STEP = 5, CATS = [['all', 'All'], ['alert', 'Alert'], ['advisory', 'Advisory'], ['event', 'Event']];
    let filter = 'all', shown = STEP, lastCount = 0, raf = 0;
    const obs = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); });
    const catOf = (el) => { const t = el.querySelector('.an__head > :first-child'); return t ? t.textContent.trim().toLowerCase() : ''; };
    const measure = (el) => {                                    // clamp the message to 3 lines and add "Read more" when it overflows
      const p = el.querySelector(':scope > p'); if (!p || el.hidden || !p.offsetParent) return;
      let btn = el.querySelector(':scope > .an__more');
      if (!btn) {
        p.classList.add('an__clamp');
        btn = document.createElement('button'); btn.type = 'button'; btn.className = 'an__more'; btn.setAttribute('aria-expanded', 'false'); btn.hidden = true;
        btn.addEventListener('click', () => { const open = btn.getAttribute('aria-expanded') !== 'true'; btn.setAttribute('aria-expanded', String(open)); p.classList.toggle('is-open', open); });
        p.after(btn);
      }
      if (btn.getAttribute('aria-expanded') !== 'true') btn.hidden = !(p.scrollHeight > p.clientHeight + 1);
    };
    function render() {
      obs.disconnect();
      root.querySelectorAll('.an__filters, .an__foot, .an__empty').forEach((n) => n.remove());
      const all = [...root.querySelectorAll('.an__item')];
      if (all.length > lastCount && lastCount > 0) { filter = 'all'; shown = STEP; }       // a new announcement: show it at the top
      lastCount = all.length;
      const cats = all.map(catOf), count = (k) => (k === 'all' ? all.length : cats.filter((c) => c === k).length);
      if (filter !== 'all' && !count(filter)) filter = 'all';
      const match = all.filter((el, i) => filter === 'all' || cats[i] === filter);
      all.forEach((el) => { el.hidden = true; });
      match.slice(0, shown).forEach((el) => { el.hidden = false; });
      const host = all.length ? all[0].parentElement : ($('#anList') || $('.an__list'));
      if (host) {
        if (all.length > STEP || filter !== 'all') {
          const bar = document.createElement('div'); bar.className = 'an__filters'; bar.setAttribute('role', 'tablist');
          bar.innerHTML = CATS.map(([k, label]) => `<button type="button" class="chip${k === filter ? ' is-on' : ''}" data-cat="${k}" role="tab" aria-selected="${k === filter}">${label} ${count(k)}</button>`).join('');
          bar.addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; filter = b.dataset.cat; shown = STEP; render(); });
          host.prepend(bar);
        }
        if (all.length && !match.length) { const n = document.createElement('p'); n.className = 'an__empty'; n.textContent = 'No announcements in this category.'; host.appendChild(n); }
        if (match.length > STEP) {
          const left = match.length - shown, foot = document.createElement('div'); foot.className = 'an__foot';
          foot.innerHTML = left > 0
            ? `<button type="button" class="btn btn--fit" data-more>Show ${Math.min(STEP, left)} more<small>${left} left</small></button>`
            : '<button type="button" class="btn btn--fit" data-less>Show less</button>';
          foot.addEventListener('click', (e) => {
            if (e.target.closest('[data-more]')) { shown += STEP; render(); }
            else if (e.target.closest('[data-less]')) { shown = STEP; render(); host.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          });
          host.appendChild(foot);
        }
      }
      all.forEach(measure);
      obs.observe(root, { childList: true, subtree: true });
    }
    let rz = 0; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => root.querySelectorAll('.an__item').forEach(measure), 150); });
    render();
  }
  // ---- custom date / date-time picker: replaces <input type="date|datetime-local"> (the real input stays hidden as the source of truth).
  // Desktop: popover under the field. Phones: bottom sheet. The native browser picker can't be styled and spills off small screens.
  function enhanceDates(root, selector) {
    const dV = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const pad = (n) => String(n).padStart(2, '0');
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const ico = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
    const PATH = { l: '<path d="M15 18l-6-6 6-6"/>', r: '<path d="M9 18l6-6-6-6"/>', up: '<path d="M18 15l-6-6-6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
      cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>' };
    const parse = (v) => {
      if (!v) return null;
      const [d, t = ''] = String(v).split('T'), [Y, M, D] = d.split('-').map(Number);
      if (!Y || !M || !D) return null;
      const [h = 0, m = 0] = t.split(':').map(Number);
      return { Y, M: M - 1, D, h, m };
    };
    const key = (o) => (o ? o.Y * 10000 + o.M * 100 + o.D : null);
    root.querySelectorAll(selector).forEach((inp) => {
      if (inp.dataset.dp) return;
      inp.dataset.dp = '1';
      const withTime = inp.type === 'datetime-local';
      const wrap = document.createElement('div'); wrap.className = 'cs dp is-empty';
      wrap.innerHTML = `<button type="button" class="cs__btn" aria-haspopup="dialog" aria-expanded="false"><span class="cs__val"></span><span class="cs__chev">${ico(PATH.cal)}</span></button>`;
      inp.classList.add('cs-native'); inp.tabIndex = -1; inp.setAttribute('aria-hidden', 'true');
      inp.after(wrap);
      const btn = $('.cs__btn', wrap), val = $('.cs__val', wrap);
      const minK = key(parse(inp.min)), maxK = key(parse(inp.max));
      let cur = null, view = { Y: 0, M: 0 }, time = { h12: 6, m: 0, pm: false }, pop = null, scrim = null;
      const sheet = () => matchMedia('(max-width: 560px)').matches;
      const h24 = () => (time.h12 % 12) + (time.pm ? 12 : 0);
      const setTime = (h, m) => { time = { h12: h % 12 || 12, m, pm: h >= 12 }; };
      const paint = () => {
        cur = parse(dV.get.call(inp));
        wrap.classList.toggle('is-empty', !cur);
        if (!cur) { val.textContent = withTime ? 'Select date & time' : 'Select date'; return; }
        const d = new Date(cur.Y, cur.M, cur.D, cur.h, cur.m);
        val.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + (withTime ? ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
      };
      const emit = () => { inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); };
      const commit = () => {
        const d = `${cur.Y}-${pad(cur.M + 1)}-${pad(cur.D)}`;
        dV.set.call(inp, withTime ? `${d}T${pad(cur.h)}:${pad(cur.m)}` : d);
        paint(); emit();
      };
      const draw = () => {
        const start = new Date(view.Y, view.M, 1).getDay(), now = new Date(), cells = [];
        for (let i = 0; i < 42; i++) {
          const dt = new Date(view.Y, view.M, 1 - start + i), Y = dt.getFullYear(), M = dt.getMonth(), D = dt.getDate(), k = Y * 10000 + M * 100 + D;
          const on = cur && cur.Y === Y && cur.M === M && cur.D === D, dis = (minK && k < minK) || (maxK && k > maxK);
          cells.push(`<button type="button" class="dp__day${M !== view.M ? ' is-other' : ''}${on ? ' is-sel' : ''}${now.getFullYear() === Y && now.getMonth() === M && now.getDate() === D ? ' is-today' : ''}" data-d="${Y}-${M}-${D}" aria-pressed="${!!on}" ${dis ? 'disabled' : ''}>${D}</button>`);
        }
        const spin = (k, v) => `<div class="dp__spin"><button type="button" data-t="${k}+" aria-label="Increase">${ico(PATH.up)}</button><b>${v}</b><button type="button" data-t="${k}-" aria-label="Decrease">${ico(PATH.down)}</button></div>`;
        pop.innerHTML = `<div class="dp__head"><button type="button" class="dp__nav" data-nav="-1" aria-label="Previous month">${ico(PATH.l)}</button>
          <b class="dp__title">${MONTHS[view.M]} ${view.Y}</b><button type="button" class="dp__nav" data-nav="1" aria-label="Next month">${ico(PATH.r)}</button></div>
          <div class="dp__dow">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => `<span>${d}</span>`).join('')}</div>
          <div class="dp__grid">${cells.join('')}</div>
          ${withTime ? `<div class="dp__time"><span class="dp__label">Time</span>${spin('h', pad(time.h12))}<i>:</i>${spin('m', pad(time.m))}
            <div class="dp__ampm"><button type="button" data-ap="am" class="${time.pm ? '' : 'is-on'}">AM</button><button type="button" data-ap="pm" class="${time.pm ? 'is-on' : ''}">PM</button></div></div>` : ''}
          <div class="dp__foot"><button type="button" class="dp__link" data-clear>Clear</button><button type="button" class="dp__link" data-now>${withTime ? 'Now' : 'Today'}</button><button type="button" class="btn btn--primary btn--sm btn--fit" data-done>Done</button></div>`;
      };
      const place = () => {
        if (sheet()) return;
        const r = btn.getBoundingClientRect(), w = Math.min(320, innerWidth - 16), h = pop.offsetHeight;
        pop.style.width = w + 'px'; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
        const below = innerHeight - r.bottom - 12, above = r.top - 12, up = below < h && above > below;
        pop.style.top = Math.max(8, up ? r.top - h - 6 : r.bottom + 6) + 'px';
      };
      const onDoc = (e) => { if (!wrap.isConnected || !(wrap.contains(e.target) || (pop && pop.contains(e.target)))) close(); };
      const onScroll = (e) => { if (!sheet() && pop && !pop.contains(e.target)) close(); };
      const onResize = () => { if (!sheet()) close(); };
      function open() {
        if (pop || inp.disabled) return;
        paint();
        const now = new Date();
        if (cur) { view = { Y: cur.Y, M: cur.M }; setTime(cur.h, cur.m); }
        else { view = { Y: now.getFullYear(), M: now.getMonth() }; const t = new Date(Math.ceil(now.getTime() / 300000) * 300000); setTime(t.getHours(), t.getMinutes()); }
        pop = document.createElement('div'); pop.className = 'dp__pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Choose date'); pop.tabIndex = -1;
        if (sheet()) { scrim = document.createElement('div'); scrim.className = 'dp__scrim'; document.body.appendChild(scrim); }
        document.body.appendChild(pop); draw(); place(); pop.focus({ preventScroll: true });
        wrap.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
        pop.addEventListener('click', onPop); pop.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDoc, true); document.addEventListener('scroll', onScroll, true); addEventListener('resize', onResize);
      }
      function close() {
        if (!pop) return;
        pop.remove(); if (scrim) scrim.remove(); pop = scrim = null;
        wrap.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('scroll', onScroll, true); removeEventListener('resize', onResize);
      }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } }
      function onPop(e) {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.dataset.nav) { const d = new Date(view.Y, view.M + Number(b.dataset.nav), 1); view = { Y: d.getFullYear(), M: d.getMonth() }; draw(); return; }
        if (b.dataset.d) {
          const [Y, M, D] = b.dataset.d.split('-').map(Number);
          cur = { Y, M, D, h: h24(), m: time.m }; view = { Y, M }; commit();
          if (withTime) draw(); else { close(); btn.focus(); }
          return;
        }
        if (b.dataset.t || b.dataset.ap) {
          if (b.dataset.t) { const [k, dir] = [b.dataset.t[0], b.dataset.t[1] === '+' ? 1 : -1]; if (k === 'h') time.h12 = ((time.h12 - 1 + dir + 12) % 12) + 1; else time.m = (time.m + dir * 5 + 60) % 60; }
          else time.pm = b.dataset.ap === 'pm';
          if (!cur) { const n = new Date(); cur = { Y: n.getFullYear(), M: n.getMonth(), D: n.getDate(), h: 0, m: 0 }; view = { Y: cur.Y, M: cur.M }; }
          cur.h = h24(); cur.m = time.m; commit(); draw(); return;
        }
        if ('clear' in b.dataset) { dV.set.call(inp, ''); paint(); emit(); close(); btn.focus(); return; }
        if ('now' in b.dataset) {
          const n = new Date(); cur = { Y: n.getFullYear(), M: n.getMonth(), D: n.getDate(), h: n.getHours(), m: n.getMinutes() };
          view = { Y: cur.Y, M: cur.M }; setTime(cur.h, cur.m); commit();
          if (withTime) draw(); else { close(); btn.focus(); }
          return;
        }
        if ('done' in b.dataset) { close(); btn.focus(); }
      }
      btn.addEventListener('click', () => (pop ? close() : open()));
      btn.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) { e.stopPropagation(); close(); } else if (e.key === 'ArrowDown' && !pop) { e.preventDefault(); open(); } });
      // keep the label in step when page code sets the value directly or resets the form
      Object.defineProperty(inp, 'value', { configurable: true, get() { return dV.get.call(this); }, set(v) { dV.set.call(this, v); paint(); } });
      if (inp.form) inp.form.addEventListener('reset', () => setTimeout(paint, 0));
      new MutationObserver(() => { wrap.hidden = inp.hidden; btn.disabled = inp.disabled; }).observe(inp, { attributes: true, attributeFilter: ['disabled', 'hidden'] });
      paint();
    });
  }
  // ---- Database page on phones: tidy filter bar, custom dropdowns for re-rendered filters, active tab slides into view
  function setupDatabaseUi() {
    const host = $('.db'); if (!host) return;
    const tidy = () => {
      host.querySelectorAll('.db__bar').forEach((bar) => [...bar.children].forEach((c) => {
        if (!c.classList.contains('is-spacer') && !c.children.length && !c.textContent.trim() && !/^(INPUT|SELECT|HR|IMG)$/.test(c.tagName)) c.classList.add('is-spacer');
      }));
      enhanceSelects(host, 'select.sel');
    };
    const glide = () => { const on = $('.tabs .tab.is-on', host); if (on) on.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); };
    tidy(); setTimeout(glide, 60);
    host.addEventListener('click', (e) => { if (e.target.closest('.tab')) { setTimeout(glide, 0); setTimeout(glide, 250); } });
    new MutationObserver(tidy).observe(host, { childList: true, subtree: true });
  }
  // ---- custom dropdown: replaces a native <select> (the real select stays hidden as the source of truth)
  function enhanceSelects(root, selector = '.fld select') {
    const proto = HTMLSelectElement.prototype;
    const dValue = Object.getOwnPropertyDescriptor(proto, 'value'), dIndex = Object.getOwnPropertyDescriptor(proto, 'selectedIndex');
    root.querySelectorAll(selector).forEach((sel) => {
      if (sel.dataset.cs) return;
      sel.dataset.cs = '1';
      const wrap = document.createElement('div');
      wrap.className = 'cs' + (sel.classList.contains('sel') ? ' cs--bar' : '');
      wrap.innerHTML = '<button type="button" class="cs__btn" aria-haspopup="listbox" aria-expanded="false"><span class="cs__val"></span><svg class="icon cs__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>';
      const list = document.createElement('ul'); list.className = 'cs__list'; list.setAttribute('role', 'listbox');
      sel.classList.add('cs-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
      sel.after(wrap);
      const btn = $('.cs__btn', wrap), val = $('.cs__val', wrap);
      let active = 0;
      const build = () => { list.innerHTML = [...sel.options].map((o, i) => `<li role="option" data-i="${i}">${esc(o.textContent)}</li>`).join(''); };
      const paint = () => {
        const o = sel.options[sel.selectedIndex];
        val.textContent = o ? o.textContent : '';
        wrap.classList.toggle('is-empty', !o || o.value === '');
        list.querySelectorAll('li').forEach((li, i) => { li.setAttribute('aria-selected', String(i === sel.selectedIndex)); li.classList.toggle('is-active', i === active); });
      };
      const sync = () => { wrap.hidden = sel.hidden; btn.disabled = sel.disabled; paint(); };
      const isOpen = () => list.isConnected;
      const place = () => {
        const r = btn.getBoundingClientRect(), w = Math.max(r.width, wrap.classList.contains('cs--bar') ? 180 : 0);
        list.style.width = w + 'px'; list.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
        const below = innerHeight - r.bottom - 12, above = r.top - 12, up = below < Math.min(list.scrollHeight, 260) && above > below;
        list.style.maxHeight = Math.min(260, up ? above : below) + 'px';
        if (up) { list.style.top = 'auto'; list.style.bottom = (innerHeight - r.top + 6) + 'px'; }
        else { list.style.bottom = 'auto'; list.style.top = (r.bottom + 6) + 'px'; }
      };
      const reveal = () => { const li = list.children[active]; if (li) li.scrollIntoView({ block: 'nearest' }); };
      const onDoc = (e) => { if (!wrap.isConnected || !(wrap.contains(e.target) || list.contains(e.target))) close(); };
      const onScroll = (e) => { if (!list.contains(e.target)) close(); };
      function open() {
        if (isOpen() || sel.disabled) return;
        document.body.appendChild(list); wrap.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
        active = Math.max(0, sel.selectedIndex); paint(); place(); reveal();
        document.addEventListener('mousedown', onDoc, true); document.addEventListener('scroll', onScroll, true); addEventListener('resize', close);
      }
      function close() {
        if (!isOpen()) return;
        list.remove(); wrap.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('scroll', onScroll, true); removeEventListener('resize', close);
      }
      const choose = (i) => { sel.selectedIndex = i; active = i; sel.dispatchEvent(new Event('change', { bubbles: true })); close(); btn.focus(); };
      // keep the custom label in step when page code sets the value directly
      Object.defineProperty(sel, 'value', { configurable: true, get() { return dValue.get.call(this); }, set(v) { dValue.set.call(this, v); paint(); } });
      Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return dIndex.get.call(this); }, set(v) { dIndex.set.call(this, v); paint(); } });
      new MutationObserver((m) => { if (m.some((x) => x.type === 'childList')) build(); sync(); })
        .observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
      sel.addEventListener('change', paint);
      btn.addEventListener('click', () => (isOpen() ? close() : open()));
      list.addEventListener('mousedown', (e) => e.preventDefault());
      list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) choose(+li.dataset.i); });
      btn.addEventListener('keydown', (e) => {
        const k = e.key, n = sel.options.length;
        if (k === 'Escape' && isOpen()) { e.stopPropagation(); close(); }
        else if (k === 'Tab') close();
        else if ((k === 'ArrowDown' || k === 'ArrowUp') && n) { e.preventDefault(); if (!isOpen()) open(); else { active = (active + (k === 'ArrowDown' ? 1 : -1) + n) % n; paint(); reveal(); } }
        else if ((k === 'Enter' || k === ' ') && isOpen()) { e.preventDefault(); if (n) choose(active); }
      });
      btn.addEventListener('keyup', (e) => { if (e.key === ' ') e.preventDefault(); });
      build(); sync();
    });
  }
  function modal({ title, sub = '', fields = [], submit = 'Save', danger = false, onSubmit, onOpen }) {
    return new Promise((resolve) => {
      const bg = document.createElement('div');
      bg.className = 'modal-backdrop';
      bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${sub ? `<p class="modal__sub">${esc(sub)}</p>` : ''}
        <form class="form-grid" novalidate>${fields.map(fieldHtml).join('')}<p class="form-error" hidden></p>
        <div class="modal__actions"><button type="button" class="btn btn--fit" data-close>Cancel</button>
        <button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'} btn--fit">${esc(submit)}</button></div></form></div>`;
      document.body.appendChild(bg);
      const form = $('form', bg), errEl = $('.form-error', bg);
      enhanceSelects(form);
      enhanceDates(form, '.fld input[type="date"], .fld input[type="datetime-local"]');
      const close = (val) => { document.removeEventListener('keydown', onKey); bg.remove(); resolve(val); };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(null); });
      $('[data-close]', bg).addEventListener('click', () => close(null));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errEl.hidden = true;
        const values = Object.fromEntries(new FormData(form).entries());
        for (const f of fields) if (f.type === 'checkbox') values[f.name] = values[f.name] === 'on';
        for (const f of fields) if (f.required && !String(values[f.name] ?? '').trim()) { errEl.textContent = `${f.label} is required`; errEl.hidden = false; return; }
        const btn = $('[type=submit]', bg); btn.disabled = true;
        try { const out = onSubmit ? await onSubmit(values) : values; close(out === undefined ? true : out); }
        catch (err) { errEl.textContent = err.message; errEl.hidden = false; btn.disabled = false; }
      });
      if (onOpen) onOpen(bg, form);
      const first = $('input:not(.cs-native), textarea, .cs__btn', form); if (first) first.focus(); else $('[type=submit]', bg).focus();
    });
  }
  const confirmBox = (title, sub, submit = 'Confirm', danger = true) => modal({ title, sub, submit, danger }).then((r) => r !== null);

  // ---- csv
  function downloadCsv(name, rows) {
    const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const blob = new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---- maps (Leaflet is vendored in /admin/vendor/leaflet)
  const COLORS = { incident: '#d32f2f', hazard: '#f59e0b', center: '#34c759', block: '#111827' };
  // Keeps the map inside the barangay's service area (centre + radiusKm). radiusKm 0/undefined = unlimited.
  function areaBounds(c) {
    if (c && c.boundary && c.boundary.length >= 3) {            // exact border: its bounding box plus 15% room
      const la = c.boundary.map((p) => p[0]), lo = c.boundary.map((p) => p[1]);
      const a = Math.min(...la), b = Math.max(...la), x = Math.min(...lo), y = Math.max(...lo), pa = (b - a) * 0.15 + 0.0005, px = (y - x) * 0.15 + 0.0005;
      return [[a - pa, x - px], [b + pa, y + px]];
    }
    if (!c || !c.radiusKm) return null;
    const r = c.radiusKm * 1.25, dLat = r / 111.32, dLng = r / (111.32 * Math.cos((c.lat * Math.PI) / 180));
    return [[c.lat - dLat, c.lng - dLng], [c.lat + dLat, c.lng + dLng]];
  }
  function makeMap(el, center, zoom = 15) {
    if (typeof L === 'undefined') { el.innerHTML = '<div class="empty"><b>Map unavailable</b>The map library did not load.</div>'; return null; }
    const bounds = areaBounds(center);
    const map = L.map(el, { zoomControl: true, attributionControl: true, ...(bounds ? { maxBounds: bounds, maxBoundsViscosity: 1, minZoom: 12 } : {}) }).setView([center.lat, center.lng], zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    if (center && center.boundary && center.boundary.length >= 3) {
      const poly = L.polygon(center.boundary, { color: '#c8203c', weight: 2.5, fillColor: '#c8203c', fillOpacity: 0.05, interactive: false }).addTo(map);
      map.fitBounds(poly.getBounds(), { padding: [20, 20] });
    }
    return map;
  }
  const marker = (map, lat, lng, kind, opts = {}) =>
    L.circleMarker([lat, lng], { radius: opts.radius || 9, color: '#fff', weight: 2.5, fillColor: COLORS[kind], fillOpacity: 1 }).addTo(map);

  // ---- page chrome
  function currentUser() { try { return JSON.parse(localStorage.getItem(USER)); } catch { return null; } }

  // ---- topbar extras: notifications panel (bell) and search suggestions
  function topbarExtras() {
    const SEEN = 'ehbr_admin_seen';
    const seen = () => localStorage.getItem(SEEN) || '1970-01-01T00:00:00Z';
    const bell = $('.icon-btn[aria-label="Reports"]');
    if (bell && !bell.dataset.wired) {
      bell.dataset.wired = '1'; bell.setAttribute('aria-label', 'Notifications'); bell.removeAttribute('href'); bell.style.cursor = 'pointer';
      const panel = document.createElement('div'); panel.className = 'dd bellpanel'; panel.hidden = true; document.body.appendChild(panel);
      let items = [], tab = 'all';
      const unread = () => items.filter((i) => i.at > seen());
      const draw = () => {
        const u = unread(), list = tab === 'unread' ? u : items;
        panel.innerHTML = `<div class="dd__head"><b>Notifications</b><button type="button" data-readall>Mark all read</button></div>
          <div class="dd__tabs"><button type="button" data-tab="all" class="${tab === 'all' ? 'is-on' : ''}">All</button><button type="button" data-tab="unread" class="${tab === 'unread' ? 'is-on' : ''}">Unread (${u.length})</button></div>
          <div class="dd__list">${list.length ? list.slice(0, 12).map((i) => `<a class="dd__item${i.at > seen() ? ' is-new' : ''}" href="${/EH-\d+/.test(i.text) ? 'reports.html?q=' + encodeURIComponent(i.text.match(/EH-\d+/)[0]) : '#'}"><span>${esc(i.text)}</span><time>${esc(ago(i.at))}</time></a>`).join('') : '<p class="dd__empty">You’re all caught up.</p>'}</div>
          <a class="dd__foot" href="reports.html">View all reports</a>`;
        $('[data-readall]', panel).onclick = () => { localStorage.setItem(SEEN, new Date().toISOString()); draw(); const d = $('.bell-dot'); if (d) d.hidden = true; };
        panel.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; draw(); }; });
      };
      bell.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!panel.hidden) { panel.hidden = true; return; }
        const r = bell.getBoundingClientRect(); panel.style.top = r.bottom + 8 + 'px'; panel.style.right = Math.max(8, innerWidth - r.right) + 'px';
        try { items = (await api('/admin/feed')).items; } catch { items = []; }
        draw(); panel.hidden = false;
      });
      // composedPath() is captured at dispatch time, so it still includes the panel after draw() replaces the clicked button
      document.addEventListener('click', (e) => { if (!e.composedPath().includes(panel)) panel.hidden = true; });
    }
    const input = $('#globalSearch');
    if (input && !input.dataset.wired) {
      input.dataset.wired = '1';
      const host = input.closest('.search'); host.style.position = 'relative';
      const dd = document.createElement('div'); dd.className = 'dd searchpanel'; dd.hidden = true; host.appendChild(dd);
      let t = null;
      input.addEventListener('input', () => {
        clearTimeout(t); const q = input.value.trim();
        if (q.length < 2) { dd.hidden = true; return; }
        t = setTimeout(async () => {
          try {
            const r = await api('/admin/search?q=' + encodeURIComponent(q));
            const sec = (title, rows) => rows.length ? `<p class="dd__sec">${title}</p>${rows.join('')}` : '';
            const html = sec('REPORTS', r.reports.map((x) => `<a class="dd__item" href="reports.html?q=${encodeURIComponent(x.id)}"><span>${esc(x.id)} · ${esc(x.type)}<small>${esc(x.locationText || '')} · ${esc(x.status.charAt(0) + x.status.slice(1).toLowerCase())}</small></span></a>`))
              + sec('RESIDENTS', r.residents.map((x) => `<a class="dd__item" href="database.html?q=${encodeURIComponent(x.name)}"><span>${esc(x.name)}<small>${esc(x.zone || 'No zone')} · contact masked</small></span></a>`))
              + sec('LOCATIONS', r.locations.map((x) => `<a class="dd__item" href="reports.html?q=${encodeURIComponent(x.name)}"><span>${esc(x.name)}<small>${x.active} active report${x.active === 1 ? '' : 's'} nearby</small></span></a>`));
            dd.innerHTML = (html || '<p class="dd__empty">No matches.</p>') + '<p class="dd__hint">Press Enter to search all reports</p>';
            dd.hidden = false;
          } catch { dd.hidden = true; }
        }, 250);
      });
      document.addEventListener('click', (e) => { if (!host.contains(e.target)) dd.hidden = true; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') dd.hidden = true; });
    }
  }

  // ---- mobile navigation drawer (burger menu, ≤860px; styles live in styles.css)
  function setupNav() {
    const app = $('.app'), side = $('.sidebar'), bar = $('.topbar'), main = $('.main');
    if (!app || !side || !bar || $('.nav-toggle')) return;
    const mq = window.matchMedia('(max-width: 860px)');
    side.id = side.id || 'adminSidebar';
    const burger = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    const cross = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'nav-toggle';
    btn.setAttribute('aria-label', 'Open menu'); btn.setAttribute('aria-controls', side.id); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = burger;

    // dark app bar (phones / small tablets): burger + brand, sits above the white title bar
    const appbar = document.createElement('div');
    appbar.className = 'appbar';
    appbar.innerHTML = '<div class="brand__logo" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div>'
      + '<div class="appbar__text"><p class="brand__name">Emergency Hub</p><p class="brand__sub">Admin Console</p></div>';
    appbar.insertBefore(btn, appbar.firstChild);
    bar.parentNode.insertBefore(appbar, bar.parentNode.firstChild);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button'; closeBtn.className = 'nav-close'; closeBtn.setAttribute('aria-label', 'Close menu');
    closeBtn.innerHTML = cross;
    const brand = $('.brand', side); if (brand) brand.appendChild(closeBtn);

    const back = document.createElement('div'); back.className = 'nav-backdrop'; back.setAttribute('aria-hidden', 'true');
    app.appendChild(back);
    app.classList.add('has-drawer');

    const set = (open, restoreFocus = true) => {
      if (open === app.classList.contains('nav-open')) return;
      app.classList.toggle('nav-open', open);
      document.documentElement.classList.toggle('nav-lock', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (main) main.inert = open;
      if (open) { const first = $('.nav__item.is-active', side) || $('a', side); if (first) first.focus(); }
      else if (restoreFocus) btn.focus();
    };
    btn.addEventListener('click', () => set(true));
    closeBtn.addEventListener('click', () => set(false));
    back.addEventListener('click', () => set(false));
    // Tapping a section: slide the drawer shut first, then navigate (otherwise the page reload cuts the animation off)
    side.addEventListener('click', (e) => {
      const a = e.target.closest('a.nav__item'); if (!a) return;
      const open = app.classList.contains('nav-open');
      if (!open) return;
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') { set(false, false); return; }
      e.preventDefault();
      const same = a.classList.contains('is-active');
      set(false, false);
      if (same) return;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => { location.href = a.href; }, still ? 0 : 220);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('.modal-backdrop')) set(false);   // let an open dialog handle its own Esc
    });
    const onChange = (e) => { if (!e.matches) set(false, false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else mq.addListener(onChange);
  }

  function init() {
    const u = currentUser();
    if (!localStorage.getItem(TOKEN) || !u || u.role !== 'admin') { location.href = 'login.html'; return null; }
    const name = $('.user__name'); if (name) name.textContent = `${u.firstName} ${u.lastName}`.trim();
    const sub = $('.user__place'); if (sub) sub.textContent = 'Administrator';
    const out = $('#logoutBtn'); if (out) out.addEventListener('click', async () => { if (await confirmBox('Sign out of Admin Console?', 'You will need to sign in again to manage incidents and reports. Unsent changes will be lost.', 'Sign Out', false)) logout(); });

    // ---- account menu (click the name at the bottom of the sidebar)
    const box = $('.user');
    if (box && !box.querySelector('.acct-menu')) {
      box.style.position = 'relative';
      const menu = document.createElement('div');
      menu.className = 'acct-menu'; menu.hidden = true;
      menu.innerHTML = `<div class="acct-menu__head"><b>${esc(`${u.firstName} ${u.lastName}`.trim() || 'Administrator')}</b><span>Administrator · Brgy. Rizal</span><span class="acct-menu__sub">Signed in · this device · session active</span></div>
        <a href="settings.html">Account settings</a><button type="button" data-pw>Change password</button><button type="button" data-out class="acct-menu__out">Sign out</button>`;
      box.appendChild(menu);
      const toggle = (v) => { menu.hidden = v === undefined ? !menu.hidden : !v; };
      $('.user__name', box).style.cursor = 'pointer';
      [$('.user__avatar', box), $('.user__name', box), $('.user__place', box)].forEach((el) => el && el.addEventListener('click', () => toggle()));
      document.addEventListener('click', (e) => { if (!box.contains(e.target)) menu.hidden = true; });
      $('[data-out]', menu).addEventListener('click', () => { menu.hidden = true; $('#logoutBtn').click(); });
      $('[data-pw]', menu).addEventListener('click', async () => {
        menu.hidden = true;
        const ok = await modal({
          title: 'Change password', sub: 'At least 10 characters, with upper and lower case letters, a number and a symbol (! @ #).', submit: 'Update password',
          fields: [
            { name: 'currentPassword', label: 'Current password', type: 'password', required: true, full: true },
            { name: 'newPassword', label: 'New password', type: 'password', required: true, full: true },
            { name: 'again', label: 'Confirm new password', type: 'password', required: true, full: true },
          ],
          onSubmit: async (v) => {
            if (v.newPassword !== v.again) throw new Error('Passwords do not match.');
            await api('/me/password', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
            return true;
          },
        });
        if (ok) toast('Password updated', 'ok');
      });
    }
    const search = $('#globalSearch');
    if (search) search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && search.value.trim()) location.href = 'reports.html?q=' + encodeURIComponent(search.value.trim()); });
    enhanceSelects(document, 'select.sel, .bk__form select, .an__form select');
    enhanceDates(document, '.bk__form input[type="datetime-local"], .bk__form input[type="date"]');
    setupChipStrip();
    setupResponsiveTables();
    setupAnnouncementsFeed();
    setupDatabaseUi();
    // Incident Map chips: glide the selected chip into view (the chip row scrolls sideways on phones)
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.im__bar .chip, .rp__bar .chip')) return;
      const glide = () => { const on = $('.im__bar .chip.is-on, .rp__bar .chip.is-on'); if (on) on.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); };
      setTimeout(glide, 0); setTimeout(glide, 250);
    });
    setupNav();
    refreshBadge();
    topbarExtras();
    return u;
  }
  async function refreshBadge() {
    try {
      const s = await api('/admin/stats');
      const b = $('.nav__badge'); if (b) { b.textContent = s.pendingReports; b.hidden = !s.pendingReports; }
      const dot = $('.bell-dot'); if (dot) dot.hidden = !s.pendingReports;
    } catch { /* page handles its own errors */ }
  }

  return { $, $$, esc, api, ago, when, toast, fail, modal, enhanceSelects, enhanceDates, confirmBox, downloadCsv, makeMap, marker, COLORS, init, logout, TOKEN, USER };
})();