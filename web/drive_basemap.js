// The real map under the drive page's route picture (TestFlight: "need to see map under path"). The app's own map: the
// OpenFreeMap style painted in the theme's palette (basemap.js, as the cockpit and the car draw it), through the offline
// areas' protocol (offline_tiles.js), so a saved area shows with no signal. Fitted exactly under the SVG path
// (drive_view.js plans in Mercator metres at the drive's latitude, so the two line up), shown only once its tiles have
// drawn. The owner, 2026-11-03: "i would like to be able to zoom in on it and out but not all the way out just a little
// extra": two-finger pinch and pan (one finger still scrolls the page: MapLibre's cooperative gestures, as map embeds
// do), in freely, out one zoom level past the fitted view at most, panning held round the drive, and a Recenter key;
// the path, corner numbers and moment letters follow the map (overlay()). When the map can't show, the panel says why
// in one small line ("Map unavailable offline" / "Map couldn't load"), never a silent blank. MapLibre (800 kB) loads
// only when the panel first scrolls into view (REVIEW_FEEL: the Log stays fast). Pure parts tested
// (tests/test_drive_basemap.py); the e2e drive page flows stub the map.
(function (root) {
  'use strict';
  const R = 6378137, TILE = 512, STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const rad = Math.PI / 180;
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * rad / 2));

  /**
   * Plan metres for the drive page: Web Mercator scaled by cos(lat0), with (lat[0], lon[0]) at the origin, so a linear
   * map of them is exactly a MapLibre view. Returns { x, y, frame } where frame carries what viewFor() needs.
   */
  function project(lat, lon) {
    let mean = 0;
    for (const a of lat) mean += a;
    mean /= lat.length || 1;
    const c = Math.cos(mean * rad), k = R * c, m0 = merc(lat[0]);
    const x = new Float64Array(lat.length), y = new Float64Array(lat.length);
    for (let i = 0; i < lat.length; i++) { x[i] = (lon[i] - lon[0]) * rad * k; y[i] = (merc(lat[i]) - m0) * k; }
    return { x, y, frame: { lat0: lat[0], lon0: lon[0], cos: c } };
  }

  /**
   * The MapLibre camera that puts plan point (px, py) (metres, from project()) at the picture's centre with `pxPerM`
   * screen pixels per plan metre: { center: [lon, lat], zoom }. Exact for Web Mercator at any latitude.
   */
  function viewFor(frame, px, py, pxPerM) {
    const k = R * frame.cos;
    const zoom = Math.log2(pxPerM * 2 * Math.PI * k / TILE);
    return { center: unproject(frame, px, py), zoom };
  }
  /** Plan metres -> [lon, lat]. */
  function unproject(frame, px, py) {
    const k = R * frame.cos, m = merc(frame.lat0) + py / k;
    return [frame.lon0 + px / k / rad, (2 * Math.atan(Math.exp(m)) - Math.PI / 2) / rad];
  }
  /** [lon, lat] -> plan metres. */
  function planOf(frame, lon, lat) {
    const k = R * frame.cos;
    return [(lon - frame.lon0) * rad * k, (merc(lat) - merc(frame.lat0)) * k];
  }

  /**
   * Where the SVG picture (viewBox MW x MH, plan point (xc, yc) at its centre, `ms` viewBox units a plan metre: the
   * fitted view, MapLibre zoom `fitZoom`) must move to stay on the map at camera `cam` ({ center: [lon, lat], zoom }):
   * { s, tx, ty }, so a picture point (u, v) goes to (s u + tx, s v + ty). Identity at the fitted view.
   */
  function overlay(frame, xc, yc, ms, MW, MH, fitZoom, cam) {
    if (!cam || !Number.isFinite(cam.zoom) || !Number.isFinite(fitZoom)) return { s: 1, tx: 0, ty: 0 };
    const s = 2 ** (cam.zoom - fitZoom), k = ms * s, [pcx, pcy] = planOf(frame, cam.center[0], cam.center[1]);
    return { s, tx: MW / 2 * (1 - s) + (xc - pcx) * k, ty: MH / 2 * (1 - s) + (pcy - yc) * k };
  }

  /**
   * How far the map may go from the fitted view `v` ({ center, zoom }) in a w x h box: out one zoom level at most
   * ("not all the way out just a little extra"), and panning held inside three times the fitted view each way, so the
   * drive can't be lost: { minZoom, maxBounds: [[west, south], [east, north]] }.
   */
  function limits(v, w, h) {
    const ws = TILE * 2 ** v.zoom;
    const cx = (v.center[0] + 180) / 360 * ws, cy = (1 - merc(v.center[1]) / Math.PI) / 2 * ws;
    const lon = (px) => px / ws * 360 - 180, lat = (py) => (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * py / ws))) - Math.PI / 2) / rad;
    const hw = 1.5 * w, hh = 1.5 * h;
    return { minZoom: v.zoom - 1, maxBounds: [[lon(cx - hw), lat(cy + hh)], [lon(cx + hw), lat(cy - hh)]] };
  }

  const kmBetween = (a, b, c, d) => {
    const s = Math.sin((c - a) * rad / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin((d - b) * rad / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
  };
  /** Whether a saved offline area (offline_tiles.js areas()) holds the whole box [south, west, north, east]. */
  function covered(areas, box) {
    const [s, w, n, e] = box;
    return (areas || []).some((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && Number.isFinite(a.radiusKm)
      && [[s, w], [s, e], [n, w], [n, e]].every(([la, lo]) => kmBetween(a.lat, a.lon, la, lo) <= a.radiusKm));
  }
  /** Worth asking for the map: a connection, or a saved area under the drive. Never a map that can only fail. */
  function worthTrying(online, areas, box) { return online !== false || covered(areas, box); }

  // ---- the page ------------------------------------------------------------------------------------------------------
  let loading = null;
  /** MapLibre, the offline protocol and the palette painter, once, on first use. A stub already on the page is used. */
  function load() {
    const doc = root.document;
    if (!doc.querySelector('link[href="vendor/maplibre-gl.css"]')) {   // its own stylesheet, before the page's .dv-plan rules apply
      const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/maplibre-gl.css'; doc.head.append(l);
    }
    if (root.maplibregl && root.ApexBasemap) return Promise.resolve(root.maplibregl);
    if (loading) return loading;
    const script = (src) => new Promise((ok, fail) => {
      const sc = doc.createElement('script'); sc.src = src; sc.async = false;
      sc.onload = () => ok(); sc.onerror = () => { sc.remove(); fail(new Error(`basemap: ${src}`)); };
      doc.head.append(sc);
    });
    const want = [root.maplibregl ? null : 'vendor/maplibre-gl.js', root.ApexOfflineTiles ? null : 'offline_tiles.js', root.ApexBasemap ? null : 'basemap.js'].filter(Boolean);
    loading = Promise.all(want.map(script)).then(() => root.maplibregl).catch((e) => { loading = null; throw e; });
    return loading;
  }

  const OFFLINE = 'Map unavailable offline', FAILED = 'Map couldn’t load';

  /**
   * Puts the map under `holder` (a positioned box exactly the size of the SVG) when it first comes into view.
   * view: () => { center, zoom } for the holder's current width; box: [s, w, n, e]; palette: () => the theme's map
   * palette (ApexThemes look.map); onShown: told when the map is up; onMove({ center, zoom } | null): the camera as it
   * moves (null: back to the plain picture). Returns { restyle(), refit(), recenter(), focus(v), destroy(), shown, reason }.
   */
  function attach(holder, { view, box, palette, onShown, onMove } = {}) {
    let map = null, dead = false, shown = false, io = null, timer = 0, tiles = 0, fitW = 0, reason = '';
    const doc = root.document;
    const layer = doc.createElement('div');
    layer.className = 'dv-basemap';
    layer.setAttribute('aria-hidden', 'true');
    const note = doc.createElement('span');                           // why there is no map, in one small line
    note.className = 'dv-mapnote';
    const key = doc.createElement('button');                          // Recenter: the whole drive again
    key.type = 'button'; key.className = 'dv-recenter'; key.textContent = 'Recenter'; key.hidden = true;
    key.setAttribute('aria-label', 'Recenter the map on the drive');
    key.addEventListener('click', (e) => { e.stopPropagation(); fit(true); });
    const offlineNow = () => !!(root.navigator && root.navigator.onLine === false);
    const why = () => (offlineNow() ? OFFLINE : FAILED);
    function teardown() {
      clearTimeout(timer); timer = 0;
      if (map) { try { map.remove(); } catch (_) {} map = null; }
      layer.remove(); key.remove(); key.hidden = true; shown = false;
      holder.classList.remove('on-map');
      if (onMove) onMove(null);
    }
    function fail(text) {                                            // back to the plain picture, saying why
      if (dead) return;
      teardown();
      reason = text; note.textContent = text;
      if (!note.isConnected) holder.append(note);
    }
    function paint() {
      if (!map || !root.ApexBasemap) return;
      const P = palette && palette();
      if (!P) return;
      layer.style.background = P.bg;
      try { root.ApexBasemap.restyle(map, P); } catch (_) {}
    }
    function show() {
      if (shown || dead || !map) return;
      shown = true; clearTimeout(timer); timer = 0;
      layer.classList.add('shown'); holder.classList.add('on-map');
      key.hidden = false; holder.append(key);
      if (onShown) onShown();
    }
    const camera = () => { const c = map.getCenter(); return { center: [c.lng, c.lat], zoom: map.getZoom() }; };
    /** The fitted view's zoom-out and pan limits for the holder's width now; `go`: back to the fitted view too. */
    function fit(go) {
      if (!map || dead) return;
      const v = view();
      if (!v || !Number.isFinite(v.zoom)) return;
      const w = holder.clientWidth, lim = limits(v, w, holder.clientHeight);
      try {
        if (map.setMaxBounds) map.setMaxBounds(null);                 // first, so the jump is never clamped by the old box
        if (map.setMinZoom) map.setMinZoom(lim.minZoom);
        if (go) map.jumpTo(v);
        if (map.setMaxBounds) map.setMaxBounds(lim.maxBounds);
      } catch (_) {}
      fitW = w;
      if (onMove) onMove(map.getCenter ? camera() : v);
    }
    async function start() {
      if (dead || map) return;
      const offline = root.ApexOfflineTiles;
      const online = root.navigator ? root.navigator.onLine : true;
      if (!worthTrying(online, offline && offline.areas ? offline.areas() : [], box)) { fail(OFFLINE); return; }
      let gl;
      try { gl = await load(); } catch (_) { fail(why()); return; }
      if (dead || !gl || !holder.isConnected) return;
      const v = view();
      if (!v || !Number.isFinite(v.zoom)) return;
      try {
        const O = root.ApexOfflineTiles;
        if (O && !start.installed) { try { O.install(gl); } catch (_) {} start.installed = true; }
        holder.prepend(layer);
        const lim = limits(v, holder.clientWidth, holder.clientHeight);
        // a map to look round, not one that takes the page: two fingers pinch and pan, one finger scrolls the page;
        // no rotating or tilting (the picture over it is flat and north up)
        map = new gl.Map({ container: layer, style: STYLE, center: v.center, zoom: v.zoom, attributionControl: false,
          interactive: true, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, touchPitch: false,
          keyboard: false, boxZoom: false, renderWorldCopies: false, minZoom: lim.minZoom, maxBounds: lim.maxBounds,
          fadeDuration: 0, trackResize: false, maxZoom: 20, pixelRatio: Math.min(2, root.devicePixelRatio || 1),
          transformRequest: O ? O.transform : undefined });
        fitW = holder.clientWidth;
        try { if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) map.touchZoomRotate.disableRotation(); } catch (_) {}
      } catch (_) { map = null; fail(FAILED); return; }               // no WebGL, or MapLibre refused: said, not hidden
      // the style failed (no signal, nothing saved): gone before anything is shown; a tile that failed is just a gap
      map.on('error', () => { if (!shown && map && !(map.isStyleLoaded && map.isStyleLoaded())) fail(why()); });
      map.on('styledata', paint);
      map.on('data', (e) => { if (e && e.dataType === 'source' && e.tile) tiles++; });
      map.on('idle', () => { if (tiles > 0) show(); else if (!shown) fail(why()); });
      map.on('move', () => { if (map && onMove) onMove(camera()); });
      timer = setTimeout(() => { if (!shown) fail(why()); }, 15000);   // nothing drawn in 15 s: said, not a grey box
    }
    // a new width fits the drive again (the page turned or resized); the same width leaves where the driver looked
    function refit() { if (map && !dead) { try { map.resize(); } catch (_) {} if (Math.abs(holder.clientWidth - fitW) > 1) fit(true); } }
    if (root.IntersectionObserver) {
      io = new root.IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); io = null; start(); } }, { rootMargin: '200px 0px' });
      io.observe(holder);
    } else start();
    // the owner, 2026-11-11 (TestFlight): "tapping a corner or moment here should orient the view above to show that
    // corner zoomed in on the map": a glide to camera `v` ({ center, zoom }), a jump when motion is reduced. Inside the
    // fitted view's pan box (a corner is on the drive), so the limits stay. False when the map isn't up.
    function focus(v) {
      if (!map || dead || !shown || !v || !Number.isFinite(v.zoom)) return false;
      const still = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      try { if (map.easeTo && !still) map.easeTo({ center: v.center, zoom: v.zoom, duration: 600 }); else map.jumpTo(v); } catch (_) { return false; }
      return true;
    }
    return {
      restyle: paint, refit, recenter: () => fit(true), focus,
      get shown() { return shown; },
      get reason() { return reason; },
      destroy() { dead = true; if (io) io.disconnect(); io = null; teardown(); note.remove(); },
    };
  }

  const api = { project, viewFor, unproject, planOf, overlay, limits, covered, worthTrying, attach, load, STYLE, OFFLINE, FAILED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDriveBasemap = api;
})(typeof window !== 'undefined' ? window : globalThis);
