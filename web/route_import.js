// Routes from elsewhere (IDEAS R-25, R-26): a GPX file (a track to follow exactly, or route points / waypoints to route
// through), and a Google Maps, Apple Maps or geo: link pasted into Where to? (its destination and stops). And a planned
// route out as GPX. Pure, no DOM (tests/test_route_import.py): the cockpit builds the route and the notes.
(function (root) {
  'use strict';
  const MAX_PTS = 20000, MAX_VIA = 8;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const ok = (lat, lon) => finite(lat) && finite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  /** Points of one kind of GPX element (trkpt, rtept, wpt) as [lon, lat], attributes in either order. */
  function pointsOf(xml, tag) {
    const out = [], re = new RegExp(`<${tag}\\b([^>]*)>`, 'g');
    let m;
    while ((m = re.exec(xml)) && out.length < MAX_PTS) {
      const lat = parseFloat((m[1].match(/\blat\s*=\s*["']([^"']+)["']/) || [])[1]);
      const lon = parseFloat((m[1].match(/\blon\s*=\s*["']([^"']+)["']/) || [])[1]);
      if (ok(lat, lon)) out.push([lon, lat]);
    }
    return out;
  }

  /**
   * A GPX file → { name, kind: 'track', coords } to follow as drawn (2+ track points), or { name, kind: 'stops', stops }
   * to route through (route points, else waypoints; the first is the start). Null when there is nothing to use.
   */
  function parseGpx(text) {
    if (typeof text !== 'string' || !/<gpx\b/i.test(text)) return null;
    const nm = text.match(/<(?:trk|rte|metadata)\b[^>]*>\s*(?:<[^>]+>\s*)*?<name>([^<]{1,120})<\/name>/) || text.match(/<name>([^<]{1,120})<\/name>/);
    const name = nm ? unescapeXml(nm[1]).trim() : null;
    const trk = pointsOf(text, 'trkpt');
    if (trk.length >= 2) return { name, kind: 'track', coords: trk };
    const stops = pointsOf(text, 'rtept');
    const list = stops.length >= 2 ? stops : pointsOf(text, 'wpt');
    if (list.length < 2) return null;
    return { name, kind: 'stops', stops: list.slice(0, MAX_VIA + 2).map(([lon, lat]) => ({ lat, lon })) };
  }

  const latLon = (s) => {
    const m = String(s || '').trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    return ok(lat, lon) ? { lat, lon } : null;
  };
  /** A place in a link: coordinates, or words to search for. */
  const place = (s) => { const t = decodeURIComponent(String(s || '').replace(/\+/g, ' ')).trim(); return t ? (latLon(t) || { query: t.slice(0, 200) }) : null; };

  /**
   * A maps link → { from, to, via } (each { lat, lon } or { query }; from null = where you are), or { short: true } for a
   * short link the phone must open first, or null when it isn't one.
   */
  function parseMapsLink(text) {
    const s = String(text || '').trim();
    if (/^geo:/i.test(s)) { const p = latLon(s.slice(4).split(/[?;]/)[0]); return p ? { from: null, to: p, via: [] } : null; }
    let u;
    try { u = new URL(s); } catch (_) { return null; }
    const host = u.hostname.replace(/^www\./, '');
    if (/^(maps\.app\.goo\.gl|goo\.gl)$/.test(host)) return { short: true };
    const q = (k) => u.searchParams.get(k);
    if (/^(maps\.)?google\.[a-z.]+$/.test(host) && (u.pathname.startsWith('/maps') || host.startsWith('maps.'))) {
      if (q('api') === '1' && (q('destination') || q('query'))) {
        return { from: q('origin') ? place(q('origin')) : null, to: place(q('destination') || q('query')),
                 via: (q('waypoints') || '').split('|').map(place).filter(Boolean).slice(0, MAX_VIA) };
      }
      const dir = u.pathname.match(/\/maps\/dir\/(.+)/);
      if (dir) {
        const parts = dir[1].split('/').filter((x) => x && !x.startsWith('@') && !x.startsWith('data=')).map(place).filter(Boolean);
        if (parts.length >= 2) return { from: parts[0], to: parts[parts.length - 1], via: parts.slice(1, -1).slice(0, MAX_VIA) };
        if (parts.length === 1) return { from: null, to: parts[0], via: [] };
      }
      const at = u.pathname.match(/\/place\/[^/]+\/@(-?[\d.]+),(-?[\d.]+)/) || u.pathname.match(/@(-?[\d.]+),(-?[\d.]+)/);
      if (at) { const p = latLon(`${at[1]},${at[2]}`); if (p) return { from: null, to: p, via: [] }; }
      if (q('q')) return { from: null, to: place(q('q')), via: [] };
      return null;
    }
    if (host === 'maps.apple.com' || host === 'maps.apple') {
      const to = q('daddr') ? place(q('daddr')) : q('ll') ? latLon(q('ll')) : q('q') ? place(q('q')) : null;
      return to ? { from: q('saddr') ? place(q('saddr')) : null, to, via: [] } : null;
    }
    return null;
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /** A planned route as a GPX track (thinned to every `step`th point), for other apps and devices. */
  function toGpx(name, lat, lon, step = 4) {
    const pts = [];
    for (let i = 0; i < lat.length; i += step) pts.push(i);
    if (pts[pts.length - 1] !== lat.length - 1) pts.push(lat.length - 1);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="ApexNav" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${esc(name || 'Route')}</name><trkseg>\n`
      + pts.map((i) => `<trkpt lat="${lat[i].toFixed(6)}" lon="${lon[i].toFixed(6)}"/>`).join('\n') + '\n</trkseg></trk>\n</gpx>\n';
  }

  const api = { parseGpx, parseMapsLink, toGpx, MAX_VIA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
