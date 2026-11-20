'use strict';
/* Location picker for dialogs (used by "New report").
   Pick a spot by: clicking/dragging a pin on the map, searching a street or landmark,
   using this device's location, or pasting coordinates / a Google Maps link.
   It adds two hidden inputs named "lat" and "lng" to the dialog's form. */
const LP = (() => {
  const { esc, api, makeMap } = EH;
  const ico = (n) => `<svg class="icon" aria-hidden="true"><use href="#${n}"/></svg>`;

  // "14.56116, 121.05129", or a Google Maps link containing @lat,lng / !3d..!4d.. / ?q=lat,lng
  function parseCoords(text) {
    let t = String(text || '').trim();
    try { t = decodeURIComponent(t); } catch { /* keep as typed */ }
    const N = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
    const pats = [
      new RegExp(String.raw`@${N},${N}`),
      new RegExp(String.raw`!3d${N}!4d${N}`),
      new RegExp(String.raw`[?&](?:q|ll|query|destination|center)=${N},\s*${N}`),
      new RegExp(String.raw`^\s*${N}\s*[,; ]\s*${N}\s*$`),
    ];
    for (const re of pats) {
      const m = re.exec(t);
      if (!m) continue;
      const lat = Number(m[1]), lng = Number(m[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
    }
    return null;
  }

  function attach(form, { center, city = '' } = {}) {
    const locInput = form.querySelector('[name=locationText]');
    const anchor = locInput && locInput.closest('.fld');
    const box = document.createElement('div');
    box.className = 'fld full lp';
    box.innerHTML = `<span>Map pin (optional)</span>
      <div class="lp__bar">
        <div class="lp__status" data-st></div>
        <button type="button" class="btn btn--sm btn--fit" data-map>${ico('i-pin')}Pick on map</button>
        <button type="button" class="btn btn--sm btn--fit" data-gps>${ico('i-locate')}My location</button>
        <button type="button" class="btn btn--sm btn--fit" data-clear hidden>${ico('i-x')}Clear</button>
      </div>
      <small class="lp__note" data-note hidden></small>
      <div class="lp__panel" hidden>
        <div class="lp__find"><input class="input" data-q type="search" placeholder="Search a street or landmark" autocomplete="off" maxlength="120">
          <button type="button" class="btn btn--sm btn--fit" data-find>${ico('i-search')}Search</button></div>
        <ul class="lp__results" data-res hidden></ul>
        <div class="lp__map leaflet-host" data-host></div>
        <input class="input" data-paste placeholder="Or paste coordinates or a Google Maps link, then press Enter" autocomplete="off" maxlength="400">
        <small class="lp__hint">Click the map to drop a pin. Drag the pin to adjust it.</small>
      </div>
      <input type="hidden" name="lat"><input type="hidden" name="lng">`;
    if (anchor) anchor.after(box); else form.querySelector('.form-error').before(box);

    const q = (s) => box.querySelector(s);
    const latI = q('[name=lat]'), lngI = q('[name=lng]'), panel = q('.lp__panel'), list = q('[data-res]');
    let pos = null, map = null, pin = null, rows = [];

    const note = (msg) => { const n = q('[data-note]'); n.textContent = msg || ''; n.hidden = !msg; };
    function show() {
      latI.value = pos ? pos.lat.toFixed(6) : '';
      lngI.value = pos ? pos.lng.toFixed(6) : '';
      q('[data-st]').innerHTML = pos ? `${ico('i-pin')}<b>${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}</b>` : `${ico('i-pin')}<span>No pin yet</span>`;
      q('[data-clear]').hidden = !pos;
      if (!map) return;
      if (!pos) { if (pin) { pin.remove(); pin = null; } return; }
      if (pin) pin.setLatLng([pos.lat, pos.lng]);
      else {
        pin = L.marker([pos.lat, pos.lng], { draggable: true }).addTo(map);
        pin.on('dragend', () => { const p = pin.getLatLng(); set(p.lat, p.lng); });
      }
    }
    function set(lat, lng, pan) {
      pos = { lat, lng }; show(); note('');
      if (pan && map) map.setView([lat, lng], Math.max(map.getZoom(), 17));
    }
    show();

    // ---- map
    q('[data-map]').addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      q('[data-map]').classList.toggle('is-on', !panel.hidden);
      if (panel.hidden) return;
      if (!map) {
        map = makeMap(q('[data-host]'), center && center.lat != null ? center : { lat: 14.5995, lng: 120.9842 }, 16);
        if (!map) return;
        map.on('click', (e) => set(e.latlng.lat, e.latlng.lng));
        show();
      }
      setTimeout(() => { map.invalidateSize(); if (pos) map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 17)); }, 0);
    });

    // ---- this device's location
    q('[data-gps]').addEventListener('click', () => {
      if (!navigator.geolocation) return note('This browser cannot share its location.');
      note('Getting your location…');
      navigator.geolocation.getCurrentPosition(
        (p) => set(p.coords.latitude, p.coords.longitude, true),
        (e) => note(e.code === 1 ? 'Location permission was denied.' : 'Could not get your location (it needs https or localhost).'),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    });
    q('[data-clear]').addEventListener('click', () => { pos = null; show(); });

    // ---- paste coordinates or a Google Maps link
    const paste = q('[data-paste]');
    function applyPaste() {
      const v = paste.value.trim(); if (!v) return;
      const c = parseCoords(v);
      if (c) { set(c.lat, c.lng, true); paste.value = ''; }
      else if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(v)) note('Short Google links cannot be read. Open the link, then copy the full address from the browser bar.');
      else note('No coordinates found in that text.');
    }
    paste.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyPaste(); } });
    paste.addEventListener('paste', () => setTimeout(applyPaste, 0));

    // ---- search a street or landmark (the server asks OpenStreetMap on our behalf)
    async function find() {
      const text = q('[data-q]').value.trim();
      if (text.length < 3) return note('Type at least 3 letters.');
      list.hidden = true; note('Searching…');
      try {
        rows = await api('/admin/geocode?q=' + encodeURIComponent(text) + (city ? '&city=' + encodeURIComponent(city) : ''));
        if (!rows.length) return note('No match. Try a nearby street or landmark, or click the map.');
        note('');
        list.innerHTML = rows.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}</button></li>`).join('');
        list.hidden = false;
      } catch (e) { note(e.message || 'Search failed. Try again in a moment.'); }
    }
    q('[data-find]').addEventListener('click', find);
    q('[data-q]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const r = rows[Number(b.dataset.i)]; if (!r) return;
      set(r.lat, r.lng, true);
      if (locInput && !locInput.value.trim()) locInput.value = r.name.split(',').slice(0, 3).join(',').trim();   // save typing; still editable
      list.hidden = true;
    });

    // free the map when the dialog closes
    const mo = new MutationObserver(() => { if (!form.isConnected) { if (map) map.remove(); mo.disconnect(); } });
    mo.observe(document.body, { childList: true });
  }

  return { attach, parseCoords };
})();