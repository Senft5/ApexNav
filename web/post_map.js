// The real map under a Feed post's line (People → Friends, drive_posts.js card), as every social driving and running app
// shows an activity: the road it drew on the streets round it, in the theme's own map palette (basemap.js), not on a
// blank well. One hidden MapLibre map, made on first use and taken down when the Feed is left alone, renders each post
// in turn when its card nears the screen and hands back a still picture (a blob URL), kept for the page: a feed of many
// posts costs one WebGL map, never one each. No map (offline, no WebGL, the map's server failing): null, and the post
// keeps its plain line. viewFor() is pure (tests/test_post_map.py): the camera that lays the map exactly under
// drive_posts.lineSvg's fit of the same points in the same box.
(function (root) {
  'use strict';
  const TILE = 512, IDLE_MS = 20000, WAIT_MS = 10000;

  /**
   * The MapLibre camera ({ center: [lon, lat], zoom }) for a w×h picture of pts ([[lat, lon], ...]) fitted as
   * drive_posts.lineSvg fits it (north up, longitude scaled by the mean latitude, `pad` each side). Null for fewer than two
   * points. A line with no extent (one spot) gets a street view, zoom 16.
   */
  function viewFor(pts, w, h, pad = 8) {
    if (!Array.isArray(pts) || pts.length < 2 || !(w > 0) || !(h > 0)) return null;
    const k = Math.cos((pts.reduce((s, p) => s + p[0], 0) / pts.length) * Math.PI / 180);
    const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => p[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-9), (h - 2 * pad) / Math.max(y1 - y0, 1e-9));
    const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
    const lon = ((w / 2 - ox) / s + x0) / k, lat = y1 - (h / 2 - oy) / s;
    // lineSvg draws k·s px a degree of longitude; Web Mercator draws TILE·2^z / 360
    const zoom = Math.min(16, Math.log2(k * s * 360 / TILE));
    return { center: [lon, lat], zoom };
  }

  /**
   * The renderer: o.gl (maplibregl), o.style (the style URL), o.palette() (the theme's map palette, or null), o.restyle(map, P)
   * (basemap.js), o.transform (offline_tiles.js, or undefined). snap(key, pts, w, h, pad) → Promise<string | null>.
   */
  function snapper(o) {
    const doc = root.document, kept = new Map();
    let map = null, holder = null, broken = false, size = '', chain = Promise.resolve(), pending = 0, idle = 0;
    const offline = () => !!(root.navigator && root.navigator.onLine === false);
    function down() {
      if (map) { try { map.remove(); } catch (_) {} map = null; }
      if (holder) { holder.remove(); holder = null; }
      size = '';
    }
    function paint() { try { const P = o.palette && o.palette(); if (P && map) o.restyle(map, P); } catch (_) {} }
    function up(w, h) {
      if (map && size === `${w}x${h}`) return map;
      down();
      holder = doc.createElement('div');
      holder.setAttribute('aria-hidden', 'true');
      // off the page, its own size: drawn, never seen or touched
      holder.style.cssText = `position:fixed;left:-${w + 100}px;top:0;width:${w}px;height:${h}px;pointer-events:none;visibility:hidden;`;
      doc.body.append(holder);
      map = new o.gl.Map({ container: holder, style: o.style, interactive: false, attributionControl: false, preserveDrawingBuffer: true,
        fadeDuration: 0, renderWorldCopies: false, trackResize: false, pixelRatio: Math.min(2, Math.max(1, root.devicePixelRatio || 1)),
        transformRequest: o.transform });
      map.on('styledata', paint);
      map.on('error', (e) => { if (map && !(map.isStyleLoaded && map.isStyleLoaded()) && !(e && e.tile)) { broken = true; } });
      size = `${w}x${h}`;
      return map;
    }
    // one post: the camera, then the first moment everything in view has drawn; a tile that failed in view: no picture
    function one(v, w, h) {
      return new Promise((ok) => {
        let m;
        try { m = up(w, h); } catch (_) { broken = true; ok(null); return; }
        let failed = false;
        const onErr = (e) => { if (e && (e.tile || e.sourceId)) failed = true; };
        const finish = (url) => { clearTimeout(t); m.off('idle', onIdle); m.off('error', onErr); ok(url); };
        const onIdle = () => {
          if (broken || failed) { finish(null); return; }
          if (!(m.isStyleLoaded && m.isStyleLoaded())) return;
          paint();
          try {
            m.getCanvas().toBlob((b) => finish(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.85);
          } catch (_) { finish(null); }
        };
        const t = setTimeout(() => finish(null), WAIT_MS);
        m.on('idle', onIdle); m.on('error', onErr);
        try { paint(); m.jumpTo(v); m.triggerRepaint(); } catch (_) { finish(null); }
      });
    }
    function snap(key, pts, w, h, pad) {
      if (kept.has(key)) return kept.get(key);
      const v = viewFor(pts, w, h, pad);
      if (!v || broken || offline() || !o.gl || !doc) return Promise.resolve(null);
      pending++; clearTimeout(idle);
      const p = (chain = chain.then(() => (broken ? null : one(v, w, h))).catch(() => null)).then((url) => {
        if (--pending === 0) idle = setTimeout(down, IDLE_MS);   // the Feed left alone: its WebGL map goes
        if (!url) kept.delete(key);                               // asked again next time it is drawn
        return url;
      });
      kept.set(key, p);
      return p;
    }
    return { snap, get broken() { return broken; }, down };
  }

  const api = { viewFor, snapper };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPostMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
