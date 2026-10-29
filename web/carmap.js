// The car's map (web/carmap.html in CarPlay's base view, CarPlay/ApexCarPlay.swift): the phone's theme on OpenFreeMap with
// the route, every corner's rating at its apex (the road book on the map), reported hazards as the hazard plate and the
// car's position. Apple's templates own every control, so this page takes no touches: the shell drives it through
// window.car (look, route, corners, hazards, position, mode, zoom, pan, recentre, inset).
(function (root) {
  'use strict';
  const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const line = (coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.map(([lat, lon]) => [lon, lat]) } });

  const state = { theme: 'roadbook', night: false, route: [], corners: [], hazards: [], pos: null, mode: 'idle', follow: true, inset: 0 };
  let map = null, ready = false, puck = null;

  const look = () => { const t = root.ApexThemes.get(state.theme); return { P: t.map[state.night ? 'night' : 'day'], C: t[state.night ? 'night' : 'day'] }; };

  // Corner ratings and hazards are small DOM plates on the map (like the puck): ink boxes in the theme's colours, the tight
  // corners (1, 2, hairpin) filled, and the hazard plate in its fixed tokens. Only those near the car are placed, so a long
  // route never puts hundreds of plates on a small screen.
  const NEAR_M = 6000, plates = [];
  const distM = (a, b) => Math.hypot((a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180), (a[0] - b[0]) * 110540);
  function placePlates() {
    if (!map) return;
    plates.splice(0).forEach((m) => m.remove());
    const here = state.pos ? [state.pos.lat, state.pos.lon] : null, all = state.mode === 'preview' || !here;
    const near = (p) => all || distM(here, p.at) < NEAR_M;
    for (const c of state.corners.filter(near).slice(0, all ? 160 : 40)) {
      const el = document.createElement('div'); el.className = 'car-plate car-corner' + (c.tight ? ' tight' : ''); el.textContent = c.text;
      plates.push(new root.maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -8] }).setLngLat([c.at[1], c.at[0]]).addTo(map));
    }
    for (const h of state.hazards.filter(near)) {
      const el = document.createElement('div'); el.className = 'car-plate car-hazard'; el.innerHTML = '<i></i>'; el.append(String(h.title || 'Hazard').toUpperCase());
      plates.push(new root.maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat([h.at[1], h.at[0]]).addTo(map));
    }
  }

  function paint() {
    if (!ready) return;
    const { P, C } = look();
    root.ApexBasemap.restyle(map, P);
    map.setPaintProperty('car-route-casing', 'line-color', P.casing);
    map.setPaintProperty('car-route', 'line-color', C.route);
    const st = document.documentElement.style;
    st.setProperty('--plate', C.panel); st.setProperty('--plate-ink', C.panelInk);
    document.getElementById('credit').style.color = P.label;
    drawPuck();
  }

  function drawPuck() {
    const { C } = look();
    puck.getElement().innerHTML = `<svg viewBox="0 0 34 34" width="34" height="34"><circle cx="17" cy="17" r="14" fill="${C.panel}" stroke="${C.panelInk}" stroke-width="2.5"/><path d="M17 7 L25 24 L17 19.8 L9 24 Z" fill="${C.accent}"/></svg>`;
  }

  function addLayers() {
    const firstSymbol = (map.getStyle().layers.find((l) => l.type === 'symbol') || {}).id;
    let dem = null;
    try { dem = new root.mlcontour.DemSource({ url: DEM_URL, encoding: 'terrarium', maxzoom: 13, worker: true }); dem.setupMaplibre(root.maplibregl); } catch (_) { dem = null; }
    map.addSource('apex-dem', { type: 'raster-dem', tiles: [dem ? dem.sharedDemProtocolUrl : DEM_URL], tileSize: 256, encoding: 'terrarium', maxzoom: 13 });
    map.addLayer({ id: 'apex-hillshade', type: 'hillshade', source: 'apex-dem', paint: {} }, firstSymbol);
    if (dem) {
      map.addSource('apex-contour-src', { type: 'vector', maxzoom: 15, tiles: [dem.contourProtocolUrl({ multiplier: 3.28084,
        thresholds: { 11: [200, 1000], 12: [100, 500], 13: [50, 250], 14: [20, 100], 15: [10, 50] }, elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours' })] });
      map.addLayer({ id: 'apex-contours', type: 'line', source: 'apex-contour-src', 'source-layer': 'contours',
        paint: { 'line-width': ['match', ['get', 'level'], 1, 0.9, 0.45], 'line-opacity': ['match', ['get', 'level'], 1, 0.55, 0.32] } }, firstSymbol);
    }
    const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 16, b];
    map.addSource('car-route-src', { type: 'geojson', data: empty() });
    map.addLayer({ id: 'car-route-casing', type: 'line', source: 'car-route-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': width(6, 14) } });
    map.addLayer({ id: 'car-route', type: 'line', source: 'car-route-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': width(4, 9) } });
  }

  function setData() {
    if (!ready) return;
    map.getSource('car-route-src').setData(state.route.length >= 2 ? { type: 'FeatureCollection', features: [line(state.route)] } : empty());
    placePlates();
  }

  // The camera: following the car (heading up while guiding, the car low on the screen), or the whole route for a trip
  // preview, or where the driver panned until Recentre. `inset` is the width Apple's card covers on the left.
  function camera(animate = true) {
    if (!ready) return;
    const pad = { top: 40, bottom: 40, left: 40 + state.inset, right: 80 };
    if (state.mode === 'preview' && state.route.length >= 2) {
      const b = new root.maplibregl.LngLatBounds();
      for (const [lat, lon] of state.route) b.extend([lon, lat]);
      map.fitBounds(b, { padding: pad, pitch: 0, bearing: 0, duration: animate ? 600 : 0, maxZoom: 15 });
      return;
    }
    if (!state.follow || !state.pos) return;
    const guiding = state.mode === 'guide';
    const h = map.getContainer().clientHeight;
    map.easeTo({ center: [state.pos.lon, state.pos.lat], bearing: guiding && finite(state.pos.course) ? state.pos.course : 0, pitch: guiding ? 45 : 0,
      zoom: guiding ? Math.max(map.getZoom(), 15) : map.getZoom(), padding: { top: guiding ? h * 0.35 : 0, bottom: 0, left: state.inset, right: 0 },
      duration: animate ? 450 : 0, essential: true });
  }

  const car = {
    look(theme, night) { state.theme = theme || 'roadbook'; state.night = !!night; paint(); },
    route(coords) { state.route = Array.isArray(coords) ? coords.filter((p) => Array.isArray(p) && finite(p[0]) && finite(p[1])) : []; setData(); camera(); },
    corners(list) { state.corners = (Array.isArray(list) ? list : []).filter((c) => c && Array.isArray(c.at)).slice(0, 600); setData(); },
    hazards(list) { state.hazards = (Array.isArray(list) ? list : []).filter((h) => h && Array.isArray(h.at)).slice(0, 40); setData(); },
    position(lat, lon, course) {
      if (!finite(lat) || !finite(lon)) return;
      state.pos = { lat, lon, course: finite(course) && course >= 0 ? course : null };
      if (puck) { puck.setLngLat([lon, lat]); puck.setRotation(state.pos.course || 0); }
      if (!state.placedAt || distM(state.placedAt, [lat, lon]) > 800) { state.placedAt = [lat, lon]; placePlates(); }   // plates follow the car, a few times a mile
      if (state.mode !== 'preview') camera(false);
    },
    mode(m) { state.mode = m === 'guide' || m === 'preview' ? m : 'idle'; state.follow = true; placePlates(); camera(); },
    zoom(dir) { if (ready) map.easeTo({ zoom: map.getZoom() + (dir > 0 ? 1 : -1), duration: 300 }); },
    pan(dx, dy) { if (!ready) return; state.follow = false; map.panBy([dx * map.getContainer().clientWidth / 3, dy * map.getContainer().clientHeight / 3], { duration: 300 }); },
    recentre() { state.follow = true; if (state.mode === 'preview') state.mode = 'idle'; camera(); },
    inset(px) { state.inset = finite(px) ? Math.max(0, px) : 0; camera(false); },
    get state() { return state; },
    get map() { return map; },
  };
  root.car = car;

  function start() {
    map = new root.maplibregl.Map({ container: 'map', style: MAP_STYLE, center: [-84.29, 35.36], zoom: 14, attributionControl: false, interactive: false, fadeDuration: 0 });
    const el = document.createElement('div'); el.className = 'car-puck';
    puck = new root.maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([-84.29, 35.36]).addTo(map);
    drawPuck();
    map.on('load', () => { addLayers(); ready = true; paint(); setData(); camera(false); });
    map.on('styleimagemissing', () => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
