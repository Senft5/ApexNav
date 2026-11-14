// A picture of the place at the top of its card (the map's place card, cockpit.js showPin), as Apple and Google Maps lead
// theirs with one: the street-level photo taken nearest the place and facing it, from Mapillary (graph.mapillary.com
// images; the owner's free client token from GET /api/ctx/keys, as route_ctx/photos.js uses). Photos are CC BY-SA 4.0:
// the card names who took it, and when. No photo near enough, or none facing the place: no picture, never a guess.
//
// Mapillary sees a ~140 m square round the tapped place, nothing of the driver; the picture itself comes from Meta's
// image servers (fbcdn.net) (docs/APP_REVIEW.md, third parties). url(), pick() are pure (tests/test_place_photo.py).
(function (root) {
  'use strict';
  const DEG = Math.PI / 180, M_PER_DEG = 111320;
  const NEAR_M = 70, MIN_M = 4, FACING_DEG = 40, AGE_W = 0.06;

  /** The images query: every photo in a square NEAR_M each side of the place, with its position, heading and taker. */
  function url(lat, lon, token) {
    const dLat = NEAR_M / M_PER_DEG, dLon = NEAR_M / (M_PER_DEG * Math.cos(lat * DEG));
    const b = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(6)).join(',');
    return `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}`
      + `&fields=id,thumb_1024_url,computed_compass_angle,compass_angle,captured_at,computed_geometry,geometry,is_pano,creator&bbox=${b}&limit=100`;
  }

  /**
   * The photo that shows the place (pure): taken within NEAR_M of it (but not on top of it) with the camera pointing at it
   * (within FACING_DEG), not a panorama; the nearest and squarest, newer winning a close call. { src, id, by, year, m } or null.
   */
  function pick(images, lat, lon) {
    let best = null, bestScore = Infinity;
    for (const im of images || []) {
      if (!im || im.is_pano || typeof im.thumb_1024_url !== 'string' || !/^https:\/\//.test(im.thumb_1024_url)) continue;
      const g = (im.computed_geometry || im.geometry || {}).coordinates;
      const heading = Number.isFinite(im.computed_compass_angle) ? im.computed_compass_angle : im.compass_angle;
      if (!g || !Number.isFinite(g[0]) || !Number.isFinite(g[1]) || !Number.isFinite(heading)) continue;
      const east = (lon - g[0]) * M_PER_DEG * Math.cos(lat * DEG), north = (lat - g[1]) * M_PER_DEG;
      const m = Math.hypot(east, north);
      if (m < MIN_M || m > NEAR_M) continue;
      const toPlace = Math.atan2(east, north) / DEG;
      const off = Math.abs(((heading - toPlace) % 360 + 540) % 360 - 180);
      if (off > FACING_DEG) continue;
      const year = Number.isFinite(im.captured_at) ? new Date(im.captured_at).getUTCFullYear() : null;
      const age = year ? Math.max(0, Math.min(10, new Date().getUTCFullYear() - year)) : 10;
      const score = off / FACING_DEG + m / NEAR_M + age * AGE_W;
      if (score < bestScore) {
        bestScore = score;
        const by = im.creator && typeof im.creator.username === 'string' ? im.creator.username.slice(0, 40) : null;
        best = { src: im.thumb_1024_url, id: String(im.id), by, year, m: Math.round(m) };
      }
    }
    return best;
  }

  /** The words under the picture: who took it and when, with the licence (CC BY-SA asks for the taker by name). */
  const credit = (p) => [p.by ? `Photo: ${p.by}` : 'Photo', 'Mapillary', p.year, 'CC BY-SA'].filter(Boolean).join(' · ');
  /** The photo's own page on Mapillary. */
  const page = (p) => `https://www.mapillary.com/app/?pKey=${encodeURIComponent(p.id)}&focus=photo`;

  // The token: kept in memory for the session (route_ctx keeps its own under apex.keys; this never changes routing)
  let tokenP = null;
  function token(fetchFn) {
    if (!tokenP) {
      let mine = null;
      try { const k = JSON.parse(root.localStorage.getItem('apex.keys') || 'null'); mine = k && typeof k.mapillaryToken === 'string' && k.mapillaryToken ? k.mapillaryToken : null; } catch (_) {}
      const base = root.ApexSync ? root.ApexSync.apiBase : null;
      tokenP = mine ? Promise.resolve(mine) : base == null ? Promise.resolve(null)
        : fetchFn(base + '/api/ctx/keys', { headers: { 'x-apexnav': '1' }, signal: AbortSignal.timeout(5000) })
          .then((r) => (r.ok ? r.json() : null)).then((j) => (j && j.keys && typeof j.keys.mapillaryToken === 'string' && j.keys.mapillaryToken) || null)
          .catch(() => null);
      tokenP.then((t) => { if (!t) tokenP = null; });                 // asked again next time
    }
    return tokenP;
  }

  const kept = new Map();
  /** The place's photo, or null (none facing it, no token, no signal). Kept for the session by place. */
  function lookup(lat, lon, fetchFn = root.fetch && root.fetch.bind(root)) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !fetchFn || (root.navigator && root.navigator.onLine === false)) return Promise.resolve(null);
    const key = `${lat.toFixed(5)}|${lon.toFixed(5)}`;
    if (!kept.has(key)) {
      kept.set(key, token(fetchFn).then((t) => (t ? fetchFn(url(lat, lon, t), { signal: AbortSignal.timeout(6000) }) : null))
        .then((r) => (r && r.ok ? r.json() : null))
        .then((j) => { const p = j && Array.isArray(j.data) ? pick(j.data, lat, lon) : null; if (!j) kept.delete(key); return p; })
        .catch(() => { kept.delete(key); return null; }));
    }
    return kept.get(key);
  }

  const api = { url, pick, credit, page, lookup, NEAR_M, FACING_DEG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPlacePhoto = api;
})(typeof window !== 'undefined' ? window : globalThis);
