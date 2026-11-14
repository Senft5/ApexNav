// Along the route (IDEAS R-24, R-23): viewpoints, cafés and fuel from the map's own OpenStreetMap points (stages.js pois),
// waterfalls from OpenStreetMap too (the map's tiles carry none: asked of Overpass, fallsQuery / fallsFrom),
// placed along a planned route, and the longest stretch with no fuel. Map data, labelled as such: a viewpoint is where
// someone mapped one, a fuel station may be closed. The tiles file EV chargers under fuel too (stages.js keeps them apart,
// kind 'charge'): forCar keeps the pumps for a petrol, diesel or hybrid car or no car, and the chargers for an electric one. Pure (tests/test_scenic.py); the page pins them and says the summary.
(function (root) {
  'use strict';
  const NEAR_M = { view: 350, falls: 400, cafe: 200, fuel: 200, charge: 200 };   // a waterfall a short walk from a pull-off still counts     // how far off the road still counts as "along" it
  const SAME_M = 300;                                       // the same kind within this along the road is one stop
  const FUEL_WARN_M = 80 * 1000;                            // ~50 mi without fuel is worth saying
  const MI = 1609.344;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * The points along `track` ({lat[], lon[], dist[]}): [{ kind, name, lat, lon, m, offM }] in road order, each within
   * NEAR_M of the road, one per kind per SAME_M (a named one kept over an unnamed one).
   */
  function along(pois, track) {
    const n = track && Array.isArray(track.lat) ? track.lat.length : 0;
    if (n < 2) return [];
    const step = Math.max(1, Math.floor(n / 4000)), c = Math.cos(track.lat[0] * Math.PI / 180);
    const found = [];
    for (const p of pois || []) {
      const lim = NEAR_M[p.kind];
      if (!lim || !finite(p.lat) || !finite(p.lon)) continue;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < n; i += step) {
        const d = Math.hypot((track.lon[i] - p.lon) * 111320 * c, (track.lat[i] - p.lat) * 110540);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD <= lim) found.push({ kind: p.kind, name: p.name || null, lat: p.lat, lon: p.lon, m: track.dist[best], offM: Math.round(bestD) });
    }
    found.sort((a, b) => a.m - b.m);
    const out = [];
    for (const f of found) {
      const twin = out.find((o) => o.kind === f.kind && Math.abs(o.m - f.m) < SAME_M);
      if (!twin) out.push(f);
      else if (!twin.name && f.name) Object.assign(twin, f);
    }
    return out;
  }

  /**
   * The places that matter for the car: an electric car's chargers instead of the pumps; any other car (or none in the
   * Garage) the pumps, never a charger counted as a fuel stop. `car` = the Garage's daily car ({ fuel }) or null.
   */
  function forCar(pois, car) {
    const ev = !!(car && car.fuel === 'electric');
    return (pois || []).filter((p) => p && (ev ? p.kind !== 'fuel' : p.kind !== 'charge'));
  }

  /**
   * The longest stretch of the route with no fuel along it: { m, fromM, toM }. The start and the end count as ends.
   * `kind` 'charge' for an electric car: the longest stretch with no charger.
   */
  function fuelGap(list, totalM, kind = 'fuel') {
    const stops = [0, ...(list || []).filter((p) => p.kind === kind).map((p) => p.m), totalM].sort((a, b) => a - b);
    let gap = { m: 0, fromM: 0, toM: 0 };
    for (let i = 1; i < stops.length; i++) if (stops[i] - stops[i - 1] > gap.m) gap = { m: stops[i] - stops[i - 1], fromM: stops[i - 1], toM: stops[i] };
    return gap;
  }

  /**
   * One line for the route card: "3 viewpoints · 2 cafés", and a fuel warning when a stretch is long; '' with nothing to say.
   * opts.electric: the warning is about chargers ("no charger for the first 60 mi").
   */
  function summary(list, totalM, opts = {}) {
    const count = (k) => (list || []).filter((p) => p.kind === k).length;
    const parts = [];
    const ev = !!(opts && opts.electric), v = count('view'), wf = count('falls'), cf = count('cafe'), fu = count('fuel'), ch = count('charge');
    if (v) parts.push(`${v} viewpoint${v === 1 ? '' : 's'}`);
    if (wf) parts.push(`${wf} waterfall${wf === 1 ? '' : 's'}`);
    if (cf) parts.push(`${cf} café${cf === 1 ? '' : 's'}`);
    if (fu) parts.push(`${fu} fuel stop${fu === 1 ? '' : 's'}`);           // the owner, 2026-11-11: a station to tap for its name
    if (ch) parts.push(`${ch} charger${ch === 1 ? '' : 's'}`);
    const gap = fuelGap(list, totalM, ev ? 'charge' : 'fuel'), none = ev ? 'no charger' : 'no fuel';
    if (finite(totalM) && gap.m >= FUEL_WARN_M) {
      const U = root.ApexUnits, k = U && U.metric() ? 1000 : MI, u = U && U.metric() ? 'km' : 'mi';   // units.js, U-22
      const n = (m) => Math.round(m / k), atStart = gap.fromM < 500, atEnd = totalM - gap.toM < 500;
      parts.push(atStart && atEnd ? `${none} on the way` : atStart ? `${none} for the first ${n(gap.m)} ${u}`
        : atEnd ? `${none} for the last ${n(gap.m)} ${u}` : `${none} from ${u} ${n(gap.fromM)} to ${n(gap.toM)}`);
    }
    const line = parts.join(' · ');
    return line.charAt(0).toUpperCase() + line.slice(1);
  }

  /**
   * The places behind the Along line, one row each in road order (the owner, 2026-11-11: "when it says there's cafes or
   * gas stations ... i want to be able to tap for details. Ideally just show the name"). { kind, title, named, at, off,
   * lat, lon, m }: the name the map has for it (an unnamed one says so, never a made-up name), how far into the route,
   * and how far off the road. `fmt` = { long(m), short(m) } in the driver's units (units.js).
   */
  const KIND_NAME = { view: 'Viewpoint', falls: 'Waterfall', cafe: 'Café', fuel: 'Fuel station', charge: 'EV charger' };
  function places(list, fmt = null) {
    const long = fmt && fmt.long ? fmt.long : (m) => `${(m / 1000).toFixed(1)} km`;
    const short = fmt && fmt.short ? fmt.short : (m) => `${Math.round(m / 10) * 10} m`;
    return (list || []).filter((p) => p && KIND_NAME[p.kind] && finite(p.lat) && finite(p.lon)).map((p) => {
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;
      return { kind: p.kind, title: name || `${KIND_NAME[p.kind]}, no name on the map`, named: !!name, kindName: KIND_NAME[p.kind],
        at: finite(p.m) ? (p.m < 100 ? 'at the start' : `${long(p.m)} in`) : '',
        off: !finite(p.offM) ? '' : p.offM < 40 ? 'beside the road' : `${short(p.offM)} off the road`,
        lat: p.lat, lon: p.lon, m: finite(p.m) ? p.m : null };
    });
  }

  /** What tapping a pin says: "Bean · Café · 3.1 mi in" (the name first, when the map has one). */
  function placeLine(row) {
    if (!row) return '';
    return [row.named ? row.title : row.kindName, row.named ? row.kindName : '', row.at].filter(Boolean).join(' · ');
  }

  /**
   * What the co-driver says when asked for the next café or fuel stop (Siri, IDEAS V-07; the owner, 2026-11-11): the
   * first one of `kind` past `atM` along the route, by its name on the map. `list` = along(); `list` null = no route
   * (or its places not loaded). "Next fuel: Shell, in 3.2 mi." / "Next café in 1.4 mi." / "No fuel stops ahead on this route."
   */
  const ASK_NAME = { cafe: ['café', 'cafés'], fuel: ['fuel', 'fuel stops'], charge: ['charger', 'chargers'], view: ['viewpoint', 'viewpoints'], falls: ['waterfall', 'waterfalls'] };
  function nextAnswer(list, atM, kind, fmt = null) {
    const words = ASK_NAME[kind];
    if (!words) return '';
    if (!Array.isArray(list)) return `Plan a route to hear the ${words[1]} along it.`;
    const at = finite(atM) ? atM : 0, long = fmt && fmt.long ? fmt.long : (m) => `${(m / 1000).toFixed(1)} km`;
    const p = list.filter((x) => x && x.kind === kind && finite(x.m) && x.m > at - 50).sort((a, b) => a.m - b.m)[0];
    if (!p) return `No ${words[1]} ahead on this route.`;
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null, d = Math.max(0, p.m - at);
    const where = d < 150 ? 'here' : `in ${long(d)}`;
    const head = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    return name ? `Next ${words[0]}: ${name}, ${where}.` : d < 150 ? `${head} here, no name on the map.` : `Next ${words[0]} ${where}, no name on the map.`;
  }

  /**
   * Which pins the map shows so none overlap (the owner, 2026-11-04: "a pile of overlapping FUEL labels"). `pins` =
   * [{ kind, named, m, x, y, w, h }]: the pin's centre and size on screen, `m` its place along the route; `view` = { w, h }.
   * The most useful first: named viewpoints, other viewpoints, waterfalls, cafés, fuel; within a kind, spread along the route (the
   * first, then each time the one farthest from those already kept). A pin that would touch one already shown is hidden
   * (PAD px apart, PAD_SAME between two of a kind), and at most KEEP of a kind are shown on screen at once. Pins off the
   * screen don't count and stay as they are. Returns a boolean per pin, true = shown.
   * A `fixed` pin (a route note's stamp: a camera, a hazard; walkthrough 2026-11-12, two LPR stamps and a café piled up) is
   * placed first and always shown, except one on top of another of its own kind (the same word twice); the others keep off it.
   */
  const KIND_RANK = { view: 0, falls: 1, cafe: 2, fuel: 3, charge: 3 }, KEEP = { view: 6, falls: 4, cafe: 4, fuel: 4, charge: 4 }, PAD = 4, PAD_SAME = 24;
  function declutter(pins, view = null) {
    const list = pins || [], show = list.map(() => true);
    const on = list.map((p, i) => i).filter((i) => {
      const p = list[i];
      if (!p || !finite(p.x) || !finite(p.y)) return false;
      return !view || (p.x >= 0 && p.y >= 0 && p.x <= view.w && p.y <= view.h);
    });
    const order = on.filter((i) => list[i].fixed).sort((a, b) => (list[a].m || 0) - (list[b].m || 0));
    for (const kind of Object.keys(KIND_RANK).sort((a, b) => KIND_RANK[a] - KIND_RANK[b])) {
      for (const named of kind === 'view' ? [true, false] : [null]) {
        const left = on.filter((i) => !list[i].fixed && list[i].kind === kind && (named == null || !!list[i].named === named)).sort((a, b) => (list[a].m || 0) - (list[b].m || 0));
        const kept = [];
        while (left.length) {
          let k = 0;
          if (kept.length) {
            let far = -1;
            left.forEach((i, j) => { const d = Math.min(...kept.map((m) => Math.abs((list[i].m || 0) - m))); if (d > far) { far = d; k = j; } });
          }
          const [i] = left.splice(k, 1);
          kept.push(list[i].m || 0); order.push(i);
        }
      }
    }
    for (const i of on) if (!list[i].fixed && !(list[i].kind in KIND_RANK)) order.push(i);   // another kind: last, still kept off the others
    const placed = [], count = {};
    for (const i of order) {
      const p = list[i], w = finite(p.w) ? p.w : 40, h = finite(p.h) ? p.h : 16;
      const box = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - h / 2, y1: p.y + h / 2, kind: p.kind };
      const hit = placed.some((b) => { if (p.fixed && b.kind !== box.kind) return false;
        const g = b.kind === box.kind ? (p.fixed ? PAD : PAD_SAME) : PAD; return box.x0 < b.x1 + g && b.x0 < box.x1 + g && box.y0 < b.y1 + g && b.y0 < box.y1 + g; });
      if (hit || (count[p.kind] || 0) >= (KEEP[p.kind] || Infinity)) { show[i] = false; continue; }
      placed.push(box); count[p.kind] = (count[p.kind] || 0) + 1;
    }
    return show;
  }

  /**
   * IDEAS R-24: waterfalls in a box (south, west, north, east), as an Overpass query. The map's own tiles (OpenMapTiles)
   * have no waterfall, so they are asked of OpenStreetMap directly: a node or a way tagged natural=waterfall or
   * waterway=waterfall, a way by its centre.
   */
  function fallsQuery(s, w, n, e) {
    const b = [s, w, n, e].map((x) => Number(x).toFixed(5)).join(',');
    return `[out:json][timeout:20];(nwr["natural"="waterfall"](${b});nwr["waterway"="waterfall"](${b}););out center 400;`;
  }
  /** The waterfalls in an Overpass answer, as points along() takes: [{ kind: 'falls', name, lat, lon }]. One per place. */
  function fallsFrom(json) {
    const out = [], seen = new Set();
    for (const x of (json && Array.isArray(json.elements) ? json.elements : [])) {
      const lat = finite(x.lat) ? x.lat : x.center && x.center.lat, lon = finite(x.lon) ? x.lon : x.center && x.center.lon;
      if (!finite(lat) || !finite(lon)) continue;
      const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = x.tags || {}, name = typeof t.name === 'string' && t.name.trim() ? t.name.trim() : null;
      out.push({ kind: 'falls', name, lat, lon });
    }
    return out;
  }

  /**
   * The waterfalls in a box from the region's built list (GET /api/ctx/falls.json, tools/osm_ctx/region.py), as fallsFrom
   * gives them; null when the list doesn't cover the whole box (a route near or past the region's border: ask Overpass).
   */
  function fallsInRegion(doc, s, w, n, e) {
    if (!doc || !Array.isArray(doc.cells) || !Array.isArray(doc.falls) || !(doc.bundle > 0)) return null;
    if (![s, w, n, e].every(finite) || s > n || w > e) return null;
    const step = doc.bundle, have = new Set(doc.cells.map((c) => `${c[0]}_${c[1]}`));
    for (let bi = Math.floor(s / step); bi <= Math.floor(n / step); bi++) {
      for (let bj = Math.floor(w / step); bj <= Math.floor(e / step); bj++) if (!have.has(`${bi}_${bj}`)) return null;
    }
    const out = [];
    for (const f of doc.falls) {
      const [lat, lon, name] = f;
      if (finite(lat) && finite(lon) && lat >= s && lat <= n && lon >= w && lon <= e) out.push({ kind: 'falls', name: typeof name === 'string' && name ? name : null, lat, lon });
    }
    return out;
  }
  const api = { along, forCar, fuelGap, summary, places, placeLine, nextAnswer, declutter, fallsQuery, fallsFrom, fallsInRegion, NEAR_M, FUEL_WARN_M, KIND_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexScenic = api;
})(typeof window !== 'undefined' ? window : globalThis);
