// Route context from the OpenFreeMap vector tiles the app already draws (provider 'osm_tiles', ROUTE_ENGINE_CONTRACT.md).
// What is beside each 25 m sample of a candidate route: land use, buildings, addresses, businesses, schools, churches,
// viewpoints, towns, streams the road follows, rail crossings, bridges and tunnels, the road's class as the map has it,
// and how many side streets and driveways join it. The tiles are decoded with ApexStages.decodeLayer (web/stages.js, the
// same decoder loops and sight lines use), at z14 where every feature is present.
//
// Source and licence (all channels): OpenStreetMap contributors via OpenFreeMap (OpenMapTiles schema), ODbL 1.0;
// attribution "© OpenStreetMap contributors" (About > Sources, licenses.html). Update cadence: OpenFreeMap rebuilds the
// planet about weekly; tiles are kept for the session (and in the HTTP / offline-tile caches).
//
// Unknown is NaN: a sample is known only when every tile within its band was read. "0" means the tile was read and OSM
// maps nothing there; OSM completeness varies (US driveways, land use and businesses are often under-mapped), so the
// model should treat low counts as weak evidence and use `lu_mapped` as land use's confidence.
//
// Channels (Float32Array per sample):
//   lu_residential, lu_commercial, lu_retail, lu_industrial, lu_forest, lu_farmland, lu_open, lu_park
//                     0..1  share of 7 probes (on the road and 50/100/150 m either side) inside that land use / cover.
//                           residential: landuse=residential; commercial: commercial (+office parks); retail: retail;
//                           industrial: industrial, railway, quarry, landfill; forest: landcover wood; farmland:
//                           landcover farmland (incl. orchard, vineyard); open: grass meadow/grassland/scrub/heath,
//                           wetland; park: the park layer (parks, nature reserves, protected areas) or landcover park.
//   lu_mapped          0..1  share of probes inside ANY mapped land use / land cover / park polygon (land use confidence).
//   water_near         0/1   a lake, river or pond polygon, or a river/stream/canal, within 150 m.
//   creek_follow       0/1   a river, stream or canal (not in a culvert) within 100 m running within 30 deg of the road's
//                           direction: the road follows the water. Its mean over a route is the creek-following share.
//   bldg_per_km        1/km  buildings whose centre is within 60 m, over a 500 m window.
//   addr_per_km        1/km  address points (housenumber layer) within 60 m, over a 500 m window.
//   biz_per_km         1/km  businesses within 120 m (strip malls sit behind their car parks), over 500 m, EXCLUDING fuel
//                           stations and cafes / coffee shops (BUSINESS below lists the OpenMapTiles poi mapping).
//   junctions_per_km   1/km  public roads joining or crossing (within 12 m, at more than 30 deg), over 500 m.
//   driveways_per_km   1/km  service=driveway lines joining, over 500 m.
//   access_per_km      1/km  junctions + driveways + other service entrances (car parks, alleys), over 500 m.
//   road_class         code  the map's class of the line under the sample (ROAD_CODE: 1 motorway .. 6 minor, 7 service,
//                           8 track, 9 raceway); NaN where no line lies within 15 m along the route's direction.
//   on_bridge, in_tunnel 0/1 the matched line is a bridge / tunnel.
//   unpaved            0/1   the matched line's surface is unpaved (NaN when the map has no surface for it).
// Points: { atM, kind, value?, label? } — kind 'school' (150 m), 'worship' (150 m), 'viewpoint' (300 m), 'place' (400 m;
//   value = PLACE_RANK, label = name), 'rail_crossing' (at grade only), 'gate' (barrier on the road, within 15 m).
// Spans: 'bridge', 'tunnel' (runs of on_bridge / in_tunnel).
(function (root) {
  'use strict';
  const G = root.ApexOsmCommon || (typeof require === 'function' ? require('./osm_common.js') : null);
  const Ctx = root.ApexRouteCtx;
  const finite = G.finite;
  const TILEJSON = 'https://tiles.openfreemap.org/planet';
  const Z = 14, PAD_M = 400, MAX_TILES = 220, CACHE_TILES = 240, PARALLEL = 8;
  const LU_BAND = 150, PROBES = [0, -50, 50, -100, 100, -150, 150];

  // ---- OpenMapTiles classes ------------------------------------------------------------------------------------------
  // poi classes that are businesses (shops, services, food, offices, lodging). Not: fuel, cafe, shop=coffee/tea (the
  // owner: "besides coffee shops and gas, more businesses = worse"); public services (school, library, post, police,
  // fire_station, town_hall, hospital), worship, parks, pitches, playgrounds, parking, bus stops, toilets, artwork,
  // atm (a machine, not a shop front), gates. Fast food, restaurants and bars count: they are what makes a strip.
  const BUSINESS = new Set(['shop', 'grocery', 'clothing_store', 'restaurant', 'fast_food', 'bar', 'beer', 'alcohol_shop',
    'bakery', 'butcher', 'ice_cream', 'bank', 'car', 'hairdresser', 'pharmacy', 'dentist', 'doctors', 'veterinary', 'office',
    'lodging', 'laundry', 'cinema', 'theatre', 'music', 'bicycle', 'florist', 'art_gallery', 'casino', 'nightclub', 'mall',
    'jewelry', 'optician', 'furniture', 'hardware', 'books', 'stationery', 'motorcycle', 'convenience']);
  const NOT_BUSINESS_SUB = new Set(['coffee', 'tea', 'artwork', 'fuel', 'cafe', 'charging_station', 'books_library']);
  const isBusiness = (cls, sub) => cls !== 'fuel' && cls !== 'cafe' && BUSINESS.has(cls) && !NOT_BUSINESS_SUB.has(sub) && !(cls === 'library');
  const LANDUSE = { residential: 'lu_residential', commercial: 'lu_commercial', retail: 'lu_retail', industrial: 'lu_industrial',
    railway: 'lu_industrial', quarry: 'lu_industrial', landfill: 'lu_industrial' };
  const LANDCOVER = { wood: 'lu_forest', forest: 'lu_forest', farmland: 'lu_farmland', wetland: 'lu_open' };
  const OPEN_GRASS = new Set(['meadow', 'grassland', 'scrub', 'heath', 'fell']);
  const LU_CHANNELS = ['lu_residential', 'lu_commercial', 'lu_retail', 'lu_industrial', 'lu_forest', 'lu_farmland', 'lu_open', 'lu_park'];
  const ROAD_CODE = { motorway: 1, trunk: 2, primary: 3, secondary: 4, tertiary: 5, minor: 6, service: 7, track: 8, raceway: 9 };
  const PUBLIC_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']);
  const PLACE_RANK = { city: 1, town: 2, village: 3, suburb: 4, hamlet: 5, neighbourhood: 6 };
  const WATERWAYS = new Set(['river', 'stream', 'canal']);
  const CHANNELS = [...LU_CHANNELS, 'lu_mapped', 'water_near', 'creek_follow', 'bldg_per_km', 'addr_per_km', 'biz_per_km',
    'junctions_per_km', 'driveways_per_km', 'access_per_km', 'road_class', 'on_bridge', 'in_tunnel', 'unpaved'];

  // ---- tiles ---------------------------------------------------------------------------------------------------------
  const tileOf = (lat, lon, z = Z) => {
    const n = Math.pow(2, z), r = lat * Math.PI / 180;
    return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
  };
  const tileBounds = (x, y, z = Z) => {   // [w, s, e, n]
    const n = Math.pow(2, z), lon = (v) => v / n * 360 - 180, lat = (v) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n)));
    return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
  };
  /** The z14 tiles ('x/y') within padM of a corridor's samples, in route order. */
  function tilesFor(c, padM = PAD_M) {
    const out = new Set();
    for (let i = 0; i < c.lat.length; i++) {
      if (!finite(c.lat[i]) || !finite(c.lon[i])) continue;
      const dLat = padM / 110540, dLon = padM / (111320 * Math.cos(c.lat[i] * Math.PI / 180));
      for (const a of [-dLat, 0, dLat]) for (const b of [-dLon, 0, dLon]) out.add(tileOf(c.lat[i] + a, c.lon[i] + b).join('/'));
    }
    return [...out];
  }
  // signed area; a polygon's first ring is its exterior (MVT spec), and later rings of the same sign start new polygons
  const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
  const boxOf = (rings) => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const r of rings) for (const [x, y] of r) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; } return b; };
  const centroid = (r) => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };

  /**
   * One z14 tile's bytes as the features this provider uses. Points outside the tile's own bounds (its buffer) are
   * dropped so a building or shop on a tile edge counts once.
   */
  function decodeTile(buf, x, y, z = Z) {
    const decode = (root.ApexStages && root.ApexStages.decodeLayer);
    if (!decode) throw new Error('ApexStages.decodeLayer missing');
    const [w, s, e, n] = tileBounds(x, y, z);
    const inside = (p) => p && p[0] >= w && p[0] < e && p[1] > s && p[1] <= n;
    const L = (name, g) => decode(buf, name, z, x, y, g);
    const t = { key: `${x}/${y}`, roads: [], names: [], pois: [], polys: [], waterways: [], waterPolys: [], buildings: [], places: [], addr: [] };
    for (const f of L('transportation', 2)) {
      const p = f.props;
      if (p.class === 'path' || p.class === 'ferry' || p.class === 'aerialway' || p.class === 'bus_guideway' || p.class === 'busway') continue;
      for (const l of f.lines) t.roads.push({ cls: p.class, sub: p.subclass || null, brunnel: p.brunnel || null, service: p.service || null, surface: p.surface || null, ramp: p.ramp === 1, line: l });
    }
    for (const f of L('transportation_name', 2)) if (f.props.name) for (const l of f.lines) t.names.push({ name: f.props.name, cls: f.props.class, line: l });
    for (const f of L('poi', 1)) for (const l of f.lines) if (inside(l[0])) t.pois.push({ cls: f.props.class, sub: f.props.subclass || null, name: f.props.name || null, lon: l[0][0], lat: l[0][1] });
    for (const f of L('place', 1)) for (const l of f.lines) if (inside(l[0]) && PLACE_RANK[f.props.class]) t.places.push({ cls: f.props.class, name: f.props.name || null, lon: l[0][0], lat: l[0][1] });
    for (const f of L('housenumber', 1)) for (const l of f.lines) if (inside(l[0])) t.addr.push(l[0]);
    for (const f of L('building', 3)) {
      const sign = f.lines.length ? Math.sign(ringArea(f.lines[0])) : 0;
      for (const r of f.lines) if (r.length > 2 && Math.sign(ringArea(r)) === sign) { const c = centroid(r); if (inside(c)) t.buildings.push(c); }
    }
    const poly = (layer, ch, f) => { if (ch) t.polys.push({ layer, ch, rings: f.lines, box: boxOf(f.lines) }); };
    for (const f of L('landuse', 3)) poly('landuse', LANDUSE[f.props.class] || 'other', f);
    for (const f of L('landcover', 3)) {
      const c = f.props.class, sub = f.props.subclass;
      poly('landcover', LANDCOVER[c] || (c === 'grass' && sub === 'park' ? 'lu_park' : c === 'grass' && OPEN_GRASS.has(sub) ? 'lu_open' : 'other'), f);
    }
    for (const f of L('park', 3)) poly('park', 'lu_park', f);
    for (const f of L('water', 3)) if (f.props.class !== 'swimming_pool') t.waterPolys.push({ rings: f.lines, box: boxOf(f.lines) });
    for (const f of L('waterway', 2)) if (WATERWAYS.has(f.props.class)) for (const l of f.lines) t.waterways.push({ cls: f.props.class, brunnel: f.props.brunnel || null, line: l });
    return t;
  }

  // ---- per-corridor aggregation (pure) -------------------------------------------------------------------------------
  function inRings(lon, lat, rings) {
    let inside = false;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /** A coarse grid over polygon boxes (degrees), so each probe tests only nearby polygons. */
  function polyGrid(polys, deg = 0.005) {
    const g = new Map();
    polys.forEach((p, k) => {
      for (let a = Math.floor(p.box[0] / deg); a <= Math.floor(p.box[2] / deg); a++) for (let b = Math.floor(p.box[1] / deg); b <= Math.floor(p.box[3] / deg); b++) {
        const key = a + ',' + b; let l = g.get(key); if (!l) g.set(key, (l = [])); l.push(k);
      }
    });
    return (lon, lat) => g.get(Math.floor(lon / deg) + ',' + Math.floor(lat / deg)) || [];
  }
  const segCross = (a, b, c, d) => {   // proper intersection of segments ab and cd (xy)
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return d1 * d2 < 0 && d3 * d4 < 0 ? d1 / (d1 - d2) : null;
  };

  /**
   * Everything for one corridor from decoded tiles. `tiles` = Map 'x/y' -> decoded tile (missing = not read).
   * Returns the contract's { status, channels, spans, points } (status 'ok' | 'partial' | 'unavailable').
   */
  function aggregate(c, tiles) {
    const n = c.lat.length;
    const res = G.emptyResult(n, CHANNELS, 'unavailable');
    if (!n) return res;
    // known: every tile within the land-use band of the sample was read
    const known = new Uint8Array(n);
    let nKnown = 0;
    for (let i = 0; i < n; i++) {
      const dLat = LU_BAND / 110540, dLon = LU_BAND / (111320 * Math.cos(c.lat[i] * Math.PI / 180));
      let ok = true;
      for (const a of [-dLat, dLat]) for (const b of [-dLon, dLon]) if (!tiles.has(tileOf(c.lat[i] + a, c.lon[i] + b).join('/'))) ok = false;
      known[i] = ok ? 1 : 0; nKnown += known[i];
    }
    if (!nKnown) { res.note = 'no map tiles'; return res; }
    res.status = nKnown === n ? 'ok' : 'partial';
    if (nKnown < n) res.note = `${n - nKnown} of ${n} samples without tiles`;
    const idx = G.sampleIndex(c, 100);
    const P = idx.P, ch = res.channels;
    const all = [...tiles.values()].filter(Boolean);
    const cat = (k) => all.flatMap((t) => t[k]);

    // land use: 7 probes across the road
    const polys = cat('polys'), lookup = polyGrid(polys), waterPolys = cat('waterPolys'), wLookup = polyGrid(waterPolys);
    for (let i = 0; i < n; i++) {
      if (!known[i]) continue;
      const counts = Object.fromEntries(LU_CHANNELS.map((k) => [k, 0]));
      let mapped = 0;
      const nx = -Math.sin(idx.dir[i]), ny = Math.cos(idx.dir[i]);
      for (const off of PROBES) {
        const lon = P.lon(idx.x[i] + nx * off), lat = P.lat(idx.y[i] + ny * off);
        const hit = new Set();
        for (const k of lookup(lon, lat)) {
          const p = polys[k];
          if (lon < p.box[0] || lon > p.box[2] || lat < p.box[1] || lat > p.box[3] || hit.has(p.ch)) continue;
          if (inRings(lon, lat, p.rings)) hit.add(p.ch);
        }
        if (hit.size) mapped++;
        for (const h of hit) if (h in counts) counts[h]++;
      }
      for (const k of LU_CHANNELS) ch[k][i] = counts[k] / PROBES.length;
      ch.lu_mapped[i] = mapped / PROBES.length;
      ch.water_near[i] = 0; ch.creek_follow[i] = 0;
    }
    // water polygons within 150 m: probe the same 7 points plus the polygon's own vertices near the road
    for (let i = 0; i < n; i++) {
      if (!known[i]) continue;
      const nx = -Math.sin(idx.dir[i]), ny = Math.cos(idx.dir[i]);
      for (const off of PROBES) {
        const lon = P.lon(idx.x[i] + nx * off), lat = P.lat(idx.y[i] + ny * off);
        if (wLookup(lon, lat).some((k) => inRings(lon, lat, waterPolys[k].rings))) { ch.water_near[i] = 1; break; }
      }
    }
    for (const wp of waterPolys) for (const r of wp.rings) G.walkLine(idx, r.concat([r[0]]), 25, (px, py) => { for (const i of idx.near(px, py, LU_BAND)) if (known[i]) ch.water_near[i] = 1; });
    // streams: near, and parallel = following
    for (const w of cat('waterways')) {
      G.walkLine(idx, w.line, 10, (px, py, dir) => {
        for (const i of idx.near(px, py, LU_BAND)) {
          if (!known[i]) continue;
          ch.water_near[i] = 1;
          if (w.brunnel === 'tunnel') continue;
          const d = Math.hypot(idx.x[i] - px, idx.y[i] - py);
          if (d <= 100 && G.lineAngle(dir, idx.dir[i]) <= Math.PI / 6) ch.creek_follow[i] = 1;
        }
      });
    }
    // counted things per km: buildings, addresses (60 m), businesses (120 m)
    const count = (pts, band) => {
      const k = new Float32Array(n);
      for (const p of pts) { const hit = idx.nearest(P.x(p[0]), P.y(p[1]), band); if (hit) k[hit.i]++; }
      return k;
    };
    ch.bldg_per_km.set(G.perKm(count(cat('buildings'), 60), c.distM, known));
    ch.addr_per_km.set(G.perKm(count(cat('addr'), 60), c.distM, known));
    const pois = cat('pois');
    ch.biz_per_km.set(G.perKm(count(pois.filter((p) => isBusiness(p.cls, p.sub)).map((p) => [p.lon, p.lat]), 120), c.distM, known));
    // points
    const add = (kind, p, band, extra = {}) => { const h = idx.nearest(P.x(p.lon), P.y(p.lat), band); if (h && known[h.i]) res.points.push({ atM: Math.round(h.atM), kind, label: p.name || undefined, offM: Math.round(h.d), ...extra }); };
    for (const p of pois) {
      if ((p.cls === 'school' && p.sub !== 'kindergarten') || p.cls === 'college') add('school', p, 150);
      else if (p.cls === 'place_of_worship') add('worship', p, 150);
      else if (p.sub === 'viewpoint') add('viewpoint', p, 300);
      else if (p.cls === 'gate' || p.cls === 'lift_gate') add('gate', p, 15);
    }
    for (const p of cat('places')) add('place', p, 400, { value: PLACE_RANK[p.cls] });

    // the road under each sample, and what joins it
    const best = new Float64Array(n).fill(Infinity), match = new Array(n).fill(null);
    const joins = { junction: new Float32Array(n), driveway: new Float32Array(n), other: new Float32Array(n) };
    const seen = new Set();
    const roads = cat('roads');
    roads.forEach((r, k) => {
      const isRail = r.cls === 'rail' || r.cls === 'transit';
      if (isRail) return;
      G.walkLine(idx, r.line, 5, (px, py, dir) => {
        for (const i of idx.near(px, py, 15)) {
          if (!known[i]) continue;
          const d = Math.hypot(idx.x[i] - px, idx.y[i] - py), ang = G.lineAngle(dir, idx.dir[i]);
          if (ang <= Math.PI / 6) { if (d < best[i]) { best[i] = d; match[i] = r; } }
          else if (d <= 12 && !r.ramp) {
            const key = `${k}:${Math.round(c.distM[i] / 40)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const kind = PUBLIC_ROADS.has(r.cls) ? 'junction' : r.service === 'driveway' ? 'driveway' : r.cls === 'service' ? 'other' : null;
            if (kind) joins[kind][i]++;
          }
        }
      });
    });
    for (let i = 0; i < n; i++) {
      if (!known[i]) continue;
      const r = match[i];
      ch.road_class[i] = r ? ROAD_CODE[r.cls] || NaN : NaN;
      ch.on_bridge[i] = r ? (r.brunnel === 'bridge' ? 1 : 0) : NaN;
      ch.in_tunnel[i] = r ? (r.brunnel === 'tunnel' ? 1 : 0) : NaN;
      ch.unpaved[i] = r && r.surface ? (r.surface === 'unpaved' ? 1 : 0) : NaN;
    }
    // a road the route itself is on (matched at that sample) isn't a junction there: drop joins from the matched line
    ch.junctions_per_km.set(G.perKm(joins.junction, c.distM, known));
    ch.driveways_per_km.set(G.perKm(joins.driveway, c.distM, known));
    const allJoins = new Float32Array(n); for (let i = 0; i < n; i++) allJoins[i] = joins.junction[i] + joins.driveway[i] + joins.other[i];
    ch.access_per_km.set(G.perKm(allJoins, c.distM, known));
    for (const kind of ['bridge', 'tunnel']) {
      const chan = kind === 'bridge' ? ch.on_bridge : ch.in_tunnel;
      for (const s of G.runs(c.distM, (i) => chan[i] === 1)) res.spans.push({ fromM: Math.round(s.fromM), toM: Math.round(s.toM), kind });
    }
    // rail crossings at grade: a rail line crossing the route's line where neither is a bridge or tunnel
    for (const r of roads) {
      if (!(r.cls === 'rail' || r.cls === 'transit') || r.brunnel) continue;
      const pts = r.line.map(([lon, lat]) => [P.x(lon), P.y(lat)]);
      for (let k = 0; k + 1 < pts.length; k++) {
        const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2, half = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) / 2;
        for (const i of idx.near(mx, my, half + 30)) {
          if (i + 1 >= n || !known[i]) continue;
          const t = segCross([idx.x[i], idx.y[i]], [idx.x[i + 1], idx.y[i + 1]], pts[k], pts[k + 1]);
          if (t == null) continue;
          const j = t < 0.5 ? i : i + 1;
          if (ch.on_bridge[j] === 1 || ch.in_tunnel[j] === 1) continue;
          const atM = Math.round(c.distM[i] + t * (c.distM[i + 1] - c.distM[i]));
          if (!res.points.some((q) => q.kind === 'rail_crossing' && Math.abs(q.atM - atM) < 30)) res.points.push({ atM, kind: 'rail_crossing' });
        }
      }
    }
    res.points.sort((a, b) => a.atM - b.atM);
    return res;
  }

  /** The tile road name under each sample (transportation_name within 20 m, along the road), null where none. */
  function namesFrom(c, tiles) {
    const n = c.lat.length, out = new Array(n).fill(null), best = new Float64Array(n).fill(Infinity);
    if (!n) return out;
    const idx = G.sampleIndex(c, 100);
    for (const t of tiles.values()) if (t) for (const r of t.names) G.walkLine(idx, r.line, 8, (px, py, dir) => {
      for (const i of idx.near(px, py, 20)) {
        const d = Math.hypot(idx.x[i] - px, idx.y[i] - py);
        if (d < best[i] && G.lineAngle(dir, idx.dir[i]) <= Math.PI / 6) { best[i] = d; out[i] = r.name; }
      }
    });
    return out;
  }

  // ---- network --------------------------------------------------------------------------------------------------------
  const cache = new Map();   // 'x/y' -> decoded tile, newest last (session)
  let tileUrl = null;
  const remember = (k, t) => { cache.delete(k); cache.set(k, t); while (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value); };
  async function readBytes(url, fetchFn, signal) {
    if (root.ApexOfflineTiles && !fetchFn.stubbed) { try { const b = await root.ApexOfflineTiles.get(url); if (b) return new Uint8Array(b); } catch (_) {} }
    const r = await fetchFn(url, { signal });
    if (!r.ok) throw new Error(`http ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  /**
   * Decoded tiles for these keys: cached ones at once, the rest PARALLEL at a time until the budget or signal ends.
   * opts: { fetchFn, signal, budgetMs, tileUrl, stub: { tiles: { 'x/y': Uint8Array } } }. Never throws.
   */
  async function loadTiles(keys, opts = {}) {
    const out = new Map(), stub = stubOf(opts);
    const want = [];
    for (const k of keys) { if (cache.has(k)) out.set(k, cache.get(k)); else want.push(k); }
    if (!want.length) return out;
    if (stub) {
      for (const k of want) {
        const b = stub.tiles && stub.tiles[k];
        if (!b) continue;
        const [x, y] = k.split('/').map(Number);
        try { const t = decodeTile(b instanceof Uint8Array ? b : new Uint8Array(b), x, y); remember(k, t); out.set(k, t); } catch (_) {}
      }
      return out;
    }
    const fetchFn = opts.fetchFn || (root.fetch && root.fetch.bind(root));
    if (!fetchFn) return out;
    const stop = G.deadline(opts.budgetMs, opts.signal);
    try {
      if (!tileUrl || opts.tileUrl) {
        tileUrl = opts.tileUrl || await Promise.race([(async () => { const r = await fetchFn(TILEJSON, { signal: opts.signal }); return (await r.json()).tiles[0]; })(), stop]);
      }
      let next = 0;
      const worker = async () => {
        while (next < want.length) {
          const k = want[next++];
          const [x, y] = k.split('/').map(Number);
          try {
            const buf = await Promise.race([readBytes(tileUrl.replace('{z}', Z).replace('{x}', x).replace('{y}', y), fetchFn, opts.signal), stop]);
            const t = decodeTile(buf, x, y); remember(k, t); out.set(k, t);
          } catch (e) { if (/budget|aborted/.test(String(e && e.message))) return; }
        }
      };
      await Promise.race([Promise.all(Array.from({ length: PARALLEL }, worker)), stop]).catch(() => {});
    } catch (_) { /* no tile JSON: nothing read */ } finally { stop.cancel(); }
    return out;
  }
  const stubOf = (opts) => opts.stub || (root.ApexRouteCtxStub && root.ApexRouteCtxStub.osm_tiles) || null;

  /** The tiles a plan needs (union over its corridors, at most MAX_TILES in route order) and whether some were cut. */
  function planTiles(corridors) {
    const all = new Set();
    for (const c of corridors) for (const k of tilesFor(c)) all.add(k);
    const keys = [...all];
    return { keys: keys.slice(0, MAX_TILES), cut: keys.length > MAX_TILES };
  }

  async function fetchCtx(corridors, opts = {}) {
    const out = {};
    try {
      const { keys, cut } = planTiles(corridors);
      const tiles = await loadTiles(keys, opts);
      for (const c of corridors) {
        try {
          out[c.id] = aggregate(c, tiles);
          if (cut && out[c.id].status === 'ok') out[c.id].status = 'partial';
        } catch (e) { out[c.id] = G.emptyResult(c.lat.length, CHANNELS, 'unavailable', String(e && e.message || e)); }
      }
    } catch (e) {
      for (const c of corridors) out[c.id] = G.emptyResult(c.lat.length, CHANNELS, 'unavailable', String(e && e.message || e));
    }
    return out;
  }

  /** Road names per sample for each corridor (road_name_age.js uses these when the router gave none). */
  async function roadNames(corridors, opts = {}) {
    const { keys } = planTiles(corridors);
    const tiles = await loadTiles(keys, opts);
    const out = {};
    for (const c of corridors) out[c.id] = namesFrom(c, tiles);
    return out;
  }

  const provider = {
    id: 'osm_tiles', version: 1, channels: CHANNELS, needs: { network: true }, budgetMs: 8000,
    fetch: fetchCtx,
  };
  const api = { provider, CHANNELS, BUSINESS, isBusiness, ROAD_CODE, PLACE_RANK, tileOf, tileBounds, tilesFor, planTiles, decodeTile,
    aggregate, namesFrom, loadTiles, roadNames, _cache: cache };
  root.ApexOsmTiles = api;
  if (Ctx && Ctx.register) Ctx.register(provider);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
