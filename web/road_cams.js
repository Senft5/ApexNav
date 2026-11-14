// Road cameras (2026-11-14): Ohio DOT's and Kentucky's (KYTC, TRIMARC) traffic cameras as an opt-in map layer (Layers → Road
// cameras). A tap opens its current still picture of the road, from the agency's own image server, to see snow, ice or a wet
// road before a drive.
// Traffic cameras only: speed and plate cameras are the Cameras layer and Avoid cameras (web/cameras.js), never these.
// The list comes from our Worker (GET /api/traffic/v1/cameras.json, backend/src/traffic.ts: whole states, no position
// sent), kept for a day. During a drive the picture waits until you stop. Loaded lazily (lazy.js 'roadcams').
// Pure helpers: geojson, pictureUrl (tests/test_road_cams.py).
(function (root) {
  'use strict';
  const SRC = 'roadcams', LAYER = 'roadcams-dots', KEEP_MS = 24 * 3600e3;
  // each picture host, and whose cameras they are (a camera's src); a picture anywhere else is never loaded
  const HOSTS = { 'https://itscameras.dot.state.oh.us/': 'Ohio DOT', 'https://www.trimarc.org/': 'Kentucky TRIMARC' };
  const hostOf = (url) => typeof url === 'string' ? Object.keys(HOSTS).find((h) => url.startsWith(h)) || null : null;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** The Worker's cameras as a GeoJSON FeatureCollection of points (id, name); malformed ones and other hosts left out. */
  function geojson(json) {
    const cams = json && Array.isArray(json.cams) ? json.cams : [];
    return { type: 'FeatureCollection', features: cams.filter((c) => c && typeof c.id === 'string' && finite(c.lat) && finite(c.lon)
        && Array.isArray(c.views) && c.views.some((v) => v && hostOf(v.url)))
      .map((c) => ({ type: 'Feature', id: c.id, geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { id: c.id, name: String(c.name || 'Road camera').slice(0, 60) } })) };
  }
  /** A picture's address made fresh (ODOT replaces the file every few minutes; a cached one would be stale), or null. */
  function pictureUrl(url, nowMs) {
    if (!hostOf(url)) return null;
    return `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor((finite(nowMs) ? nowMs : Date.now()) / 60000)}`;   // a new address each minute
  }

  /**
   * page: { map, el, btn, apiFetch(path), toast(msg), driving() → bool, ink() → { dot, edge } colours }.
   * Returns { setLayer(on) }.
   */
  function mount(page) {
    const { map, el, btn } = page;
    let on = false, cams = null, gotAt = -Infinity, asking = null, bound = false;
    const byId = new Map();

    async function list() {
      if (cams && Date.now() - gotAt < KEEP_MS) return cams;
      if (asking) return asking;
      asking = (async () => {
        try {
          const r = await page.apiFetch('/api/traffic/v1/cameras.json');
          if (r.status === 503) { page.toast('Road cameras aren\'t switched on yet.'); return null; }
          if (!r.ok) { page.toast('Road cameras didn\'t load. Check signal.'); return null; }
          const j = await r.json();
          byId.clear();
          for (const c of (j && Array.isArray(j.cams) ? j.cams : [])) if (c && typeof c.id === 'string') byId.set(c.id, c);
          cams = geojson(j); gotAt = Date.now();
          return cams;
        } catch (_) { page.toast('Road cameras didn\'t load. Check signal.'); return null; }
        finally { asking = null; }
      })();
      return asking;
    }

    function draw() {
      if (!map || !cams) return;
      const ink = page.ink ? page.ink() : { dot: '#1a1a1a', edge: '#ffffff' };
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: cams });
      else map.getSource(SRC).setData(cams);
      if (!map.getLayer(LAYER)) map.addLayer({ id: LAYER, type: 'circle', source: SRC, minzoom: 7,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 6], 'circle-color': ink.dot, 'circle-stroke-color': ink.edge, 'circle-stroke-width': 1.5 } });
      map.setLayoutProperty(LAYER, 'visibility', on ? 'visible' : 'none');
      if (!bound) {
        bound = true;
        map.on('click', LAYER, (e) => { const f = e.features && e.features[0]; if (f) open(f.properties.id); });
        map.on('mouseenter', LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', LAYER, () => { map.getCanvas().style.cursor = ''; });
      }
    }

    function open(id) {
      const c = byId.get(id);
      if (!c) return;
      if (page.driving && page.driving()) { page.toast('The picture opens when you stop.'); return; }
      const views = c.views.filter((v) => v && pictureUrl(v.url));
      if (!views.length) return;
      const ov = el('div', { className: 'overlay show' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', c.name);
      const close = () => { ov.remove(); root.document.removeEventListener('keydown', esc); };
      const esc = (e) => { if (e.key === 'Escape') close(); };
      const who = HOSTS[hostOf(views[0].url)];
      const img = el('img', { className: 'rc-pic', alt: `The road at ${c.name}, from ${who}'s camera` });
      const note = el('p', { className: 'note', textContent: 'Loading the picture…' });
      const show = (v) => {
        note.textContent = 'Loading the picture…';
        img.onload = () => { note.textContent = `${who}'s camera. The picture is a few minutes old at most.`; };
        img.onerror = () => { note.textContent = 'This camera\'s picture isn\'t available right now.'; };
        img.src = pictureUrl(v.url, Date.now());
      };
      const tabs = views.length > 1 ? el('div', { className: 'row' }, ...views.map((v, i) => btn(v.dir || `View ${i + 1}`, () => show(v), 'linkbtn'))) : null;
      ov.append(el('div', { className: 'stack-8', style: 'max-width:640px' }, el('h3', { textContent: c.name }), ...(tabs ? [tabs] : []), img, note,
        el('div', { className: 'row' }, btn('Close', close, 'linkbtn'))));
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      root.document.addEventListener('keydown', esc);
      root.document.body.append(ov);
      show(views[0]);
    }

    async function setLayer(want) {
      on = !!want;
      if (!on) { if (map && map.getLayer(LAYER)) map.setLayoutProperty(LAYER, 'visibility', 'none'); return; }
      const got = await list();
      if (!got || !on) return;
      draw();
      if (map && map.getZoom() < 7) page.toast('Zoom in to see road cameras. Tap one for the road now.');
    }
    // the look changed (a new style drops our source and layer): draw again
    if (map) map.on('styledata', () => { if (on && cams && !map.getSource(SRC)) { try { draw(); } catch (_) {} } });
    return { setLayer, open };
  }

  const api = { geojson, pictureUrl, ownerOf: (url) => HOSTS[hostOf(url)] || null, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ApexRoadCams = api;
})(typeof window !== 'undefined' ? window : globalThis);
