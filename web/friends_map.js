// Friends on the map (docs/design/REVIEW.md 5.4, roadmap 24, mockup docs/design/12-friends-map.html). Two separate
// choices on one sheet: seeing friends (the Friends layer, off by default) and being seen (Show me to: Nobody by
// default, Crew or Friends; a delay of Live, 10 min or 1 h; Exact or Within a mile). The Worker applies the delay and
// snaps "within a mile" to a fixed grid before storing (backend/src/presence.ts); home zones are dropped on the phone
// and again on the Worker. The phone only sends while you drive unless you say otherwise. Every puck's tag says how
// old and how rough its position is, so nobody mistakes the layer for live tracking. Pure helpers: tag, minutesAgo,
// shouldSend, explainer (tests/test_friends_map.py).
(function (root) {
  'use strict';
  const SEND_EVERY_MS = 30_000, POLL_MS = 60_000, ONLY_DRIVING_KEY = 'apex.presenceOnlyDriving';
  const DELAYS = [[0, 'Live'], [600, '10 min'], [3600, '1 h']];
  const AUDIENCES = [['nobody', 'Nobody'], ['crew', 'Crew'], ['friends', 'Friends']];

  /** Whole minutes since an ISO time, never negative; null when unknown. */
  function minutesAgo(iso, now = Date.now()) {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : null;
  }
  /** A puck's tag: always how stale and how rough. "Driving · Skyway" only for Live and Exact under two minutes old. */
  function tag(p, now = Date.now()) {
    const m = minutesAgo(p && p.at, now);
    if (m === null) return '--';
    if (p.delay_s === 0 && !p.fuzz && m < 2) return p.road ? `Driving · ${p.road}` : 'Driving · exact';
    const when = m < 1 ? 'just now' : m < 60 ? `about ${m} min ago` : `about ${Math.round(m / 60)} h ago`;
    return `${when} · ${p.fuzz ? 'within a mile' : 'exact'}`;
  }
  /** A friend's line in the People list (the owner, 2026-10-30), from their newest position shared with you (`p`, one row
   *  of GET /api/presence) or none: "On the road" only for a Live position under two minutes old, else when they were last
   *  seen, never a place. No position means they don't share one with you: that is said, not guessed. */
  function friendState(p, now = Date.now()) {
    if (!p) return { live: false, text: 'Not sharing where they are' };
    const m = minutesAgo(p.at, now);
    if (m === null) return { live: false, text: '--' };
    if (p.delay_s === 0 && m < 2) return { live: true, text: p.road && !p.fuzz ? `On the road · ${p.road}` : 'On the road' };
    return { live: false, text: `Seen ${m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`}` };
  }
  /** May the phone send a position now? Sharing on, a fix, outside every home zone, and driving unless told otherwise. */
  function shouldSend({ audience, driving, onlyDriving, inZone, hasFix }) {
    return audience !== 'nobody' && !!hasFix && !inZone && (driving || !onlyDriving);
  }
  /** The one paragraph under the sheet, from the choices made. */
  function explainer(s) {
    if (!s || s.audience === 'nobody') return 'Seeing friends doesn’t share you. Nobody sees you until you choose who can. Inside a home zone, nobody sees you, convoy included.';
    const who = s.audience === 'crew' ? 'your crews' : 'your friends';
    const delay = s.delay_s === 0 ? 'as you drive' : `${s.delay_s === 600 ? '10 minutes' : 'an hour'} late`;
    return `${who[0].toUpperCase()}${who.slice(1)} see you ${delay}, ${s.fuzz ? 'within a mile' : 'where you are'}${s.onlyDriving === false ? ', whenever the app is open' : ', only while you drive'}. Inside a home zone, nobody sees you, convoy included. Nothing is kept after you choose Nobody.`;
  }

  const STYLE = `
    .fm-puck { display: grid; grid-template-columns: auto auto; gap: 6px; align-items: center; pointer-events: none; }
    .fm-puck.flip .fm-tag { order: -1; text-align: right; }   /* near the right edge the tag sits on the puck's left */
    .fm-puck .avatar { box-shadow: inset 0 0 0 2px var(--panel-ink), 0 0 0 2px var(--panel); }
    .fm-tag { background: var(--panel); color: var(--panel-ink); border: 1.5px solid var(--panel-ink); padding: 2px 6px; line-height: 1.15; white-space: nowrap; }
    .fm-tag b { display: block; font-size: 14px; } .fm-tag small { display: block; font-size: 13px; color: var(--panel-dim); }
    .fm-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--rule); flex-wrap: wrap; }
    .fm-row > span { font-weight: 600; } .fm-row > span.note { font-weight: 400; }   /* a value in pencil, the label in ink */
    .fm-row .switch { flex: 0 1 auto; }
    .fm-row .switch > button { flex: 0 0 auto; padding: 0 14px; white-space: nowrap; }
    .fm-row .sw { width: auto; min-width: 0; padding: 6px 0; }
  `;

  function mount(page) {
    const { el, btn, toast, apiCall, map } = page, d = root.document;
    if (!d.getElementById('friendsMapStyle')) d.head.append(el('style', { id: 'friendsMapStyle', textContent: STYLE }));
    let settings = { audience: 'nobody', delay_s: 600, fuzz: true }, loaded = false, layerOn = false;
    let onlyDriving = (() => { try { return root.localStorage.getItem(ONLY_DRIVING_KEY) !== '0'; } catch (_) { return true; } })();
    const pucks = new Map();
    let pollTimer = 0, sendTimer = 0, lastSent = 0;

    async function loadSettings() {
      const r = await apiCall('GET', '/api/presence/settings').catch(() => null);
      if (r && r.ok) { settings = await r.json(); loaded = true; }
      return loaded;
    }
    const zones = () => (page.zones ? page.zones() : []).map((z) => ({ lat: z.lat, lon: z.lon, r: z.r })).slice(0, 10);
    async function saveSettings(next) {
      const body = next.audience === 'nobody' ? { audience: 'nobody' } : { audience: next.audience, delay_s: next.delay_s, fuzz: next.fuzz, zones: zones() };
      const r = await apiCall('PUT', '/api/presence/settings', body).catch(() => null);
      if (!r || !r.ok) { toast('Couldn’t change who sees you. Check signal.'); return false; }
      settings = { ...settings, ...next };
      return true;
    }

    // ---- the layer: friends' pucks, refreshed every minute while it's on ----
    function puckEl(p, flip) {
      const P = root.ApexPhotos, face = P ? P.avatar(p.photo_id, p.handle, 34) : el('b', { textContent: (p.handle || '?')[0].toUpperCase() });
      const t = el('span', { className: 'fm-tag' }, el('b', { textContent: `@${p.handle}` }), el('small', { textContent: tag(p) }));
      return el('div', { className: 'fm-puck' + (flip ? ' flip' : '') }, face, t);
    }
    // the tag reads to the right of the puck, unless that would run it under the Layers key or off the screen
    const flipped = (p) => { try { return map.project([p.lon, p.lat]).x > map.getContainer().clientWidth - 200; } catch (_) { return false; } };
    async function poll() {
      if (!layerOn || !map) return;
      const r = await apiCall('GET', '/api/presence').catch(() => null);
      const list = r && r.ok ? await r.json() : null;
      if (!list) return;
      const seen = new Set();
      shown = list;
      for (const p of list) { seen.add(p.handle); place(p); }
      for (const [h, m] of pucks) if (!seen.has(h)) { m.remove(); pucks.delete(h); }
      paintZones();   // the style may not have been ready when the layer came on
    }
    let shown = [];
    function place(p) {
      const old = pucks.get(p.handle);
      if (old) old.remove();
      const flip = flipped(p);
      const m = new root.maplibregl.Marker({ element: puckEl(p, flip), anchor: flip ? 'right' : 'left' }).setLngLat([p.lon, p.lat]).addTo(map);
      m.getElement().setAttribute('aria-label', `@${p.handle}, ${tag(p)}`);   // the marker sets its own generic label
      m._flip = flip;
      pucks.set(p.handle, m);
    }
    // after the map moves, a tag that would now run off the right edge swaps sides (and back)
    function reflow() { for (const p of shown) { const m = pucks.get(p.handle); if (m && m._flip !== flipped(p)) place(p); } }
    if (map && map.on) map.on('moveend', reflow);
    // Your own home zones, hatched, while the layer is on: nobody else ever sees them.
    function circle(z, n = 48) {
      const ring = [];
      for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; ring.push([z.lon + (z.r * Math.sin(a)) / (111320 * Math.cos((z.lat * Math.PI) / 180)), z.lat + (z.r * Math.cos(a)) / 110540]); }
      return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
    }
    function paintZones() {
      if (!map || !map.getStyle) return;
      const data = { type: 'FeatureCollection', features: layerOn ? zones().map((z) => circle(z)) : [] };
      try {
        if (!map.hasImage('apex-hatch')) {
          const c = d.createElement('canvas'); c.width = c.height = 12; const x = c.getContext('2d');
          x.strokeStyle = 'rgba(80,72,60,0.45)'; x.lineWidth = 2; x.beginPath(); x.moveTo(-3, 15); x.lineTo(15, -3); x.moveTo(-3, 3); x.lineTo(3, -3); x.moveTo(9, 15); x.lineTo(15, 9); x.stroke();
          map.addImage('apex-hatch', x.getImageData(0, 0, 12, 12));
        }
        if (map.getSource('apex-home-zones')) map.getSource('apex-home-zones').setData(data);
        else {
          map.addSource('apex-home-zones', { type: 'geojson', data });
          map.addLayer({ id: 'apex-home-zones-fill', type: 'fill', source: 'apex-home-zones', paint: { 'fill-pattern': 'apex-hatch' } });
          map.addLayer({ id: 'apex-home-zones-line', type: 'line', source: 'apex-home-zones', paint: { 'line-color': '#3a342b', 'line-width': 1.5 } });
        }
      } catch (_) { if (map.once) map.once('idle', paintZones); }   // the style is still loading: once it's idle
    }
    function setLayer(on) {
      layerOn = !!on;
      clearInterval(pollTimer);
      if (layerOn) { poll(); pollTimer = setInterval(poll, POLL_MS); }
      else { for (const m of pucks.values()) m.remove(); pucks.clear(); }
      paintZones();
    }

    // ---- sending: every 30 s while sharing and driving (or always, if you said so) ----
    async function tick() {
      if (!loaded || settings.audience === 'nobody') return;
      const p = page.position ? page.position() : null;
      const ok = shouldSend({ audience: settings.audience, driving: page.driving ? page.driving() : false, onlyDriving, hasFix: !!p,
        inZone: !!(p && page.inZone && page.inZone(p.lat, p.lon)) });
      if (!ok || Date.now() - lastSent < SEND_EVERY_MS - 1000) return;
      lastSent = Date.now();
      const road = settings.delay_s === 0 && !settings.fuzz && page.roadName ? page.roadName(p.lat, p.lon) : null;
      apiCall('POST', '/api/presence', { lat: p.lat, lon: p.lon, road: road || undefined }).catch(() => {});
    }
    function start() { loadSettings(); clearInterval(sendTimer); sendTimer = setInterval(tick, 5000); }

    // ---- the sheet: both choices, one paragraph ----
    function sheet(onDone) {   // onDone: after it closes (the People row repaints its line)
      const ov = el('div', { className: 'overlay show' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Friends on the map');
      const close = () => { ov.remove(); if (typeof onDone === 'function') onDone(); };
      const body = el('div', { className: 'stack-8', style: 'max-width:560px' });
      const group = (label, opts, cur, pick) => {
        const g = el('div', { className: 'switch', role: 'radiogroup' });
        g.setAttribute('aria-label', label);
        for (const [v, t] of opts) {
          const b = el('button', { type: 'button', textContent: t, className: v === cur ? 'on' : '' });
          b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(v === cur));
          b.addEventListener('click', () => pick(v)); g.append(b);
        }
        return g;
      };
      const sw = (label, on, flip) => {
        const b = el('button', { type: 'button', className: 'sw' + (on ? ' on' : '') }, el('i'));
        b.setAttribute('aria-label', label); b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(on)); b.addEventListener('click', flip); return b;
      };
      const paint = () => {
        const share = settings.audience !== 'nobody', z = zones().length;
        body.replaceChildren(
          el('div', { className: 'row', style: 'justify-content:space-between;align-items:baseline' }, el('h2', { textContent: 'Friends on the map' }), btn('Done', close, 'linkbtn')),
          el('div', { className: 'fm-row' }, el('span', { textContent: 'Show friends' }), sw('Show friends', layerOn, () => { if (page.setLayerToggle) page.setLayerToggle(!layerOn); else setLayer(!layerOn); paint(); })),
          el('div', { className: 'fm-row' }, el('span', { textContent: 'Show me to' }), group('Show me to', AUDIENCES, settings.audience, async (v) => {
            if (await saveSettings({ ...settings, audience: v })) paint();
          })),
          ...(share ? [
            el('div', { className: 'fm-row' }, el('span', { textContent: 'Delay' }), group('Delay', DELAYS, settings.delay_s, async (v) => { if (await saveSettings({ ...settings, delay_s: v })) paint(); })),
            el('div', { className: 'fm-row' }, el('span', { textContent: 'Position shown as' }), group('Position shown as', [[false, 'Exact'], [true, 'Within a mile']], settings.fuzz,
              async (v) => { if (await saveSettings({ ...settings, fuzz: v })) paint(); })),
            el('div', { className: 'fm-row' }, el('span', { textContent: 'Only while driving' }), sw('Only while driving', onlyDriving, () => {
              onlyDriving = !onlyDriving; try { root.localStorage.setItem(ONLY_DRIVING_KEY, onlyDriving ? '1' : '0'); } catch (_) {} paint();
            })),
          ] : []),
          el('div', { className: 'fm-row' }, el('span', { textContent: 'Home zones' }), z ? el('span', { className: 'note', textContent: `${z} zone${z === 1 ? '' : 's'} · always hidden` })
            : el('span', { className: 'note' }, 'None yet: add one in ', page.openGarage ? btn('Garage, Privacy', () => page.openGarage(), 'linkbtn') : 'Garage, Privacy')),
          el('p', { className: 'note', textContent: explainer({ ...settings, onlyDriving }) }));
      };
      paint();
      ov.append(body);
      d.body.append(ov);
      if (!loaded) loadSettings().then((ok) => { if (ok) paint(); else { close(); toast('Sign in (People) to see friends on the map.'); } });
      return close;
    }

    /** Everyone sharing a position with you now (GET /api/presence), for the People list; null when it can't be read. */
    async function sharing() {
      const r = await apiCall('GET', '/api/presence').catch(() => null);
      const list = r && r.ok ? await r.json().catch(() => null) : null;
      return Array.isArray(list) ? list : null;
    }

    return { start, setLayer, sheet, poll, loadSettings, sharing, get settings() { return settings; }, get loaded() { return loaded; } };
  }

  const api = { mount, tag, minutesAgo, shouldSend, explainer, friendState, DELAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFriendsMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
