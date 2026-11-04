// Test helper: a ROUTE_ENGINE_CONTRACT corridor from a polyline ([[lat, lon], ...]), resampled every 25 m, timed at a
// constant speed from departAt. Used by tests/test_route_ctx_*.py (node).
'use strict';
const DEG = Math.PI / 180;
function metres(a, b) {
  const p1 = a[0] * DEG, p2 = b[0] * DEG, dp = p2 - p1, dl = (b[1] - a[1]) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b) {
  const p1 = a[0] * DEG, p2 = b[0] * DEG, dl = (b[1] - a[1]) * DEG;
  return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) + 2 * Math.PI) % (2 * Math.PI);
}
function corridor(id, line, { departAt, speedMps = 20, step = 25, extra = {} } = {}) {
  const pts = [line[0]];
  let carry = 0;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k], len = metres(a, b);
    let s = step - carry;
    while (s <= len) { const f = s / len; pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); s += step; }
    carry = len - (s - step);
  }
  const n = pts.length, lat = new Float64Array(n), lon = new Float64Array(n), distM = new Float64Array(n), heading = new Float32Array(n), etaAt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = pts[i][0]; lon[i] = pts[i][1];
    distM[i] = i ? distM[i - 1] + metres(pts[i - 1], pts[i]) : 0;
    heading[i] = bearing(pts[Math.max(0, i - 1)], pts[Math.min(n - 1, i + 1)]);
    etaAt[i] = departAt + distM[i] / speedMps * 1000;
  }
  let s = 90, w = 180, nn = -90, e = -180;
  for (let i = 0; i < n; i++) { s = Math.min(s, lat[i]); nn = Math.max(nn, lat[i]); w = Math.min(w, lon[i]); e = Math.max(e, lon[i]); }
  return { id, lat, lon, distM, heading, etaAt, bbox: [s, w, nn, e], departAt, ...extra };
}
/** A storage double (localStorage's API) over a Map. */
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; } };
}
/** A fetch double: routes URL substrings to fixture bodies; records the URLs asked. */
function fakeFetch(routes, log = []) {
  return async (url) => {
    log.push(url);
    for (const [part, body] of routes) if (url.includes(part)) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
}
module.exports = { corridor, metres, bearing, memoryStorage, fakeFetch };
