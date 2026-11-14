// Route context from OpenStreetMap via Overpass (provider 'osm_overpass', ROUTE_ENGINE_CONTRACT.md): what the vector
// tiles leave out. One query per plan for the stretches of its candidates not already kept, raced against the public
// Overpass servers (web/cameras.js fetchFirst), kept per 0.05-degree tile for a week with the exact stretches it covers.
//
// Source and licence (all channels): OpenStreetMap contributors, ODbL 1.0, via the Overpass API; attribution
// "© OpenStreetMap contributors" (About > Sources, licenses.html). Update cadence: Overpass is minutely; our copy is kept
// TTL_MS (7 days). Third parties see a bounding corridor, as for cameras and the router (docs/APP_REVIEW.md).
//
// Unknown is NaN: a sample is known when its stretch was queried (now or within the TTL). Tag channels are NaN where the
// road's way doesn't carry the tag (OSM leaves most US roads untagged for lanes, surface, smoothness, hgv; maxspeed is
// patchy). Presence channels are 0 where the stretch was queried and OSM maps nothing; OSM completeness for signs, guard
// rails and calming is uneven, so the model should read 0 as "none mapped", not "none there".
//
// The road under a sample: the drivable way within MATCH_M (15 m) running within 30 deg of the route. Channels:
//   maxspeed_kph       km/h  posted limit (maxspeed, or maxspeed:forward/backward); "45 mph" -> 72.4. NaN untagged.
//   lanes              count total lanes (lanes). NaN untagged.
//   divided            0/1   a dual carriageway: the way is one-way and an opposite one-way way with the same name/ref
//                           runs parallel within 60 m (or dual_carriageway=yes). 0 for two-way roads.
//   oneway             0/1   the way is one-way.
//   surface_paved      0/1   surface paved (asphalt, concrete, chipseal, paving stones, ...) / unpaved. NaN untagged.
//   smoothness         0..7  excellent 0, good 1, intermediate 2, bad 3, very_bad 4, horrible 5, very_horrible 6,
//                           impassable 7. NaN untagged.
//   hgv                0..2  trucks: 2 designated (truck route), 1 yes, 0.5 destination/delivery/local, 0 no. NaN untagged.
//   access_level       0..2  0 public, 1 destination/customers/delivery, 2 private/no/agricultural/forestry. Untagged = 0.
//   guard_rail         0/1   a barrier=guard_rail way within 12 m alongside.
//   cycle_route        0..3  the way is in a route=bicycle relation: 1 lcn, 2 rcn, 3 ncn/icn (highest); 0 none.
//   byway              0..2  the way is in a route=road scenic relation or tagged scenic=yes: 2 National Scenic Byway /
//                           All-American Road, 1 state or other scenic byway; 0 none.
//   signals_per_km, stops_per_km, crossings_per_km, calming_per_km
//                     1/km  traffic signals / stop + give-way that apply to the route / pedestrian crossings / traffic
//                           calming on the route's ways, over a 500 m window.
//   side_roads_per_km 1/km  public roads joining the route's ways at a shared node (exact topology), over 500 m.
//   driveway_joins_per_km
//                     1/km  service=driveway (and other service) ways joining at a shared node, over 500 m.
// Points: { atM, kind, value?, label?, offM? } — 'signal', 'stop' (value 1 all-way), 'give_way', 'crossing',
//   'roundabout' (mini), 'calming' (label bump/hump/table/cushion/chicane/...), 'level_crossing', 'curve_sign' (W1-*,
//   hazard=curve*), 'animal_crossing' (label deer/horse/...), 'buggy' (horse-drawn vehicles: W11-14, hazard tags),
//   'hazard' (other hazard=* values, label), 'viewpoint' (300 m), 'historic' (300 m; label name, value tag), 'fuel'
//   (800 m; value 1 open 24/7, 0 has other hours, NaN unknown; `hours` = opening_hours, label brand/name), 'ford' (the
//   road crosses water at a node on it).
// Spans: 'roundabout', 'one_lane_bridge' (bridge with lanes=1, two-way), 'covered_bridge', 'access_private',
//   'access_destination', 'cycle_route' (label route name), 'byway' (label byway name), 'divided', 'ford' (a way through water).
(function (root) {
  'use strict';
  const G = root.ApexOsmCommon || (typeof require === 'function' ? require('./osm_common.js') : null);
  const Ctx = root.ApexRouteCtx;
  const finite = G.finite;
  const TILE = 0.05, COV = 3e-4, TTL_MS = 7 * 864e5, PREFIX = 'apex.octx.', STORE_BYTES = 1500000;
  const R_WAY = 70, R_SIGN = 40, R_POI = 300, R_FUEL = 800;
  const MATCH_M = 15, ON_M = 20, SIGN_M = 40, POI_M = 250, FUEL_M = 750;
  const MAX_VERTS = 1500, MAX_PIECES = 16, SIMPLIFY_M = 8, TIMEOUT_MS = 20000, BACKOFF_MS = 60000;
  // the camera servers, plus VK's public instance (listed on the OSM wiki), which answered when the other three were
  // refusing (2026-11-03)
  const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  const DRIVABLE = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)(_link)?$';
  const DRIVE_RE = new RegExp(DRIVABLE);
  const PUBLIC_RE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road)(_link)?$/;
  const RANK = { motorway: 1, trunk: 2, primary: 3, secondary: 4, tertiary: 5, unclassified: 6, residential: 7, living_street: 8, road: 7, service: 9 };
  const rankOf = (hw) => RANK[String(hw || '').replace('_link', '')] || 9;
  const KEEP = new Set(['highway', 'name', 'ref', 'maxspeed', 'maxspeed:forward', 'maxspeed:backward', 'lanes', 'oneway', 'surface', 'maxheight', 'maxwidth', 'maxweight',
    'smoothness', 'hgv', 'access', 'vehicle', 'motor_vehicle', 'motorcar', 'bridge', 'covered', 'junction', 'traffic_calming',
    'crossing', 'railway', 'hazard', 'animal', 'traffic_sign', 'barrier', 'tourism', 'historic', 'amenity', 'opening_hours', 'brand',
    'route', 'network', 'scenic', 'service', 'stop', 'dual_carriageway', 'memorial', 'bridge:name', 'tunnel', 'ford']);
  const CHANNELS = ['maxspeed_kph', 'lanes', 'divided', 'oneway', 'surface_paved', 'smoothness', 'hgv', 'access_level', 'guard_rail',
    'cycle_route', 'byway', 'signals_per_km', 'stops_per_km', 'crossings_per_km', 'calming_per_km', 'side_roads_per_km', 'driveway_joins_per_km',
    'maxheight_m', 'maxwidth_m', 'maxweight_t'];

  // ---- tag parsing (pure) ------------------------------------------------------------------------------------------
  /** maxspeed in km/h: "45 mph" -> 72.4, "50" -> 50, "50;40" -> 50; NaN for none/signals/walk/zones. */
  function speedKph(v) {
    if (v == null) return NaN;
    const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph|knots)?/i);
    if (!m) return NaN;
    const n = parseFloat(m[1]), u = (m[2] || '').toLowerCase();
    return u === 'mph' ? n * 1.609344 : u === 'knots' ? n * 1.852 : n;
  }
  const PAVED = new Set(['paved', 'asphalt', 'concrete', 'concrete:plates', 'concrete:lanes', 'chipseal', 'paving_stones', 'sett', 'cobblestone', 'metal', 'wood', 'bricks', 'brick']);
  const UNPAVED = new Set(['unpaved', 'gravel', 'fine_gravel', 'compacted', 'dirt', 'earth', 'ground', 'grass', 'sand', 'mud', 'pebblestone', 'rock', 'woodchips', 'grass_paver']);
  const SMOOTH = { excellent: 0, good: 1, intermediate: 2, bad: 3, very_bad: 4, horrible: 5, very_horrible: 6, impassable: 7 };
  function paved(v) { return v == null ? NaN : PAVED.has(v) ? 1 : UNPAVED.has(v) ? 0 : NaN; }
  function hgvLevel(v) { return v == null ? NaN : v === 'designated' ? 2 : v === 'yes' ? 1 : /^(destination|delivery|local|permit)$/.test(v) ? 0.5 : v === 'no' ? 0 : NaN; }
  function accessLevel(t) {
    const v = t.motorcar || t.motor_vehicle || t.vehicle || t.access;
    if (v == null) return 0;
    if (/^(private|no|agricultural|forestry|emergency|military|permit)$/.test(v)) return 2;
    if (/^(destination|customers|delivery|residents)$/.test(v)) return 1;
    return 0;
  }
  const isOneway = (t) => t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || t.junction === 'roundabout' || /^motorway(_link)?$/.test(t.highway || '') && t.oneway !== 'no';
  const lanesOf = (t) => { const m = String(t.lanes || '').match(/\d+/); return m ? +m[0] : NaN; };
  /** A posted height or width in metres: "3.5", "3.5 m", "12'6\"", "12 ft 6 in"; NaN for none, default or below_default. */
  function metresOf(v) {
    if (v == null) return NaN;
    const s = String(v).trim();
    let m = s.match(/^(\d+(?:\.\d+)?)\s*(m)?$/i);
    if (m) return +m[1];
    m = s.match(/^(\d+)\s*(?:'|ft)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i);
    return m ? +m[1] * 0.3048 + (m[2] ? +m[2] * 0.0254 : 0) : NaN;
  }
  /** A posted weight in metric tonnes: "10", "10 t", "20 st" (short tons), "6000 lbs". */
  function tonnesOf(v) {
    if (v == null) return NaN;
    const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(t|st|lbs?|kg)?$/i);
    if (!m) return NaN;
    const n = +m[1], u = (m[2] || 't').toLowerCase();
    return u === 'st' ? n * 0.90718 : u.startsWith('lb') ? n * 0.000453592 : u === 'kg' ? n / 1000 : n;
  }
  /** What a sign / hazard node warns of: { kind, label } or null. */
  function hazardOf(t) {
    const s = String(t.traffic_sign || ''), h = String(t.hazard || ''), a = String(t.animal || '');
    if (/W11-14|horse_drawn|buggy|amish/i.test(s + ' ' + h)) return { kind: 'buggy', label: 'horse-drawn vehicles' };
    if (/W11-3\b|W11-3[^0-9]/.test(s + ' ') || h === 'animal_crossing' || h === 'deer' || /deer|animal/i.test(h)) return { kind: 'animal_crossing', label: a || (/deer/i.test(h + s) || /W11-3/.test(s) ? 'deer' : 'animals') };
    if (/W1-\d|hazard=curve/i.test(s) || /^(curve|curves|dangerous_curve|bend|sharp_curve|turns)$/i.test(h) || /curve/i.test(h)) return { kind: 'curve_sign', label: s || h };
    if (h) return { kind: 'hazard', label: h };
    return null;
  }
  /** A route=road relation as a byway level: 2 national (NSB / All-American Road), 1 other scenic, 0 not scenic. */
  function bywayLevel(t) {
    const net = String(t.network || ''), name = String(t.name || '');
    if (/NSB|All-American|AAR/i.test(net) || /national scenic byway|all-american road/i.test(name)) return 2;
    if (t.scenic === 'yes' || /scenic|byway/i.test(net) || /scenic|byway/i.test(name)) return 1;
    return 0;
  }
  const CYCLE = { lcn: 1, rcn: 2, ncn: 3, icn: 3 };

  // ---- the query --------------------------------------------------------------------------------------------------
  /** Douglas-Peucker on [[lat, lon]] in metres. */
  function simplify(pts, tolM = SIMPLIFY_M) {
    if (pts.length < 3) return pts.slice();
    const P = G.projector(pts[0][0], pts[0][1]), xy = pts.map(([la, lo]) => [P.x(lo), P.y(la)]);
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1, bi = -1;
      const [ax, ay] = xy[a], [bx, by] = xy[b], vx = bx - ax, vy = by - ay, L = Math.hypot(vx, vy) || 1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((xy[i][0] - ax) * vy - (xy[i][1] - ay) * vx) / L; if (d > best) { best = d; bi = i; } }
      if (best > tolM) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  const polyArg = (piece) => piece.map(([la, lo]) => `${la.toFixed(5)},${lo.toFixed(5)}`).join(',');
  /**
   * The one query for these tiles (the 0.05° boxes the cache keeps, "i_j" keys): every drivable way in them, the nodes on
   * those ways, signs, POIs, fuel, routes. The servers get tile boxes, never the route's line (docs/APP_REVIEW.md); which
   * ways the route uses is worked out on the phone.
   */
  function query(tiles) {
    const bb = (k) => { const [i, j] = k.split('_').map(Number); return [i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE].map((v) => v.toFixed(4)).join(','); };
    const ways = tiles.map((k) => `way(${bb(k)})[highway~"${DRIVABLE}"];`).join('');
    const pois = tiles.map((k) => `nwr(${bb(k)})[~"^(tourism|historic)$"~"^(viewpoint|memorial|marker|monument|milestone|wayside_cross|wayside_shrine|ruins|fort|battlefield|mill|archaeological_site|boundary_stone|bridge|building|church|yes)$"];` +
      `nwr(${bb(k)})[amenity=fuel];`).join('');
    return `[out:json][timeout:25][maxsize:67108864];(${ways})->.r;` +
      `(node(w.r)[highway~"^(traffic_signals|stop|give_way|crossing|mini_roundabout)$"];node(w.r)[traffic_calming];node(w.r)[railway=level_crossing];node(w.r)[crossing];node(w.r)[ford];)->.on;` +
      `node(around.r:${R_SIGN})[~"^(hazard|traffic_sign)$"~"."]->.signs;way(around.r:15)[barrier=guard_rail]->.rails;(${pois})->.poi;` +
      `rel(bw.r)[route~"^(bicycle|road)$"]->.rels;` +
      `.r out body geom qt;.on out body qt;.signs out body qt;.rails out tags geom qt;.poi out tags center qt;` +
      `foreach.rels->.x{.x out tags;way.r(r.x);out ids;}`;
  }

  /** Overpass JSON -> compact elements { nodes: Map, ways: Map, rels: Map } (relations carry the way ids they hold here). */
  function parse(json) {
    const nodes = new Map(), ways = new Map(), rels = new Map();
    const tags = (t) => { const o = {}; for (const k in t || {}) if (KEEP.has(k)) o[k] = t[k]; return o; };
    let cur = null;
    for (const e of (json && json.elements) || []) {
      if (e.type === 'relation') { cur = { id: e.id, tags: tags(e.tags), ways: [] }; rels.set(e.id, cur); continue; }
      if (e.type === 'way' && !e.tags && !e.geometry && cur) { cur.ways.push(e.id); continue; }
      if (e.type === 'node') { if (finite(e.lat) && finite(e.lon)) nodes.set(e.id, { id: e.id, lat: +e.lat.toFixed(6), lon: +e.lon.toFixed(6), tags: tags(e.tags) }); continue; }
      const c = e.center || null;
      if (e.type === 'way' && Array.isArray(e.geometry)) {
        const g = e.geometry.filter((p) => p && finite(p.lat)).map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]);
        ways.set(e.id, { id: e.id, tags: tags(e.tags), g, nd: e.nodes || null });
      } else if (c && finite(c.lat)) nodes.set(`${e.type[0]}${e.id}`, { id: `${e.type[0]}${e.id}`, lat: +c.lat.toFixed(6), lon: +c.lon.toFixed(6), tags: tags(e.tags) });
    }
    return { nodes, ways, rels };
  }

  // ---- aggregation (pure) ----------------------------------------------------------------------------------------------
  /**
   * The contract's result for one corridor from parsed elements. `known[i]` (array-like of 0/1): the sample's stretch
   * was queried. Unknown samples stay NaN in every channel and carry no points.
   */
  function aggregate(c, els, known) {
    const n = c.lat.length;
    const res = G.emptyResult(n, CHANNELS, 'unavailable');
    let nKnown = 0; for (let i = 0; i < n; i++) if (known[i]) nKnown++;
    if (!n || !nKnown) { res.note = 'not queried'; return res; }
    res.status = nKnown === n ? 'ok' : 'partial';
    if (nKnown < n) res.note = `${n - nKnown} of ${n} samples not queried`;
    const idx = G.sampleIndex(c, 100), P = idx.P, ch = res.channels;
    const ll = (g) => g.map(([la, lo]) => [lo, la]);
    // match: the drivable way under each sample
    const best = new Float64Array(n).fill(Infinity), match = new Array(n).fill(null), travelDir = new Float64Array(n).fill(NaN);
    const oneways = [];
    for (const w of els.ways.values()) {
      if (!DRIVE_RE.test(w.tags.highway || '') || w.g.length < 2) continue;
      const rev = w.tags.oneway === '-1';
      const ow = isOneway(w.tags) && w.tags.junction !== 'roundabout' && !/_link$/.test(w.tags.highway);
      G.walkLine(idx, ll(w.g), 5, (px, py, dir) => {
        if (ow) oneways.push({ w, px, py, dir: rev ? dir + Math.PI : dir });
        for (const i of idx.near(px, py, MATCH_M)) {
          if (!known[i]) continue;
          const d = Math.hypot(idx.x[i] - px, idx.y[i] - py);
          if (d < best[i] && G.lineAngle(dir, idx.dir[i]) <= Math.PI / 6) { best[i] = d; match[i] = w; travelDir[i] = rev ? dir + Math.PI : dir; }
        }
      });
    }
    // relations: way id -> best cycle network / byway
    const cyc = new Map(), byw = new Map();
    for (const r of els.rels.values()) {
      if (r.tags.route === 'bicycle') { const lv = CYCLE[r.tags.network] || 1; for (const id of r.ways) if (!cyc.has(id) || cyc.get(id).lv < lv) cyc.set(id, { lv, name: r.tags.name || r.tags.ref || null }); }
      else if (r.tags.route === 'road') { const lv = bywayLevel(r.tags); if (lv) for (const id of r.ways) if (!byw.has(id) || byw.get(id).lv < lv) byw.set(id, { lv, name: r.tags.name || null }); }
    }
    // oneway partners for divided roads (grid of oneway step points)
    const owGrid = new Map(), cell = 60, gk = (x, y) => Math.floor(x / cell) * 1e6 + Math.floor(y / cell);
    for (const o of oneways) { const k = gk(o.px, o.py); let l = owGrid.get(k); if (!l) owGrid.set(k, (l = [])); l.push(o); }
    const partner = (i, w) => {
      const gx = Math.floor(idx.x[i] / cell), gy = Math.floor(idx.y[i] / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of owGrid.get((gx + a) * 1e6 + gy + b) || []) {
        if (o.w === w) continue;
        const d = Math.hypot(o.px - idx.x[i], o.py - idx.y[i]);
        if (d < 5 || d > 60) continue;
        let da = Math.abs(((o.dir - travelDir[i]) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
        if (da < Math.PI * 5 / 6) continue;   // travelling the same way: not the other carriageway
        const sameRoad = (w.tags.name && o.w.tags.name === w.tags.name) || (w.tags.ref && o.w.tags.ref === w.tags.ref) || (!w.tags.name && !w.tags.ref);
        if (sameRoad) return true;
      }
      return false;
    };
    for (let i = 0; i < n; i++) {
      if (!known[i]) continue;
      const w = match[i];
      ch.guard_rail[i] = 0;
      if (!w) continue;   // no way: the tag channels stay unknown
      const t = w.tags;
      ch.maxspeed_kph[i] = speedKph(t.maxspeed != null ? t.maxspeed : t['maxspeed:forward'] != null ? t['maxspeed:forward'] : t['maxspeed:backward']);
      const ow = isOneway(t);
      // OSM's lanes is the road's total; the model (and the router) read lanes in your direction
      ch.lanes[i] = ow ? lanesOf(t) : Math.ceil(lanesOf(t) / 2);
      ch.maxheight_m[i] = metresOf(t.maxheight); ch.maxwidth_m[i] = metresOf(t.maxwidth); ch.maxweight_t[i] = tonnesOf(t.maxweight);
      ch.oneway[i] = ow ? 1 : 0;
      ch.divided[i] = t.dual_carriageway === 'yes' ? 1 : ow && t.junction !== 'roundabout' && !/_link$/.test(t.highway) && partner(i, w) ? 1 : 0;
      ch.surface_paved[i] = paved(t.surface);
      ch.smoothness[i] = t.smoothness in SMOOTH ? SMOOTH[t.smoothness] : NaN;
      ch.hgv[i] = hgvLevel(t.hgv);
      ch.access_level[i] = accessLevel(t);
      ch.cycle_route[i] = cyc.has(w.id) ? cyc.get(w.id).lv : 0;
      ch.byway[i] = byw.has(w.id) ? byw.get(w.id).lv : t.scenic === 'yes' ? 1 : 0;
    }
    // guard rails alongside
    for (const w of els.ways.values()) {
      if (w.tags.barrier !== 'guard_rail') continue;
      G.walkLine(idx, ll(w.g), 5, (px, py, dir) => { for (const i of idx.near(px, py, 12)) if (known[i] && G.lineAngle(dir, idx.dir[i]) <= Math.PI / 6) ch.guard_rail[i] = 1; });
    }
    // nodes on the route's own ways (exact: the node is in a way matched to the route near it)
    const routeWays = new Set(match.filter(Boolean).map((w) => w.id));
    const waysOfNode = new Map();
    for (const w of els.ways.values()) if (w.nd && DRIVE_RE.test(w.tags.highway || '')) for (const id of w.nd) { let l = waysOfNode.get(id); if (!l) waysOfNode.set(id, (l = [])); if (!l.includes(w)) l.push(w); }
    const on = (nd, r = ON_M) => {
      const ws = waysOfNode.get(nd.id) || [];
      if (!ws.some((w) => routeWays.has(w.id))) return null;
      const h = idx.nearest(P.x(nd.lon), P.y(nd.lat), r);
      return h && known[h.i] ? h : null;
    };
    const counts = { signal: new Float32Array(n), stop: new Float32Array(n), crossing: new Float32Array(n), calming: new Float32Array(n), side: new Float32Array(n), drive: new Float32Array(n) };
    const pts = [];
    const push = (h, kind, extra = {}) => pts.push({ atM: Math.round(h.atM), i: h.i, kind, ...extra });
    for (const nd of els.nodes.values()) {
      const t = nd.tags;
      if (t.highway === 'traffic_signals' || t.highway === 'stop' || t.highway === 'give_way' || t.highway === 'crossing' || t.crossing || t.highway === 'mini_roundabout' || t.traffic_calming || t.railway === 'level_crossing') {
        const h = on(nd);
        if (!h) continue;
        if (t.highway === 'traffic_signals') push(h, 'signal');
        else if (t.highway === 'stop' || t.highway === 'give_way') {
          // a sign on a junction node is for the minor road unless it's all-way: count it only when the route is the
          // minor (or equal) road there, or it's on the route alone
          const ws = waysOfNode.get(nd.id) || [], mine = match[h.i], others = ws.filter((w) => !routeWays.has(w.id));
          const applies = t.stop === 'all' || !others.length || others.every((w) => rankOf(w.tags.highway) <= rankOf(mine && mine.tags.highway));
          if (applies) push(h, t.highway === 'stop' ? 'stop' : 'give_way', t.highway === 'stop' ? { value: t.stop === 'all' ? 1 : 0 } : {});
        } else if (t.highway === 'mini_roundabout') push(h, 'roundabout');
        else if (t.traffic_calming) push(h, 'calming', { label: t.traffic_calming });
        else if (t.railway === 'level_crossing') push(h, 'level_crossing');
        else if (t.highway === 'crossing' || (t.crossing && t.crossing !== 'no')) push(h, 'crossing', { label: t.crossing || undefined });
      }
      if (t.ford && t.ford !== 'no') { const h = on(nd); if (h) push(h, 'ford'); }   // the road goes through water here
      if (t.hazard || t.traffic_sign) {
        const hz = hazardOf(t);
        if (!hz) continue;
        const h = idx.nearest(P.x(nd.lon), P.y(nd.lat), SIGN_M);
        if (h && known[h.i]) push(h, hz.kind, { label: hz.label, offM: Math.round(h.d) });
      }
      if (t.tourism === 'viewpoint' || t.historic || t.amenity === 'fuel') {
        const r = t.amenity === 'fuel' ? FUEL_M : POI_M, h = idx.nearest(P.x(nd.lon), P.y(nd.lat), r);
        if (!h || !known[h.i]) continue;
        const label = t.brand || t.name || undefined;
        if (t.amenity === 'fuel') push(h, 'fuel', { label, offM: Math.round(h.d), value: t.opening_hours == null ? NaN : /24\/7/.test(t.opening_hours) ? 1 : 0, hours: t.opening_hours || undefined });
        else if (t.tourism === 'viewpoint') push(h, 'viewpoint', { label, offM: Math.round(h.d) });
        else push(h, 'historic', { label, value: t.historic, offM: Math.round(h.d) });
      }
    }
    // the same thing mapped twice (a signal per approach, both carriageways): one per 40 m
    pts.sort((a, b) => a.atM - b.atM);
    for (const p of pts) {
      const dup = res.points.some((q) => q.kind === p.kind && Math.abs(q.atM - p.atM) < 40 && q.label === p.label && p.kind !== 'fuel');
      if (dup) continue;
      const { i, ...out } = p;
      if (p.kind === 'signal') counts.signal[i]++;
      else if (p.kind === 'stop' || p.kind === 'give_way') counts.stop[i]++;
      else if (p.kind === 'crossing') counts.crossing[i]++;
      else if (p.kind === 'calming') counts.calming[i]++;
      res.points.push(out);
    }
    // side roads and driveways: other ways sharing a node of the route's way, at that node
    const joined = new Set();
    for (const w of els.ways.values()) {
      if (!routeWays.has(w.id) || !w.nd) continue;
      w.nd.forEach((id, k) => {
        const others = (waysOfNode.get(id) || []).filter((o) => !routeWays.has(o.id));
        if (!others.length || joined.has(id)) return;
        const [la, lo] = w.g[k] || [];
        if (!finite(la)) return;
        const h = idx.nearest(P.x(lo), P.y(la), MATCH_M);
        if (!h || !known[h.i] || match[h.i] !== w) return;
        joined.add(id);
        for (const o of others) {
          if (PUBLIC_RE.test(o.tags.highway || '')) counts.side[h.i]++;
          else if (o.tags.highway === 'service') counts.drive[h.i]++;
        }
      });
    }
    const K = (k) => G.perKm(counts[k], c.distM, known);
    ch.signals_per_km.set(K('signal')); ch.stops_per_km.set(K('stop')); ch.crossings_per_km.set(K('crossing'));
    ch.calming_per_km.set(K('calming')); ch.side_roads_per_km.set(K('side')); ch.driveway_joins_per_km.set(K('drive'));
    // spans
    const span = (kind, pred, label) => { for (const s of G.runs(c.distM, pred)) res.spans.push({ fromM: Math.round(s.fromM), toM: Math.round(s.toM), kind, ...(label ? { label: label(s.from) } : {}) }); };
    span('roundabout', (i) => !!(match[i] && /^(roundabout|circular)$/.test(match[i].tags.junction || '')));
    span('one_lane_bridge', (i) => !!(match[i] && match[i].tags.bridge && match[i].tags.bridge !== 'no' && lanesOf(match[i].tags) === 1 && !isOneway(match[i].tags)), (i) => match[i].tags['bridge:name'] || match[i].tags.name);
    span('covered_bridge', (i) => !!(match[i] && (match[i].tags.bridge === 'covered' || (match[i].tags.bridge && match[i].tags.covered === 'yes'))), (i) => match[i].tags['bridge:name'] || match[i].tags.name);
    span('ford', (i) => !!(match[i] && match[i].tags.ford && match[i].tags.ford !== 'no'));
    span('access_private', (i) => ch.access_level[i] === 2);
    span('access_destination', (i) => ch.access_level[i] === 1);
    span('divided', (i) => ch.divided[i] === 1);
    const relSpan = (kind, chan, map) => { for (const s of G.runs(c.distM, (i) => chan[i] > 0)) { const w = match[s.from]; const r = w && map.get(w.id); res.spans.push({ fromM: Math.round(s.fromM), toM: Math.round(s.toM), kind, value: chan[s.from], label: (r && r.name) || undefined }); } };
    relSpan('cycle_route', ch.cycle_route, cyc);
    relSpan('byway', ch.byway, byw);
    return res;
  }

  // ---- cache: per tile, the elements and the 0.0003-degree cells whose stretch was queried ------------------------------
  const tileKey = (lat, lon) => `${Math.floor(lat / TILE)}_${Math.floor(lon / TILE)}`;
  const covKey = (lat, lon) => `${Math.floor(lat / COV)}_${Math.floor(lon / COV)}`;
  function readTile(storage, k, now) {
    try { const e = JSON.parse(storage.getItem(PREFIX + k) || 'null'); return e && now - e.at < TTL_MS && Array.isArray(e.cov) ? e : null; } catch (_) { return null; }
  }
  /** Cells a piece of route covers: its line densified to 5 m. */
  function piecesCells(pieces) {
    const cells = new Map();   // tile -> Set(cov)
    for (const p of pieces) for (let k = 0; k + 1 < p.length; k++) {
      const [a1, o1] = p[k], [a2, o2] = p[k + 1];
      const L = Math.hypot((a2 - a1) * 110540, (o2 - o1) * 111320 * Math.cos(a1 * Math.PI / 180)), steps = Math.max(1, Math.ceil(L / 5));
      for (let s = 0; s <= steps; s++) {
        const la = a1 + (a2 - a1) * s / steps, lo = o1 + (o2 - o1) * s / steps, t = tileKey(la, lo);
        let set = cells.get(t); if (!set) cells.set(t, (set = new Set())); set.add(covKey(la, lo));
      }
    }
    return cells;
  }
  function storeElements(storage, cells, els, now) {
    if (!storage) return;
    const byTile = new Map();
    const put = (t, kind, e) => { let b = byTile.get(t); if (!b) byTile.set(t, (b = { n: [], w: [], r: [] })); b[kind].push(e); };
    for (const nd of els.nodes.values()) put(tileKey(nd.lat, nd.lon), 'n', nd);
    for (const w of els.ways.values()) { const ts = new Set(w.g.map(([la, lo]) => tileKey(la, lo))); for (const t of ts) put(t, 'w', w); }
    for (const r of els.rels.values()) { const ts = new Set(); for (const id of r.ways) { const w = els.ways.get(id); if (w) for (const [la, lo] of w.g) ts.add(tileKey(la, lo)); } for (const t of ts) put(t, 'r', r); }
    for (const [t, cov] of cells) {
      const old = readTile(storage, t, now);
      const merged = { n: new Map(), w: new Map(), r: new Map() };
      for (const kind of ['n', 'w', 'r']) {
        for (const e of (old && old[kind]) || []) merged[kind].set(e.id, e);
        for (const e of ((byTile.get(t) || {})[kind]) || []) merged[kind].set(e.id, e);
      }
      const entry = { at: old ? Math.min(old.at, now) : now, cov: [...new Set([...((old && old.cov) || []), ...cov])], n: [...merged.n.values()], w: [...merged.w.values()], r: [...merged.r.values()] };
      try { storage.setItem(PREFIX + t, JSON.stringify(entry)); } catch (_) { /* quota: evict below and carry on */ }
    }
    try {   // keep the newest STORE_BYTES of tiles
      const keys = [];
      for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
      let total = 0;
      const sized = keys.map((k) => { const v = storage.getItem(k) || ''; total += v.length; let at = 0; try { at = JSON.parse(v).at || 0; } catch (_) {} return [k, at, v.length]; }).sort((a, b) => a[1] - b[1]);
      for (const [k, , len] of sized) { if (total <= STORE_BYTES) break; storage.removeItem(k); total -= len; }
    } catch (_) {}
  }
  function mergeEls(into, e) {
    for (const nd of e.n || []) into.nodes.set(nd.id, nd);
    for (const w of e.w || []) into.ways.set(w.id, w);
    for (const r of e.r || []) { const have = into.rels.get(r.id); into.rels.set(r.id, have ? { ...r, ways: [...new Set([...have.ways, ...r.ways])] } : r); }
  }

  /**
   * The pieces of route still to ask for: runs of samples whose cell isn't covered, joined across short covered gaps
   * (< 300 m), simplified, within the MAX_VERTS / MAX_PIECES budget. Returns { pieces: [[[lat, lon]]], asked: [[ci, from, to]] }.
   */
  // the tiles a plan still needs (those its uncovered samples lie in), most-used first, at most MAX_TILES a plan; the rest
  // stay unknown this time and come from the cache on a later plan
  const MAX_TILES = 12;
  function planTiles(corridors, covered) {
    const count = new Map();
    corridors.forEach((c, ci) => { for (let i = 0; i < c.lat.length; i++) if (!covered[ci][i]) { const k = tileKey(c.lat[i], c.lon[i]); count.set(k, (count.get(k) || 0) + 1); } });
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TILES).map(([k]) => k);
  }
  function planPieces(corridors, covered) {
    const runs = [];
    corridors.forEach((c, ci) => {
      const n = c.lat.length;
      let s = -1, lastBad = -1;
      for (let i = 0; i <= n; i++) {
        const bad = i < n && !covered[ci][i];
        if (bad) { if (s < 0) s = i; lastBad = i; }
        if (s >= 0 && (i === n || (!bad && c.distM[i] - c.distM[lastBad] > 300))) { runs.push([ci, Math.max(0, s - 1), Math.min(n - 1, lastBad + 1)]); s = -1; }
      }
    });
    const pieces = [], asked = [];
    let verts = 0;
    for (const [ci, a, b] of runs) {
      const c = corridors[ci], pts = [];
      for (let i = a; i <= b; i++) pts.push([c.lat[i], c.lon[i]]);
      const s = simplify(pts);
      if (pieces.length >= MAX_PIECES || verts + s.length > MAX_VERTS) continue;
      verts += s.length; pieces.push(s); asked.push([ci, a, b]);
    }
    return { pieces, asked };
  }

  let downUntil = 0;
  const stubOf = (opts) => opts.stub || (root.ApexRouteCtxStub && root.ApexRouteCtxStub.osm_overpass) || null;
  /** Race the servers for one query; null when none answered within the budget. */
  async function ask(q, opts) {
    const stub = stubOf(opts);
    if (stub) return stub.overpass || null;
    const now = Date.now();
    if (now < downUntil) return null;
    const raw = opts.fetchFn || (root.fetch && root.fetch.bind(root));
    const Cam = root.ApexCameras || (typeof require === 'function' ? require('../cameras.js') : null);
    if (!raw || !Cam) return null;
    const fetchFn = (url, o) => {   // tie each request to the plan's signal as well as the race's own
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const stop = () => ctl && ctl.abort();
      if (o.signal) o.signal.addEventListener('abort', stop, { once: true });
      if (opts.signal) { if (opts.signal.aborted) stop(); else opts.signal.addEventListener('abort', stop, { once: true }); }
      return raw(url, { ...o, signal: ctl ? ctl.signal : o.signal });
    };
    const timeout = Math.max(1000, Math.min(TIMEOUT_MS, finite(opts.budgetMs) ? opts.budgetMs : TIMEOUT_MS));
    const json = await Cam.fetchFirst(fetchFn, 'data=' + encodeURIComponent(q), opts.servers || SERVERS, timeout);
    if (!json || (json.remark && /error|timed out/i.test(json.remark))) { if (!(opts.signal && opts.signal.aborted)) downUntil = Date.now() + BACKOFF_MS; return null; }
    return json;
  }

  // one query per set of tiles at a time, shared by the plans that need it; stored when it lands, however late
  const WAIT_MS = 0, inflight = new Map();
  function background(want, opts, storage, now) {
    const key = want.join(','), stub = !!stubOf(opts);   // a stub answers at once and is never shared
    if (stub || !inflight.has(key)) {
      const p = ask(query(want), { ...opts, signal: undefined, budgetMs: TIMEOUT_MS }).then((json) => {
        if (!json) return null;
        const fresh = parse(json);
        storeElements(storage, new Map(want.map((k) => [k, new Set(['*'])])), fresh, now);   // covered: the whole of each asked tile
        return fresh;
      }).catch(() => null);
      if (stub) return p;
      inflight.set(key, p.finally(() => inflight.delete(key)));
    }
    return inflight.get(key);
  }
  const wait = (ms, signal) => new Promise((resolve) => {
    if (!(ms > 0)) { setTimeout(() => resolve(null), 0); return; }
    const t = setTimeout(() => resolve(null), ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(null); }, { once: true });
  });

  const RELAY = '/api/ctx/osm';
  /** The relay's answers for these tiles, as they land, until the plan's signal: Map tile -> parsed elements. */
  async function relayTiles(want, opts) {
    const got = new Map();
    const box = (k) => { const [i, j] = k.split('_').map(Number); return [i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE].map((v) => v.toFixed(4)).join(','); };
    const all = Promise.all(want.map(async (k) => {
      try { const j = await opts.apiGet(`${RELAY}?bbox=${box(k)}`); if (j && Array.isArray(j.elements)) got.set(k, parse(j)); } catch (_) { /* this tile stays unknown */ }
    }));
    const sig = opts.signal;
    await (sig ? Promise.race([all, new Promise((r) => { if (sig.aborted) r(); else sig.addEventListener('abort', r, { once: true }); })]) : all);
    return new Map(got);
  }

  async function fetchCtx(corridors, opts = {}) {
    const out = {};
    const storage = opts.storage !== undefined ? opts.storage : (() => { try { return root.localStorage || null; } catch (_) { return null; } })();
    const now = finite(opts.now) ? opts.now : Date.now();
    try {
      const els = { nodes: new Map(), ways: new Map(), rels: new Map() };
      const tiles = new Map(), read = new Set();
      // a kept tile's elements, and its neighbours' too: a way or POI near a tile edge is kept in the tile it lies in
      const load = (t) => {
        if (tiles.has(t)) return tiles.get(t);
        const [a, b] = t.split('_').map(Number);
        for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) {
          const k = `${a + da}_${b + db}`;
          if (read.has(k)) continue;
          read.add(k);
          const e = storage ? readTile(storage, k, now) : null;
          if (e) mergeEls(els, e);
          if (k === t) tiles.set(t, e ? { e, cov: new Set(e.cov) } : null);
        }
        if (!tiles.has(t)) { const e = storage ? readTile(storage, t, now) : null; tiles.set(t, e ? { e, cov: new Set(e.cov) } : null); }
        return tiles.get(t);
      };
      const covered = corridors.map((c) => {
        const k = new Uint8Array(c.lat.length);
        for (let i = 0; i < c.lat.length; i++) {
          const e = load(tileKey(c.lat[i], c.lon[i]));
          k[i] = e && (e.cov.has('*') || e.cov.has(covKey(c.lat[i], c.lon[i]))) ? 1 : 0;
        }
        return k;
      });
      let want = planTiles(corridors, covered);
      // our Worker's relay first (backend/src/osm_relay.ts, GET /api/ctx/osm?bbox= one tile box): Overpass server-side, where
      // CORS doesn't matter; on the plan's clock. Since 2026-11-14 it answers from tiles built weekly from the Geofabrik
      // extracts (tools/osm_ctx/build.py) and asks Overpass only for a border tile. A tile it doesn't have (504, or any
      // failure) goes the way it went before the relay: the phone's own query, off the plan's clock, kept for the next plan.
      // only while the server's flag osm_relay is on (on since 2026-11-14, backend/src/flags.ts); off, as before the relay
      const viaRelay = opts.osmRelay === true && typeof opts.apiGet === 'function' && !stubOf(opts);
      if (want.length && viaRelay) {
        const got = await relayTiles(want, opts);
        if (got.size) {
          const fresh = { nodes: new Map(), ways: new Map(), rels: new Map() };
          for (const p of got.values()) for (const m of ['nodes', 'ways', 'rels']) for (const [k, v] of p[m]) { fresh[m].set(k, v); els[m].set(k, v); }
          storeElements(storage, new Map([...got.keys()].map((k) => [k, new Set(['*'])])), fresh, now);
          corridors.forEach((c, ci) => { for (let i = 0; i < c.lat.length; i++) if (got.has(tileKey(c.lat[i], c.lon[i]))) covered[ci][i] = 1; });
        }
        want = want.filter((k) => !got.has(k));
      }
      if (want.length) {
        // off the critical path: the query runs on its own clock (live, the public servers answered 502 or 504 on every
        // run), the plan waits WAIT_MS (0: not at all) and ranks with what the cache has; the answer is kept for the next plan
        const fresh = await Promise.race([background(want, opts, storage, now), wait(stubOf(opts) ? 0 : WAIT_MS, opts.signal)]);
        if (fresh) {
          for (const m of ['nodes', 'ways', 'rels']) for (const [k, v] of fresh[m]) els[m].set(k, v);
          const asked = new Set(want);
          corridors.forEach((c, ci) => { for (let i = 0; i < c.lat.length; i++) if (asked.has(tileKey(c.lat[i], c.lon[i]))) covered[ci][i] = 1; });
        }
      }
      corridors.forEach((c, ci) => {
        try { out[c.id] = aggregate(c, els, covered[ci]); } catch (e) { out[c.id] = G.emptyResult(c.lat.length, CHANNELS, 'unavailable', String(e && e.message || e)); }
      });
    } catch (e) {
      for (const c of corridors) out[c.id] = G.emptyResult(c.lat.length, CHANNELS, 'unavailable', String(e && e.message || e));
    }
    return out;
  }

  const provider = { id: 'osm_overpass', version: 1, channels: CHANNELS, needs: { network: true }, budgetMs: 15000, fetch: fetchCtx };
  const api = { provider, WAIT_MS, RELAY, relayTiles, CHANNELS, SERVERS, KEEP, TILE, COV, MAX_TILES, speedKph, metresOf, tonnesOf, planTiles, paved, hgvLevel, accessLevel, hazardOf, bywayLevel, simplify, query, parse,
    aggregate, planPieces, piecesCells, tileKey, covKey, readTile, storeElements, _reset: () => { downUntil = 0; inflight.clear(); } };
  root.ApexOsmOverpass = api;
  if (Ctx && Ctx.register) Ctx.register(provider);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
