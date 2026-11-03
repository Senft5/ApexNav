// Send the road, not the drive (panel round 2, DA-4 / RA-4; VI vetoed a public drive link, JA-3). A link that carries one
// road's line and nothing else: a few points along it (the shaping points Drive it again routes through) and its name when a
// road named it. Never the drive's time, date, speeds, score, its first and last TRIM_M (usually home and work), or who
// drove it. The road is in the link itself, so nothing is stored or looked up to open it; on the website it rides in the
// fragment (#road=…), which a browser never sends to a server. Opening it plans the road as a route card (cockpit.js
// openRoadLink). Pure (tests/test_road_link.py). The token keeps to A-Z a-z 0-9 . _ - and 200 characters, which is what
// the app's link handler passes on (ApexNavApp.swift ApexWebBundle.linkItems).
(function (root) {
  'use strict';
  const fin = Number.isFinite;
  const TRIM_M = 800, MIN_M = 400, POINTS = 11, MAX_POINTS = 16, MAX_LEN = 200, NAME_BYTES = 48, Q = 1e5;

  const b64url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64url = (t) => { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  function varints(nums) {
    const out = [];
    for (const v of nums) { let z = v < 0 ? -2 * v - 1 : 2 * v; do { let b = z % 128; z = Math.floor(z / 128); if (z) b |= 128; out.push(b); } while (z); }
    return out;
  }
  function unvarints(bytes) {
    const out = [];
    let z = 0, mul = 1;
    for (const b of bytes) { z += (b & 127) * mul; if (b & 128) { mul *= 128; if (mul > 2 ** 35) return null; continue; } out.push(z % 2 ? -(z + 1) / 2 : z / 2); z = 0; mul = 1; }
    return mul === 1 && z === 0 ? out : null;
  }
  /** A road's name for the link: trimmed, at most NAME_BYTES of UTF-8 (cut at a character), or '' */
  function cleanName(name) {
    let n = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim() : '';
    const enc = new TextEncoder();
    while (n && enc.encode(n).length > NAME_BYTES) n = n.slice(0, -1).trim();
    return n;
  }

  /** Up to `count` points along the road, its ends left out (TRIM_M each); null when what is left is shorter than MIN_M. */
  function roadPoints(lat, lon, dist, count = POINTS) {
    const n = Math.min((lat || []).length, (lon || []).length, (dist || []).length);
    if (!n) return null;
    const end = dist[n - 1], keep = [];
    for (let i = 0; i < n; i++) if (fin(lat[i]) && fin(lon[i]) && fin(dist[i]) && dist[i] >= TRIM_M && dist[i] <= end - TRIM_M) keep.push(i);
    if (keep.length < 2 || dist[keep[keep.length - 1]] - dist[keep[0]] < MIN_M) return null;
    const pts = [];
    for (let k = 0; k < count; k++) { const i = keep[Math.round(k / (count - 1) * (keep.length - 1))]; pts.push({ lat: lat[i], lon: lon[i] }); }
    return pts;
  }

  /** The link's token for these points and name, or null. */
  function encode(pts, name) {
    if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_POINTS || !pts.every((p) => p && fin(p.lat) && fin(p.lon))) return null;
    const nums = [];
    let pa = 0, po = 0;
    for (const p of pts) { const a = Math.round(p.lat * Q), o = Math.round(p.lon * Q); nums.push(a - pa, o - po); pa = a; po = o; }
    const nm = cleanName(name);
    const t = 'r1.' + b64url(varints(nums)) + (nm ? '.' + b64url(new TextEncoder().encode(nm)) : '');
    return t.length <= MAX_LEN ? t : null;
  }

  /** { pts: [{ lat, lon }], name } from a token, or null for anything that isn't a whole, sane road. */
  function decode(token) {
    if (typeof token !== 'string' || token.length > MAX_LEN || !/^r1\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?$/.test(token)) return null;
    const [, p, n] = token.split('.');
    let nums, name = '';
    try { nums = unvarints(unb64url(p)); } catch (_) { return null; }
    if (!nums || nums.length % 2 || nums.length < 4 || nums.length > MAX_POINTS * 2) return null;
    const pts = [];
    let a = 0, o = 0;
    for (let i = 0; i < nums.length; i += 2) { a += nums[i]; o += nums[i + 1]; pts.push({ lat: a / Q, lon: o / Q }); }
    if (!pts.every((q) => Math.abs(q.lat) <= 85 && Math.abs(q.lon) <= 180)) return null;
    for (let i = 1; i < pts.length; i++) {                             // a road, not a list of places: each step within 50 km
      const k = Math.cos(pts[i].lat * Math.PI / 180), m = Math.hypot((pts[i].lat - pts[i - 1].lat) * 110540, (pts[i].lon - pts[i - 1].lon) * 111320 * k);
      if (m > 50000) return null;
    }
    if (n) { try { name = cleanName(new TextDecoder('utf-8', { fatal: true }).decode(unb64url(n))); } catch (_) { return null; } }
    return { pts, name };
  }

  /** The link to send: the website, the road in the fragment. */
  const url = (origin, token) => `${String(origin).replace(/\/+$/, '')}/#road=${token}`;
  /** The road token a page was opened with: ?road= (the app's apexnav://open?road=) or #road= (the website's link). */
  function fromLocation(search, hash) {
    const get = (s) => { try { return new URLSearchParams(String(s || '').replace(/^[?#]/, '')).get('road'); } catch (_) { return null; } };
    return get(search) || get(hash) || null;
  }

  const api = { roadPoints, encode, decode, url, fromLocation, cleanName, TRIM_M, MIN_M, MAX_LEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRoadLink = api;
})(typeof window !== 'undefined' ? window : globalThis);
