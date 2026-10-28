// ApexStages — stage discovery + chaining for loops (docs/ROAD_INTELLIGENCE.md §7.2).
// 1. Decode OpenFreeMap vector tiles around the start (the same OSM data the map draws).
// 2. Join clipped road pieces into continuous strokes.
// 3. Score every stroke with the parity-tested core (curvature + corner detection) and keep
//    its best 2–10 km window: the stretch worth driving.
// 4. Pick the set of stages whose loop (stages + connectors) best fits the target length,
//    ordered around the start, and route it through Valhalla with shaping points so the
//    route actually drives each stage.
// Geometry only: these are map-derived scores, labelled as such, never measured road feel.
(function (root) {
  'use strict';
  const Core = root.ApexCore;
  const Loading = root.ApexRouteLoading;
  const TILEJSON = 'https://tiles.openfreemap.org/planet';
  const ROAD_CLASSES = new Set(['primary', 'secondary', 'tertiary', 'minor']);

  // ---- minimal Mapbox Vector Tile decoder (protobuf) ------------------------
  function reader(buf) {
    let pos = 0;
    const varint = () => {
      let r = 0, s = 0, b;
      do { b = buf[pos++]; r += (b & 0x7f) * Math.pow(2, s); s += 7; } while (b >= 0x80);
      return r;
    };
    return {
      get pos() { return pos; }, set pos(v) { pos = v; }, varint,
      skip(wire) { if (wire === 0) varint(); else if (wire === 1) pos += 8; else if (wire === 2) pos += varint(); else if (wire === 5) pos += 4; },
      bytes() { const n = varint(); const out = buf.subarray(pos, pos + n); pos += n; return out; },
    };
  }
  const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);
  const utf8 = new TextDecoder();
  function decodeValue(b) {
    const r = reader(b);
    while (r.pos < b.length) {
      const tag = r.varint(), f = tag >> 3, w = tag & 7;
      if (f === 1) return utf8.decode(r.bytes());
      if (f === 4 || f === 5) return r.varint();
      if (f === 6) return zz(r.varint());
      if (f === 7) return !!r.varint();
      if (f === 2) { const v = new DataView(b.buffer, b.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; return v; }
      if (f === 3) { const v = new DataView(b.buffer, b.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; return v; }
      r.skip(w);
    }
    return null;
  }
  function packed(b) { const r = reader(b), out = []; while (r.pos < b.length) out.push(r.varint()); return out; }
  // Returns [{props, lines: [[[lon, lat], ...]]}] for LineString features of one layer.
  function decodeLayer(buf, layerName, z, x, y, geomType = 2) {   // 2 lines, 1 points
    const top = reader(buf), out = [];
    while (top.pos < buf.length) {
      const tag = top.varint();
      if ((tag >> 3) !== 3) { top.skip(tag & 7); continue; }
      const lb = top.bytes(), lr = reader(lb);
      let name = '', extent = 4096;
      const keys = [], values = [], feats = [];
      while (lr.pos < lb.length) {
        const t = lr.varint(), f = t >> 3;
        if (f === 1) { name = utf8.decode(lr.bytes()); if (name !== layerName) break; }   // another layer: skip its keys and values
        else if (f === 2) feats.push(lr.bytes());
        else if (f === 3) keys.push(utf8.decode(lr.bytes()));
        else if (f === 4) values.push(decodeValue(lr.bytes()));
        else if (f === 5) extent = lr.varint();
        else lr.skip(t & 7);
      }
      if (name !== layerName) continue;
      const n2 = Math.pow(2, z);
      const toLonLat = (px, py) => {
        const lon = ((x + px / extent) / n2) * 360 - 180;
        const m = Math.PI * (1 - 2 * (y + py / extent) / n2);
        return [lon, (180 / Math.PI) * Math.atan(Math.sinh(m))];
      };
      for (const fb of feats) {
        const fr = reader(fb);
        let type = 0, tags = [], geom = [];
        while (fr.pos < fb.length) {
          const t = fr.varint(), f = t >> 3;
          if (f === 2) tags = packed(fr.bytes());
          else if (f === 3) type = fr.varint();
          else if (f === 4) geom = packed(fr.bytes());
          else fr.skip(t & 7);
        }
        if (type !== geomType) continue;
        const props = {};
        for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
        const lines = [];
        let cx = 0, cy = 0, i = 0, cur = null;
        while (i < geom.length) {
          const cmd = geom[i] & 7, count = geom[i] >> 3; i++;
          for (let k = 0; k < count; k++) {
            if (cmd === 7) continue;
            cx += zz(geom[i++]); cy += zz(geom[i++]);
            if (cmd === 1) { cur = [toLonLat(cx, cy)]; lines.push(cur); } else cur.push(toLonLat(cx, cy));
          }
        }
        out.push({ props, lines: geomType === 1 ? lines : lines.filter(l => l.length > 1) });
      }
    }
    return out;
  }

  // ---- roads around a point ---------------------------------------------------
  const tileOf = (lat, lon, z) => {
    const n = Math.pow(2, z), r = lat * Math.PI / 180;
    return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
  };
  let tileUrl = null;
  const MAX_TILES = 64;
  async function roadPieces(c, radiusKm, onProgress, withNames = false) {
    if (!tileUrl) tileUrl = (await Loading.json(TILEJSON)).tiles[0];
    const z = 13, jobs = [];
    // At most 64 tiles: a 14 km radius needs 81 at 39°N, so shrink the area to fit instead of giving up (which
    // used to drop every 45 mi loop to the circle fallback).
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon) || !(radiusKm > 0)) throw new Error('bad search area');
    for (let r = radiusKm; r > 0 && (jobs.length === 0 || jobs.length > MAX_TILES); r -= 0.5) {
      const dLat = r / 110.54, dLon = r / (111.32 * Math.cos(c.lat * Math.PI / 180));
      const [x0, y0] = tileOf(c.lat + dLat, c.lon - dLon, z), [x1, y1] = tileOf(c.lat - dLat, c.lon + dLon, z);
      jobs.length = 0;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
    }
    if (!jobs.length || jobs.length > MAX_TILES) jobs.splice(0, jobs.length, tileOf(c.lat, c.lon, z));
    let done = 0, failed = 0;
    const pieces = [];
    pieces.names = [];   // named road lines (transportation_name), only when asked (naming stages)
    await Promise.all(jobs.map(async ([x, y]) => {
      try {
        const buf = new Uint8Array(await Loading.arrayBuffer(tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y)));
        for (const f of decodeLayer(buf, 'transportation', z, x, y)) {
          const p = f.props;
          if (!ROAD_CLASSES.has(p.class) || p.ramp === 1 || p.service || p.access === 'no' || p.surface === 'unpaved') continue;
          for (const l of f.lines) pieces.push({ cls: p.class, pts: l });
        }
        if (withNames) for (const f of decodeLayer(buf, 'transportation_name', z, x, y)) pieces.names.push({ properties: f.props, geometry: { type: 'MultiLineString', coordinates: f.lines } });
      } catch (_) { failed++; /* a missing tile just means fewer candidates */ }
      onProgress && onProgress(++done, jobs.length);
    }));
    // No tile at all is no data, not "no roads here": say so instead of returning an empty area.
    if (failed === jobs.length) throw new Error('no map tiles');
    return pieces;
  }

  // ---- towns along a route (avoid towns, R-15) ---------------------------------------
  // City, town and village points from the same tiles, at z11 (about 16 km a tile here): z9 and z10 thin villages out
  // in busy country (northern NJ: 11 of 79 at z9; Heidelberg: 62 of 73 at z10; all of them at z11). Tiles are those
  // within 4 km of any of `points` (the routes, sampled), at most 80; more is no data, not "no towns". Kept for the session.
  const placeTiles = new Map();
  const PLACE_Z = 11, PLACE_PAD_KM = 4, PLACE_MAX_TILES = 80;
  async function places(points) {
    if (!tileUrl) tileUrl = (await Loading.json(TILEJSON)).tiles[0];
    const want = new Set();
    for (const p of points || []) {
      const dLat = PLACE_PAD_KM / 110.54, dLon = PLACE_PAD_KM / (111.32 * Math.cos(p.lat * Math.PI / 180));
      for (const a of [-dLat, 0, dLat]) for (const b of [-dLon, 0, dLon]) want.add(tileOf(p.lat + a, p.lon + b, PLACE_Z).join('/'));
    }
    if (!want.size || want.size > PLACE_MAX_TILES) throw new Error('area too big');
    await Promise.all([...want].filter(k => !placeTiles.has(k)).map(async (key) => {
      const [x, y] = key.split('/').map(Number);
      const buf = new Uint8Array(await Loading.arrayBuffer(tileUrl.replace('{z}', PLACE_Z).replace('{x}', x).replace('{y}', y)));
      placeTiles.set(key, decodeLayer(buf, 'place', PLACE_Z, x, y, 1).filter(f => ['city', 'town', 'village'].includes(f.props.class))
        .flatMap(f => f.lines.map(([[lon, lat]]) => ({ lat, lon, cls: f.props.class, name: f.props.name || null }))));
    }));
    return [...want].flatMap(k => placeTiles.get(k));
  }

  // Viewpoints, cafés and fuel along a route (IDEAS R-24, R-23): the 'poi' layer of the same tiles at z14, where they are
  // (lower zooms drop most). Tiles under `points` (the route sampled every ~1 km) and their neighbours when a point is near
  // an edge; at most POI_MAX_TILES (more is no data, not "nothing there"). Kept for the session.
  const poiTiles = new Map();
  const POI_Z = 14, POI_PAD_KM = 0.4, POI_MAX_TILES = 160;
  const POI_KIND = (p) => (p.subclass === 'viewpoint' ? 'view' : p.class === 'cafe' ? 'cafe' : p.class === 'fuel' ? 'fuel' : null);
  async function pois(points) {
    if (!tileUrl) tileUrl = (await Loading.json(TILEJSON)).tiles[0];
    const want = new Set();
    for (const p of points || []) {
      const dLat = POI_PAD_KM / 110.54, dLon = POI_PAD_KM / (111.32 * Math.cos(p.lat * Math.PI / 180));
      for (const a of [-dLat, 0, dLat]) for (const b of [-dLon, 0, dLon]) want.add(tileOf(p.lat + a, p.lon + b, POI_Z).join('/'));
    }
    if (!want.size || want.size > POI_MAX_TILES) throw new Error('area too big');
    await Promise.all([...want].filter(k => !poiTiles.has(k)).map(async (key) => {
      const [x, y] = key.split('/').map(Number);
      const buf = new Uint8Array(await Loading.arrayBuffer(tileUrl.replace('{z}', POI_Z).replace('{x}', x).replace('{y}', y)));
      poiTiles.set(key, decodeLayer(buf, 'poi', POI_Z, x, y, 1).map(f => ({ kind: POI_KIND(f.props), name: f.props.name || null, pt: f.lines[0] && f.lines[0][0] }))
        .filter(f => f.kind && f.pt).map(f => ({ kind: f.kind, name: f.name, lat: f.pt[1], lon: f.pt[0] })));
    }));
    return [...want].flatMap(k => poiTiles.get(k) || []);
  }

  // Join pieces end to end into strokes, continuing straight-ish through each node (≤ 50°).
  const cellKey = (lon, lat) => `${Math.round(lon * 4000)},${Math.round(lat * 4000)}`;   // ~25 m cells
  function strokes(pieces) {
    const key = (p) => cellKey(p[0], p[1]);
    const ends = new Map();
    pieces.forEach((pc, i) => {
      pc.used = false;
      for (const [end, p] of [[0, pc.pts[0]], [1, pc.pts[pc.pts.length - 1]]]) {
        const k = key(p);
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k).push({ i, end });
      }
    });
    const heading = (a, b) => Math.atan2((b[1] - a[1]), (b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180));
    const extend = (line) => {
      for (;;) {
        const n = line.length, tip = line[n - 1], h = heading(line[Math.max(0, n - 4)], tip);
        let best = null, bestTurn = 50 * Math.PI / 180;
        for (const c of ends.get(key(tip)) || []) {
          const pc = pieces[c.i];
          if (pc.used) continue;
          const pts = c.end === 0 ? pc.pts : pc.pts.slice().reverse();
          const turn = Math.abs(Math.atan2(Math.sin(heading(pts[0], pts[Math.min(3, pts.length - 1)]) - h), Math.cos(heading(pts[0], pts[Math.min(3, pts.length - 1)]) - h)));
          if (turn < bestTurn) { bestTurn = turn; best = { pc, pts }; }
        }
        if (!best) return;
        best.pc.used = true;
        members.add(best.pc);
        line.push(...best.pts.slice(1));
      }
    };
    const out = [];
    let members;
    for (const pc of pieces) {
      if (pc.used) continue;
      pc.used = true;
      members = new Set([pc]);
      const fwd = pc.pts.slice();
      extend(fwd);
      const back = fwd.slice().reverse();
      extend(back);
      out.push({ cls: pc.cls, pts: back, members });
    }
    return { strokes: out, ends };
  }

  // ---- scoring: the best window of each stroke ----------------------------------
  // Per 100 m bin: credit for good corners (severity 2–5), less for hairpins and 6s, a cost
  // per bin so straights pull the window down. Max-sum window between 2 and 10 km.
  const BIN = 20;   // 20 x 5 m = 100 m
  // Junctions: cells along the stroke where a road that is not part of it ends (side roads,
  // driveways onto subdivision streets). Country roads have few; housing estates many.
  function junctionBins(stroke, rs, ends, pieces) {
    const nb = Math.floor(rs.lat.length / BIN), out = new Float64Array(nb), seen = new Set();
    for (let i = 0; i < rs.lat.length; i++) {
      const k = cellKey(rs.lon[i], rs.lat[i]);
      if (seen.has(k)) continue;
      seen.add(k);
      if ((ends.get(k) || []).some(e => !stroke.members.has(pieces[e.i]))) out[Math.min(nb - 1, Math.floor(i / BIN))] += 1;
    }
    return out;
  }
  function bestWindow(stroke, ends, pieces) {
    const lat = stroke.pts.map(p => p[1]), lon = stroke.pts.map(p => p[0]);
    const rs = Core.resamplePolyline(lat, lon, 5);
    const n = rs.lat.length;
    if (n < 400) return null;   // < 2 km
    const { kappa, ds } = Core.computeCurvature(rs.lat, rs.lon);
    const corners = Core.detectCorners(kappa, ds);
    const nb = Math.floor(n / BIN), gain = new Float64Array(nb);
    for (const c of corners) {
      const b = Math.min(nb - 1, Math.floor(c.apex / BIN));
      gain[b] += c.severity === 'HP' ? 0.6 : c.severity >= 2 && c.severity <= 5 ? 1.0 : c.severity === 1 ? 0.5 : 0.3;
    }
    const junc = ends ? junctionBins(stroke, rs, ends, pieces) : new Float64Array(nb);
    for (let b = 0; b < nb; b++) gain[b] -= 0.35 * junc[b];   // each junction costs a third of a corner
    const COST = 0.07;   // ~0.7 good corners per km to break even
    let best = null;
    for (let a = 0; a < nb; a++) {
      let sum = 0;
      for (let b = a; b < nb && b - a < 100; b++) {
        sum += gain[b] - COST;
        if (b - a + 1 >= 20 && (!best || sum > best.sum)) best = { sum, a, b };
      }
    }
    if (!best || best.sum <= 0) return null;
    const lo = best.a * BIN, hi = Math.min(n - 1, (best.b + 1) * BIN);
    const inside = corners.filter(c => c.apex >= lo && c.apex <= hi);
    const km = (hi - lo) * 5 / 1000;
    // A stage has to go somewhere: windows that curl back on themselves are park, campus or
    // cemetery loops (and give Valhalla nothing to route through).
    const chord = kmBetween({ lat: rs.lat[lo], lon: rs.lon[lo] }, { lat: rs.lat[hi], lon: rs.lon[hi] });
    if (chord < 0.35 * km) return null;
    return {
      cls: stroke.cls, lat: rs.lat.slice(lo, hi + 1), lon: rs.lon.slice(lo, hi + 1), km,
      corners: inside.length, good: inside.filter(c => c.severity >= 2 && c.severity <= 5).length,
      junctionsPerKm: junc.slice(best.a, best.b + 1).reduce((x, y) => x + y, 0) / km,
      score: best.sum,
    };
  }

  // ---- highlights: user-added scenic points, rated 1-5, that pull a loop toward the stages that pass them ------------
  // A stage within HIGHLIGHT_NEAR_KM of a highlight gains up to +HIGHLIGHT_MAX_POINTS "good corner equivalents" per 5-star
  // highlight, scaled by the owner's strength setting (0 = off, 1 = normal, 2 = strong), and capped per stage so a viewpoint
  // can tip the choice between two good roads but can never make a dull road beat a great one.
  const HIGHLIGHT_NEAR_KM = 0.3, HIGHLIGHT_MAX_POINTS = 3, HIGHLIGHT_STAGE_CAP = 6;
  function applyHighlights(stages, highlights, strength = 1) {
    if (!highlights || !highlights.length || !(strength > 0)) return stages;
    for (const s of stages) {
      let bonus = 0; const near = [];
      for (const h of highlights) {
        const liking = Math.max(0, ((h.rating ?? 3) - 2.5) / 2.5);        // 2.5 stars or less: no pull, never a push away
        if (!liking) continue;
        let d = Infinity;
        for (let i = 0; i < s.lat.length; i += 4) d = Math.min(d, kmBetween({ lat: h.lat, lon: h.lon }, { lat: s.lat[i], lon: s.lon[i] }));
        if (d <= HIGHLIGHT_NEAR_KM) { bonus += liking * HIGHLIGHT_MAX_POINTS * strength; near.push(h.name || 'highlight'); }
      }
      if (bonus) { s.bonus = Math.min(HIGHLIGHT_STAGE_CAP * strength, bonus); s.score += s.bonus; s.highlights = near; }
    }
    return stages.sort((a, b) => b.score - a.score);
  }

  async function discover(c, radiusKm, onProgress, opts = {}) {
    const pieces = await roadPieces(c, radiusKm, (d, n) => onProgress && onProgress('tiles', d / n), !!opts.names);
    onProgress && onProgress('scoring', 0);
    const { strokes: all, ends } = strokes(pieces);
    const stages = [];
    let yieldedAt = performance.now();
    for (let index = 0; index < all.length; index++) {
      if (performance.now() - yieldedAt >= 8) {
        onProgress && onProgress('scoring', index / all.length);
        await Loading.yieldToUI();
        yieldedAt = performance.now();
      }
      const stage = bestWindow(all[index], ends, pieces);
      if (stage) stages.push(stage);
    }
    onProgress && onProgress('scoring', 1);
    stages.sort((a, b) => b.score - a.score);
    const out = applyHighlights(stages, opts.highlights, opts.strength);
    // opts.names: which stages the caller will show (a filter); the best 40 of them get names.
    if (opts.names) nameStages(out.filter(opts.names).slice(0, 40), pieces.names);
    return out;
  }
  // Each stage's road name from the tiles' own name lines: the name most of 5 points along it sit on (2 of 5 at
  // least), else none. Unknown stays unknown: an unnamed stage has no `name`.
  const boxOf = (lines) => {
    const b = [180, 90, -180, -90];
    for (const l of lines) for (const [x, y] of l) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    return b;
  };
  function nameStages(stages, names) {
    const Names = root.ApexRoadNames;
    if (!Names || !names || !names.length) return stages;
    for (const s of stages) {
      let w = 180, e = -180, so = 90, n = -90;
      for (let i = 0; i < s.lat.length; i += 10) { w = Math.min(w, s.lon[i]); e = Math.max(e, s.lon[i]); so = Math.min(so, s.lat[i]); n = Math.max(n, s.lat[i]); }
      const pad = 0.001;
      const near = names.filter(f => {
        const b = f.bbox || (f.bbox = boxOf(f.geometry.coordinates));
        return b[0] <= e + pad && b[2] >= w - pad && b[1] <= n + pad && b[3] >= so - pad;
      });
      const votes = new Map();
      for (let k = 1; k <= 5; k++) {
        const i = Math.round(k / 6 * (s.lat.length - 1)), name = Names.nearestRoadName(near, s.lat[i], s.lon[i], 30);
        if (name) votes.set(name, (votes.get(name) || 0) + 1);
      }
      let best = null, most = 1;
      for (const [name, v] of votes) if (v > most) { most = v; best = name; }
      if (best) s.name = best;
    }
    return stages;
  }

  // ---- chaining ---------------------------------------------------------------
  const kmBetween = (a, b) => {
    const dy = (a.lat - b.lat) * 110.54, dx = (a.lon - b.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180);
    return Math.hypot(dx, dy);
  };
  const ends = (s) => ({ a: { lat: s.lat[0], lon: s.lon[0] }, b: { lat: s.lat[s.lat.length - 1], lon: s.lon[s.lon.length - 1] } });
  // Plans: subsets of the top stages (1–3), ordered by bearing around the start, each driven
  // in the direction that continues the loop. Estimated length = stages + 1.6 x crow-fly
  // connectors. Ranked by stage score, penalised by length error and connector share.
  function plans(start, stages, targetKm, count = 3) {
    const top = stages.slice(0, 14);
    const bearing = (p) => Math.atan2(p.lon - start.lon, p.lat - start.lat);
    const out = [];
    const consider = (set) => {
      for (const dir of [1, -1]) {
        const order = set.slice().sort((s, t) => dir * (bearing(mid(s)) - bearing(mid(t))));
        let pos = start, connector = 0, stageKm = 0, score = 0;
        const legs = [];
        for (const s of order) {
          const e = ends(s), fwd = kmBetween(pos, e.a) <= kmBetween(pos, e.b);
          const entry = fwd ? e.a : e.b, exit = fwd ? e.b : e.a;
          connector += kmBetween(pos, entry) * 1.6;
          stageKm += s.km; score += s.score;
          legs.push({ s, fwd });
          pos = exit;
        }
        connector += kmBetween(pos, start) * 1.6;
        const total = stageKm + connector, err = Math.abs(total - targetKm) / targetKm;
        if (err > 0.45) continue;
        out.push({ legs, total, stageKm, value: score * (1 - err) - connector * 0.08, share: stageKm / total });
      }
    };
    const mid = (s) => ({ lat: s.lat[s.lat.length >> 1], lon: s.lon[s.lon.length >> 1] });
    for (let i = 0; i < top.length; i++) {
      consider([top[i]]);
      for (let j = i + 1; j < top.length; j++) {
        if (overlap(top[i], top[j])) continue;
        consider([top[i], top[j]]);
        for (let k = j + 1; k < top.length; k++) {
          if (overlap(top[i], top[k]) || overlap(top[j], top[k])) continue;
          consider([top[i], top[j], top[k]]);
          for (let m = k + 1; m < top.length; m++)
            if (!overlap(top[i], top[m]) && !overlap(top[j], top[m]) && !overlap(top[k], top[m])) consider([top[i], top[j], top[k], top[m]]);
        }
      }
    }
    out.sort((a, b) => b.value - a.value);
    // keep plans that don't reuse the same lead stage, for variety
    const picked = [], seen = new Set();
    for (const p of out) { const k = p.legs[0].s; if (seen.has(k)) continue; seen.add(k); picked.push(p); if (picked.length === count) break; }
    return picked;
  }
  function overlap(s, t) {   // parallel duplicates (dual carriageways, the same road twice)
    const ms = { lat: s.lat[s.lat.length >> 1], lon: s.lon[s.lon.length >> 1] };
    for (let i = 0; i < t.lat.length; i += 40) if (kmBetween(ms, { lat: t.lat[i], lon: t.lon[i] }) < 0.3) return true;
    return false;
  }
  // Valhalla locations: start, each stage's entry and exit (plus midpoints on the longest
  // stages while the budget lasts), start. The public server caps a route at 10 locations;
  // an on-device Valhalla has no such cap and can take denser shaping.
  function waypoints(start, plan, maxLocations = 10) {
    const legs = plan.legs.map(({ s, fwd }) => {
      const lat = fwd ? s.lat : s.lat.slice().reverse(), lon = fwd ? s.lon : s.lon.slice().reverse();
      return { lat, lon, km: s.km, mids: 0 };
    });
    let spare = maxLocations - 2 - 2 * legs.length;
    for (const leg of legs.slice().sort((a, b) => b.km - a.km)) {
      if (spare <= 0) break;
      const want = Math.min(spare, Math.max(1, Math.floor(leg.km / 2.5)));
      leg.mids = want; spare -= want;
    }
    const pts = [start];
    for (const leg of legs) {
      const n = leg.lat.length - 1;
      for (let k = 0; k <= leg.mids + 1; k++) {
        const i = Math.round((k / (leg.mids + 1)) * n);
        pts.push({ lat: leg.lat[i], lon: leg.lon[i], shaping: true });
      }
    }
    pts.push(start);
    return pts;
  }

  root.ApexStages = { decodeLayer, discover, nameStages, places, pois, applyHighlights, plans, waypoints, strokes, bestWindow, roadPieces };
})(typeof window !== 'undefined' ? window : globalThis);
