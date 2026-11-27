'use strict';
/* Shared map pins and tooltips, so the dashboard, Incident Map and Road Blockages maps all look the same.
   Needs Leaflet (L). Load after vendor/leaflet/leaflet.js and before the page script:
   <script src="mappins.js"></script>

   MapPins.pin(layer, lat, lng, kind, opts)  kind: 'incident' | 'hazard' | 'center' | 'block'
        opts: { urgent, selected, faded, keyboard }   urgent = gentle pulse, selected = larger with a halo,
                                                      faded = muted (e.g. an expired blockage), keyboard = Tab/Enter works on the pin
   MapPins.tip(title, sub)  -> escaped tooltip HTML (title in bold, sub in grey)
   MapPins.TIP              -> tooltip options to pass as the 2nd argument of bindTooltip
   MapPins.pickIcon()       -> teardrop icon for the draggable "pick a spot" pin on the Road Blockages page */
const MapPins = (() => {
  const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
  const GLYPH = { incident: '<b></b>', hazard: '<b>!</b>', center: SHIELD, block: '<b></b>' };
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const TIP = { direction: 'top', offset: [0, -12], className: 'eh-tip', opacity: 1 };
  const tip = (title, sub) => `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  function pin(layer, lat, lng, kind, o = {}) {
    const k = GLYPH[kind] ? kind : 'incident';
    const cls = `eh-pin eh-pin--${k}${o.urgent ? ' is-urgent' : ''}${o.selected ? ' is-selected' : ''}${o.faded ? ' is-faded' : ''}`;
    return L.marker([lat, lng], {
      keyboard: !!o.keyboard, riseOnHover: true, zIndexOffset: o.selected ? 1000 : o.urgent ? 200 : 0,
      icon: L.divIcon({ className: 'eh-pin-host', html: `<div class="${cls}">${GLYPH[k]}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
    }).addTo(layer);
  }
  const pickIcon = () => L.divIcon({ className: 'eh-pin-host', html: '<div class="eh-pick"></div>', iconSize: [28, 28], iconAnchor: [14, 34] });
  return { pin, tip, TIP, pickIcon };
})();
