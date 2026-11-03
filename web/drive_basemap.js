// The real map under the drive page's route picture (TestFlight: "need to see map under path"). The app's own map: the
// OpenFreeMap style painted in the theme's palette (basemap.js, as the cockpit and the car draw it), through the offline
// areas' protocol (offline_tiles.js), so a saved area shows with no signal. It is a picture, not a second map to drive:
// no gestures, fitted exactly under the SVG path (drive_view.js plans in Mercator metres at the drive's latitude, so the
// two line up), shown only once its tiles have drawn. With no signal and no saved area, or any failure, it is never
// added and the blank panel stays. MapLibre (800 kB) loads only when the panel first scrolls into view (REVIEW_FEEL:
// the Log stays fast). Pure parts tested (tests/test_drive_basemap.py); the e2e drive page flow stubs the map.
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
    const lon = frame.lon0 + px / k / rad;
    const m = merc(frame.lat0) + py / k;
    const lat = (2 * Math.atan(Math.exp(m)) - Math.PI / 2) / rad;
    const zoom = Math.log2(pxPerM * 2 * Math.PI * k / TILE);
    return { center: [lon, lat], zoom };
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

  /**
   * Puts the map under `holder` (a positioned box exactly the size of the SVG) when it first comes into view.
   * view: () => { center, zoom } for the holder's current width; box: [s, w, n, e]; palette: () => the theme's map
   * palette (ApexThemes look.map). Returns { restyle(), refit(), destroy() }; `onShown` is told when the map is up.
   */
  function attach(holder, { view, box, palette, onShown } = {}) {
    let map = null, dead = false, shown = false, io = null, timer = 0, tiles = 0;
    const layer = root.document.createElement('div');
    layer.className = 'dv-basemap';
    layer.setAttribute('aria-hidden', 'true');
    function teardown() {                                            // back to the blank panel, quietly
      clearTimeout(timer); timer = 0;
      if (map) { try { map.remove(); } catch (_) {} map = null; }
      layer.remove(); shown = false;
      holder.classList.remove('on-map');
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
      if (onShown) onShown();
    }
    async function start() {
      if (dead || map) return;
      const offline = root.ApexOfflineTiles;
      const online = root.navigator ? root.navigator.onLine : true;
      if (!worthTrying(online, offline && offline.areas ? offline.areas() : [], box)) return;
      let gl;
      try { gl = await load(); } catch (_) { return; }
      if (dead || !gl || !holder.isConnected) return;
      const v = view();
      if (!v || !Number.isFinite(v.zoom)) return;
      try {
        const O = root.ApexOfflineTiles;
        if (O && !start.installed) { try { O.install(gl); } catch (_) {} start.installed = true; }
        holder.prepend(layer);
        map = new gl.Map({ container: layer, style: STYLE, center: v.center, zoom: v.zoom, interactive: false, attributionControl: false,
          fadeDuration: 0, trackResize: false, maxZoom: 22, pixelRatio: Math.min(2, root.devicePixelRatio || 1),
          transformRequest: O ? O.transform : undefined });
      } catch (_) { teardown(); return; }
      // the style failed (no signal, nothing saved): gone before anything is shown; a tile that failed is just a gap
      map.on('error', () => { if (!shown && map && !(map.isStyleLoaded && map.isStyleLoaded())) teardown(); });
      map.on('styledata', paint);
      map.on('data', (e) => { if (e && e.dataType === 'source' && e.tile) tiles++; });
      map.on('idle', () => { if (tiles > 0) show(); else if (!shown) teardown(); });
      timer = setTimeout(() => { if (!shown) teardown(); }, 15000);   // nothing drawn in 15 s: the blank panel, not a grey box
    }
    function refit() { if (map && !dead) { const v = view(); if (v && Number.isFinite(v.zoom)) { try { map.resize(); map.jumpTo(v); } catch (_) {} } } }
    if (root.IntersectionObserver) {
      io = new root.IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); io = null; start(); } }, { rootMargin: '200px 0px' });
      io.observe(holder);
    } else start();
    return {
      restyle: paint, refit,
      get shown() { return shown; },
      destroy() { dead = true; if (io) io.disconnect(); io = null; teardown(); },
    };
  }

  const api = { project, viewFor, covered, worthTrying, attach, load, STYLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexDriveBasemap = api;
})(typeof window !== 'undefined' ? window : globalThis);
