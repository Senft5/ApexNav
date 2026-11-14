// A place someone sent (the place card's Share, cockpit.js): a link on the owner's domain that opens the same card, on the
// same spot, with its name, in the app when it is installed (ApexNavApp.swift linkItems, the Worker's
// apple-app-site-association) and on the website otherwise. Apple and Google Maps' place cards share the same way.
// The place rides in the fragment (#place=, as #road= does), so the website's server never sees it; the token keeps to
// the characters the app passes on ([A-Za-z0-9._-]): "39.10350_-84.51200_" then the name as base64url UTF-8.
// Pure (tests/test_place_link.py).
(function (root) {
  'use strict';
  const NAME_MAX = 60;

  const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  function b64(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64(t) {
    const bin = typeof atob === 'function' ? atob(t.replace(/-/g, '+').replace(/_/g, '/')) : Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('binary');
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  /** { lat, lon, name } -> the token, or null for a point that isn't one. Five decimals: about a metre. */
  function encode(p) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
    // the name fits the app's 200-character link value: a long or non-Latin name is cut short, never the place
    let name = cleanName(p.name), enc = name ? b64(name) : '';
    while (enc.length > 120) { name = [...name].slice(0, -1).join('').trim(); enc = name ? b64(name) : ''; }
    return `${p.lat.toFixed(5)}_${p.lon.toFixed(5)}${enc ? '_' + enc : ''}`;
  }
  /** A token -> { lat, lon, name } (name '' when it had none), or null for anything malformed. */
  function decode(token) {
    const m = /^(-?\d{1,2}\.\d{1,6})_(-?\d{1,3}\.\d{1,6})(?:_([A-Za-z0-9_-]{1,120}))?$/.exec(String(token || ''));
    if (!m) return null;
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    let name = '';
    if (m[3]) { try { name = cleanName(unb64(m[3])); } catch (_) { return null; } }
    return { lat, lon, name };
  }
  /** The link to send: the site's page with the place in the fragment. */
  const url = (base, p) => { const t = encode(p); return t ? `${String(base || '').replace(/\/+$/, '')}/#place=${t}` : null; };
  /** The token the page was opened with: ?place= (the app passes the fragment on as a parameter) or #place= (the website). */
  function fromLocation(search, hash) {
    const get = (s) => { try { return new URLSearchParams(String(s || '').replace(/^[?#]/, '')).get('place'); } catch (_) { return null; } };
    return get(search) || get(hash) || null;
  }

  const api = { encode, decode, url, fromLocation, cleanName, NAME_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPlaceLink = api;
})(typeof window !== 'undefined' ? window : globalThis);
