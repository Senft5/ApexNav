// The car's map (web/carmap.html in CarPlay's base view, CarPlay/ApexCarPlay.swift): the phone's theme on OpenFreeMap with
// the route, every corner's rating at its apex (the road book on the map), reported hazards as the hazard plate and the
// car's position with its sight-line speed. Apple's templates own every control, so this page takes no touches: the shell
// drives it through window.car (look, route, corners, hazards, position, sight, mode, zoom, pan, recentre, inset).
(function (root) {
  'use strict';
  const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const line = (coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.map(([lat, lon]) => [lon, lat]) } });

  const state = { theme: 'roadbook', night: false, route: [], corners: [], hazards: [], pos: null, sight: null, mode: 'idle', follow: true, inset: 0 };
  let map = null, ready = false, puck = null, sightTag = null;

  const look = () => { const t = root.ApexThemes.get(state.theme); return { P: t.map[state.night ? 'night' : 'day'], C: t[state.night ? 'night' : 'day'] }; };

  // Corner ratings and hazards are small DOM plates on the map (like the puck): ink boxes in the theme's colours, the tight
  // corners (1, 2, hairpin) filled, and the hazard plate in its fixed tokens. Only those near the car are placed, so a long
  // route never puts hundreds of plates on a small screen.
  const NEAR_M = 6000, plates = [];
  const distM = (a, b) => Math.hypot((a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180), (a[0] - b[0]) * 110540);
  // The owner's first CarPlay drive (2026-10-30, "incredibly stuttery"): every few hundred metres all forty plates were torn
  // down and built again. Now a plate that is still wanted keeps its marker (and its measured size); only the ones that
  // came into range are made and only the ones left behind removed. And a plate declutter hides is taken off the map, not
  // just made invisible: MapLibre moves every marker on the map every frame, and with the camera gliding, forty of them
  // (most off the screen) were most of the page's work a frame.
  function makePlate(w) {
    const el = document.createElement('div');
    if (w.hazard) { el.className = 'car-plate car-hazard'; el.innerHTML = '<i></i>'; el.append(w.text); }
    else { el.className = 'car-plate car-corner' + (w.tight ? ' tight' : ''); el.textContent = w.text; }
    return { key: w.key, el, at: w.at, dy: w.dy, hazard: w.hazard, on: false, m: new root.maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -w.dy] }).setLngLat([w.at[1], w.at[0]]) };
  }
  function showPlate(p, on) {
    if (p.on === on) return;
    p.on = on;
    if (on) p.m.addTo(map); else p.m.remove();
  }
  function placePlates() {
    if (!map) return;
    const here = state.pos ? [state.pos.lat, state.pos.lon] : null, all = state.mode === 'preview' || !here;
    const near = (p) => all || distM(here, p.at) < NEAR_M;
    // which plate wins a crowded spot: hazards, then the corners nearest the car (or the tight ones, with no car)
    const corners = state.corners.filter(near).map((c) => ({ c, d: here ? distM(here, c.at) : 0 }))
      .sort((x, y) => (all ? (y.c.tight - x.c.tight) || 0 : x.d - y.d)).slice(0, all ? 160 : 40);
    const wanted = state.hazards.filter(near).map((h) => { const text = String(h.title || 'Hazard').toUpperCase(); return { key: `h|${text}|${h.at}`, text, at: h.at, dy: 6, hazard: true }; })
      .concat(corners.map(({ c }) => ({ key: `c|${c.text}|${c.tight ? 1 : 0}|${c.at}`, text: c.text, tight: !!c.tight, at: c.at, dy: 8, hazard: false })));
    const old = new Map(plates.map((p) => [p.key, p]));
    plates.length = 0;
    for (const w of wanted) { const p = old.get(w.key); if (p) old.delete(w.key); plates.push(p || makePlate(w)); }
    old.forEach((p) => showPlate(p, false));
    declutter();
  }
  // Plates never pile up (the owner's car, 2026-10-29: L2, L3 and R4 on top of each other): in priority order, a plate
  // that would overlap one already shown is hidden until the map moves or zooms enough to make room. U-77: nor do they sit
  // on the car: the arrow and the sight plate under it are taken first, with CLEAR_PX around them (the review recording's
  // car/02 had R1 on the arrow and an R2 half under it as guidance began).
  const CLEAR_PX = 28;
  function carBoxes(sight) {
    const car = glide.shown || state.pos;                            // where the arrow is drawn now (it glides, below)
    if (!car) return [];
    const pt = map.project([car.lon, car.lat]), out = [[pt.x - 17 - CLEAR_PX, pt.y - 17 - CLEAR_PX, pt.x + 17 + CLEAR_PX, pt.y + 17 + CLEAR_PX]];
    if (sight) {                                                     // anchored by its top, 21 px under the car's centre
      const [w, h] = sight;
      out.push([pt.x - w / 2 - CLEAR_PX, pt.y + 21 - CLEAR_PX, pt.x + w / 2 + CLEAR_PX, pt.y + 21 + h + CLEAR_PX]);
    }
    return out;
  }
  // REVIEW4 U-77 / U-74 (check): nor under Apple's card. `inset` is the share of the left its guidance (or trip) card covers,
  // so that column, CARD_GAP past it, is taken too, as is the credit strip; and a plate is shown whole or not at all, never
  // cut by the screen's edge. A hazard (the one you just reported is at the car) tries beside the point before it gives up.
  const CARD_GAP = 16, EDGE_PX = 6;
  function reservedBoxes(g, sight) {
    const out = carBoxes(sight);
    if (state.inset > 0) out.push([-1e4, -1e4, state.inset + CARD_GAP, g.H + 1e4]);
    if (g.credit) out.push(g.credit);
    return out;
  }
  // Declutter runs while the map moves (a few times a second, platesSoon below), so it never forces a layout there: the
  // screen, the credit strip, the sight plate and every plate are measured once, when they change, all before any write.
  let geom = null, sightSize = null;
  function measure() {
    const c = map.getContainer(), fresh = plates.filter((p) => !p.w);
    fresh.forEach((p) => showPlate(p, true));                          // measured on the map, in its own font
    if (!geom) {
      const credit = document.getElementById('credit'), mr = c.getBoundingClientRect(), b = credit && credit.offsetHeight ? credit.getBoundingClientRect() : null;
      geom = { W: c.clientWidth, H: c.clientHeight, credit: b && [b.left - mr.left - 3, b.top - mr.top - 3, b.right - mr.left + 3, b.bottom - mr.top + 3] };
    }
    const tag = sightTag && sightTag.getElement();
    if (!tag || tag.hidden) sightSize = null; else if (!sightSize) sightSize = [tag.offsetWidth || 80, tag.offsetHeight || 24];
    for (const p of fresh) { p.w = p.el.offsetWidth || 40; p.h = p.el.offsetHeight || 24; }
  }
  function declutter() {
    declutterAt = performance.now();
    if (!map || !plates.length) return;
    measure();
    const W = geom.W, H = geom.H, shown = reservedBoxes(geom, sightSize);
    const fits = (box) => box[0] >= EDGE_PX && box[1] >= EDGE_PX && box[2] <= W - EDGE_PX && box[3] <= H - EDGE_PX
      && !shown.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
    // how far beside a point a plate must stand to clear the car there: the arrow, or the wider sight plate under it
    const reach = Math.max(17, sightSize ? sightSize[0] / 2 : 0) + CLEAR_PX + 6;
    for (const p of plates) {
      const pt = map.project([p.at[1], p.at[0]]), w = p.w, h = p.h;
      // [x, y] of the plate's bottom centre from its point: above it, then (a hazard) right of it, left of it, under it
      const side = reach + w / 2, spots = [[0, -p.dy]];
      if (p.hazard) spots.push([side, h / 2], [-side, h / 2], [0, h + p.dy + 17 + CLEAR_PX]);
      let at = null;
      for (const [ox, oy] of spots) {
        const box = [pt.x + ox - w / 2 - 3, pt.y + oy - h - 3, pt.x + ox + w / 2 + 3, pt.y + oy + 3];
        if (fits(box)) { at = [ox, oy]; shown.push(box); break; }
      }
      if (at && (!p.off || p.off[0] !== at[0] || p.off[1] !== at[1])) { p.off = at; p.m.setOffset(at); }
      showPlate(p, !!at);
    }
  }
  // While the camera glides it moves every frame; the plates are placed again at most every DECLUTTER_MS of it (the markers
  // themselves ride with the map in between), and once more when it settles.
  const DECLUTTER_MS = 250;
  let declutterAt = 0, declutterTimer = 0;
  function platesSoon() {
    if (declutterTimer) return;
    declutterTimer = setTimeout(() => { declutterTimer = 0; declutter(); }, Math.max(0, declutterAt + DECLUTTER_MS - performance.now()));
  }

  function paint() {
    if (!ready) return;
    const { P, C } = look();
    root.ApexBasemap.restyle(map, P);
    map.setPaintProperty('car-route-casing', 'line-color', P.casing);
    map.setPaintProperty('car-route', 'line-color', C.route);
    const st = document.documentElement.style;
    st.setProperty('--plate', C.panel); st.setProperty('--plate-ink', C.panelInk);
    // U-89: the credit sits on a strip of the map's own ground, so no place name shows through under it ("Cincinnati" ran
    // under the attribution in the review recording's car/01); its words dimmed, the strip solid
    const credit = document.getElementById('credit');
    credit.style.background = P.bg;
    credit.style.color = /^#[0-9A-Fa-f]{6}$/.test(P.label) ? `${P.label}A6` : P.label;
    geom = null;                                                      // the credit strip, measured again by the next declutter
    drawPuck();
  }

  function drawPuck() {
    const { C } = look();
    puck.getElement().innerHTML = `<svg viewBox="0 0 34 34" width="34" height="34"><circle cx="17" cy="17" r="14" fill="${C.panel}" stroke="${C.panelInk}" stroke-width="2.5"/><path d="M17 7 L25 24 L17 19.8 L9 24 Z" fill="${C.accent}"/></svg>`;
  }

  // The sight-line speed under the arrow (web/carplay.js sightMessage): its own marker, so it stays upright while the
  // arrow turns with the car; red when you are going faster than it; hidden when unknown.
  const EYE = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/></svg>';
  function drawSight() {
    if (!sightTag) return;
    const el = sightTag.getElement(), s = state.sight;
    sightSize = null;                                                 // measured again by the next declutter
    if (!s || !s.text || !state.pos) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('short', s.short);                            // classList: MapLibre's own marker classes stay
    const b = document.createElement('b'); b.textContent = s.text;
    const u = document.createElement('small'); u.textContent = s.unit || '';
    el.innerHTML = EYE; el.append(b); if (s.unit) el.append(u);
  }

  function addLayers() {
    const firstSymbol = (map.getStyle().layers.find((l) => l.type === 'symbol') || {}).id;
    // The car draws the relief as the hillshade alone: the phone's contour lines (thousands of line features a tile,
    // generated in workers as the car moves) were the heaviest thing on the car's screen, for a glance's worth of detail
    // (the owner's first CarPlay drive, 2026-10-30: a frame cost 2-3 times one without them, measured at 800 × 480).
    map.addSource('apex-dem', { type: 'raster-dem', tiles: [DEM_URL], tileSize: 256, encoding: 'terrarium', maxzoom: 13 });
    map.addLayer({ id: 'apex-hillshade', type: 'hillshade', source: 'apex-dem', paint: {} }, firstSymbol);
    const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 16, b];
    map.addSource('car-route-src', { type: 'geojson', data: empty() });
    map.addLayer({ id: 'car-route-casing', type: 'line', source: 'car-route-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': width(6, 14) } });
    map.addLayer({ id: 'car-route', type: 'line', source: 'car-route-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': width(4, 9) } });
  }

  function setData() {
    if (ready) map.getSource('car-route-src').setData(state.route.length >= 2 ? { type: 'FeatureCollection', features: [line(state.route)] } : empty());
    placePlates();                                                  // plates are DOM markers: they need the map, not its style
  }

  // The car glides (the owner's first CarPlay drive, 2026-10-30: "incredibly stuttery and unusable"): the arrow, its sight
  // plate and the camera move every frame. F-01 (REVIEW_FEEL.md): they used to ease to the newest 1 Hz fix, "never ahead of
  // real data", so the arrow sat where the car was a second ago (11 m behind at the median, 25 m at the 95th percentile at
  // 20 to 25 m/s) and entered every corner after the car did. Now they are dead reckoned between fixes (web/car_glide.js):
  // from the last fix at its speed, along the route line when the car is on it, never more than 1.5 s or 50 m past the fix,
  // and eased into each new one. Position only: no road value is ever predicted. The loop stops when the car does.
  const glider = root.ApexCarGlide.create();
  const glide = { shown: null };
  let raf = 0;
  const nowS = () => performance.now() / 1000;
  // The camera's heading follows the arrow's through a short lag (CAM_TAU_S): the arrow turns with the road at once, the
  // map under it swings smoothly, as a navigation app's does (dead reckoned along a twisty route, the road's own heading
  // turns faster than a glance can follow).
  const CAM_TAU_S = 0.4;
  const turn = (a, b) => ((b - a + 540) % 360) - 180;                // degrees, the short way round
  let camB = null, camT = 0;
  function camBearing(p, t) {
    if (!finite(p.course)) return camB == null ? 0 : camB;
    if (camB != null && finite(t) && t <= camT) return camB;          // a camera ease (camera()) is on its way there
    if (camB == null || !finite(t) || t - camT > 1) camB = p.course;
    else camB = (camB + turn(camB, p.course) * (1 - Math.exp(-(t - camT) / CAM_TAU_S)) + 360) % 360;
    camT = t;
    return camB;
  }
  // heading up while guiding, the car low on the screen; north up and centred otherwise
  function followView(p, t) {
    const guiding = state.mode === 'guide', h = geom ? geom.H : map.getContainer().clientHeight;
    return { center: [p.lon, p.lat], bearing: guiding && finite(p.course) ? (finite(t) ? camBearing(p, t) : p.course) : 0, pitch: guiding ? 45 : 0,
      zoom: guiding ? Math.max(map.getZoom(), 15) : map.getZoom(), padding: { top: guiding ? h * 0.35 : 0, bottom: 0, left: state.inset, right: 0 } };
  }
  function show(p, t) {
    glide.shown = p;
    puck.setLngLat([p.lon, p.lat]); puck.setRotation(p.course || 0);
    sightTag.setLngLat([p.lon, p.lat]);
    // a mode change, Recentre or a zoom button eases the camera on its own; the glide takes it back when that ends
    if (ready && state.follow && state.mode !== 'preview' && !map.isEasing()) map.jumpTo(followView(p, finite(t) ? t : nowS()));
    platesSoon();
  }
  function frame(ts) {
    raf = 0;
    if (!puck) return;
    const t = finite(ts) ? ts / 1000 : nowS();                       // the frame's own time, the one it is drawn for
    show(glider.pose(t), t);
    if (glider.moving(t)) raf = requestAnimationFrame(frame);
  }
  // after a new fix or route: draw now if the car stands, else keep the frame loop running
  function kick() {
    if (!puck || !glider.fix) return;
    const t = nowS();
    if (glider.moving(t)) { if (!raf) raf = requestAnimationFrame(frame); } else show(glider.pose(t), t);
  }

  // The camera for a change of mode, route or card: the whole route for a trip preview, else following the car (where
  // it is drawn now), or where the driver panned until Recentre. `inset` is the width Apple's card covers on the left.
  function camera(animate = true) {
    if (!ready) return;
    const pad = { top: 40, bottom: 40, left: 40 + state.inset, right: 80 };
    if (state.mode === 'preview' && state.route.length >= 2) {
      const b = new root.maplibregl.LngLatBounds();
      for (const [lat, lon] of state.route) b.extend([lon, lat]);
      map.fitBounds(b, { padding: pad, pitch: 0, bearing: 0, duration: animate ? 600 : 0, maxZoom: 15 });
      return;
    }
    if (!state.follow || !glider.fix) return;
    // to where the car will be drawn when the ease ends, so the glide takes over without a step
    const t = nowS() + (animate ? 0.45 : 0), view = followView(glider.pose(t));
    if (state.mode === 'guide') { camB = view.bearing; camT = t; }      // the frames carry on from the heading it eases to
    map.easeTo({ ...view, duration: animate ? 450 : 0, essential: true });
  }

  const car = {
    look(theme, night) {
      theme = theme || 'roadbook'; night = !!night;
      if (ready && theme === state.theme && night === state.night) return;    // the shell says it again on every trait change
      state.theme = theme; state.night = night; paint();
    },
    route(coords) { state.route = Array.isArray(coords) ? coords.filter((p) => Array.isArray(p) && finite(p[0]) && finite(p[1])) : []; glider.setRoute(state.route, nowS()); kick(); setData(); camera(); },
    corners(list) { state.corners = (Array.isArray(list) ? list : []).filter((c) => c && Array.isArray(c.at)).slice(0, 600); setData(); },
    hazards(list) { state.hazards = (Array.isArray(list) ? list : []).filter((h) => h && Array.isArray(h.at)).slice(0, 40); setData(); },
    // speed in m/s and how old the fix is (ms) when the shell knows them (ApexCar.position); without them the glide
    // takes the speed from the distance between fixes
    position(lat, lon, course, speed, ageMs) {
      if (!finite(lat) || !finite(lon)) return;
      const c = finite(course) && course >= 0 ? course : null, was = state.pos;
      if (was && was.lat === lat && was.lon === lon && was.course === c) return;   // the same fix again: nothing moved
      state.pos = { lat, lon, course: c };
      const now = nowS(), age = finite(ageMs) ? Math.max(0, Math.min(1500, ageMs)) / 1000 : 0;
      glider.push(lat, lon, c, finite(speed) && speed >= 0 ? speed : null, now - age, now);
      kick();
      if (sightTag && sightTag.getElement().hidden && state.sight && state.sight.text) drawSight();
      if (!state.placedAt || distM(state.placedAt, [lat, lon]) > 800) { state.placedAt = [lat, lon]; placePlates(); }   // plates follow the car, a few times a mile
    },
    sight(s) {
      const next = s && typeof s.text === 'string' ? { text: s.text.slice(0, 6), unit: String(s.unit || '').slice(0, 5), short: !!s.short } : null;
      if (JSON.stringify(next) === JSON.stringify(state.sight)) return;
      state.sight = next; drawSight();
    },
    // U-77: the plates are placed again once the new camera has settled (heading up and pitched, the car low on the screen),
    // not only for the camera the mode left behind. The shell says the mode on every layout pass; only a change does
    // anything (a repeat used to tear down every plate, restart the camera's ease and undo a pan).
    mode(m) {
      const next = m === 'guide' || m === 'preview' ? m : 'idle';
      if (next === state.mode) return;
      state.mode = next; state.follow = true; placePlates(); camera();
      if (ready) map.once('moveend', placePlates);
    },
    zoom(dir) { if (ready) map.easeTo({ zoom: map.getZoom() + (dir > 0 ? 1 : -1), duration: 300 }); },
    pan(dx, dy) { if (!ready) return; state.follow = false; map.panBy([dx * map.getContainer().clientWidth / 3, dy * map.getContainer().clientHeight / 3], { duration: 300 }); },
    recentre() { state.follow = true; if (state.mode === 'preview') state.mode = 'idle'; camera(); },
    inset(px) {
      const next = finite(px) ? Math.max(0, px) : 0;
      if (next === state.inset) return;
      state.inset = next; camera(false); platesSoon();
    },
    get state() { return state; },
    get shown() { return glide.shown; },                              // where the arrow is drawn (e2e/smoke.js)
    get map() { return map; },
  };
  root.car = car;

  function start() {
    // F-17 (REVIEW_FEEL.md): the phone's tile store (web/offline_tiles.js: the same origin, so the same IndexedDB): a saved
    // area serves the car too, and the style, its data description and label fonts are kept as they arrive, so the car map
    // opens from them the next time instead of fetching them again
    const offline = root.ApexOfflineTiles;
    try { if (offline) offline.install(root.maplibregl); } catch (_) {}
    // at most 2 device pixels to a CSS pixel: a 3x car screen drew 2.25 times the pixels for no sharper a glance
    map = new root.maplibregl.Map({ container: 'map', style: MAP_STYLE, center: [-84.29, 35.36], zoom: 14, attributionControl: false, interactive: false, fadeDuration: 0,
      pixelRatio: Math.min(2, root.devicePixelRatio || 1), transformRequest: offline ? offline.transform : undefined });
    const el = document.createElement('div'); el.className = 'car-puck';
    puck = new root.maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([-84.29, 35.36]).addTo(map);
    drawPuck();
    const tag = document.createElement('div'); tag.className = 'car-sight'; tag.hidden = true;
    sightTag = new root.maplibregl.Marker({ element: tag, anchor: 'top', offset: [0, 21] }).setLngLat([-84.29, 35.36]).addTo(map);
    kick();                                                           // a fix that came before the map
    map.on('load', () => { addLayers(); ready = true; paint(); setData(); camera(false); });
    map.on('moveend', platesSoon);
    map.on('resize', () => { geom = null; platesSoon(); });
    if (document.fonts) document.fonts.ready.then(() => { plates.forEach((p) => { p.w = 0; }); sightSize = null; platesSoon(); });   // the plates' font, once it is in
    map.on('styleimagemissing', () => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
