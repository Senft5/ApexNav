// The cases tests/test_graph_router.py checks, run in node: `node graph_router_cases.js <case> [dir]` prints JSON.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const H = require('./graph_router_harness.js'), R = H.R;
const ROOT = path.join(__dirname, '..');
const FunRoute = require('../web/fun_route.js');
const Own = require('../web/own_routing.js');

const at = (lat, lon, flags = 0) => ({ lat, lon, flags });
const two = (edges, a, b, props) => { edges.push({ from: a, to: b, ...props }); edges.push({ from: b, to: a, ...props }); };
const plain = (r) => ({ edges: r.edges, timeS: +r.timeS.toFixed(3), distM: +r.distM.toFixed(1), role: r.why.role, a: r.why.a, names: r.names.map((n) => n.name) });

const CASES = {
  // A* against brute-force Dijkstra on random small graphs with holes, one-ways, unknowns, signals and turn restrictions
  astar() {
    let n = 0, bad = 0, found = 0, restricted = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = H.grid({ seed, nx: 7, ny: 6, holes: 0.15, oneway: 0.2, signals: 0.2, lat0: 39.2, lon0: -84.52, stepDeg: 0.01 });
      // random restrictions at junctions: from an edge into a node, no (or only) one edge out of it
      const rnd = H.rng(seed * 13), rs = [];
      for (let k = 0; k < 6; k++) {
        const p = Math.floor(rnd() * g.edges.length), via = g.edges[p].to, outs = g.edges.map((e, i) => [e, i]).filter(([e]) => e.from === via && e.to !== g.edges[p].from);
        if (outs.length) rs.push({ from: p, via, to: outs[Math.floor(rnd() * outs.length)][1], only: rnd() < 0.3 });
      }
      const T = H.tiles(g.nodes, g.edges, rs), v = R.view(T.tiles);
      restricted += v.restr.size;
      for (let k = 0; k < 6; k++) {
        const A = g.nodes[Math.floor(rnd() * g.nodes.length)], B = g.nodes[Math.floor(rnd() * g.nodes.length)];
        const src = R.snap(v, A.lat + 0.001, A.lon + 0.0013), dst = R.snap(v, B.lat - 0.0012, B.lon + 0.001);
        for (const a of [0, 3, 12]) {
          const obj = R.objective(v, {});
          const r = R.search(v, obj, src, dst, a), b = H.brute(v, obj, src, dst, a);
          n++;
          const rc = r ? r.cost : Infinity;
          if (rc < Infinity) found++;
          if (!((rc === Infinity && b === Infinity) || Math.abs(rc - b) <= 1e-6 * Math.max(1, b))) bad++;
        }
      }
    }
    return { n, bad, found, restricted };
  },

  // turn restrictions (no and only), one-ways, U-turns only at dead ends
  rules() {
    // a cross at C with arms N, E, S, W (400 m) and a block joining W and N round the north-west corner
    const C = [39.10, -84.50], d = 0.0036, e = 0.0046;
    const nodes = [at(C[0], C[1]), at(C[0] + d, C[1]), at(C[0], C[1] + e), at(C[0] - d, C[1]), at(C[0], C[1] - e), at(C[0] + d, C[1] - e), at(C[0] - 2 * d, C[1])];
    const [c, N, E, S, W, NW, S2] = [0, 1, 2, 3, 4, 5, 6];
    const edges = [];
    const st = { quality: 0.6, cls: 4 };
    for (const [a, b, name] of [[c, N, 'North'], [c, E, 'East'], [c, S, 'South'], [c, W, 'West'], [W, NW, 'Loop'], [NW, N, 'Loop'], [S, S2, 'South']]) two(edges, a, b, { ...st, name, t: 30 });
    const ix = (a, b) => edges.findIndex((x) => x.from === a && x.to === b);
    const route = (rs) => {
      const v = R.view(H.tiles(nodes, edges, rs).tiles);
      const p = R.plan(v, { from: { lat: C[0] - 1.5 * d, lon: C[1] }, to: { lat: C[0], lon: C[1] - 0.6 * e }, level: 'quick' });
      return p.quick.names.map((x) => x.name);
    };
    const free = route([]);
    const noLeft = route([{ from: ix(S, c), via: c, to: ix(c, W) }]);
    const onlyStraight = route([{ from: ix(S, c), via: c, to: ix(c, N), only: true }]);
    // one-ways: A to B direct is one-way B -> A, the way round is two-way
    const n2 = [at(39.2, -84.6), at(39.2, -84.59), at(39.205, -84.595)], e2 = [];
    e2.push({ from: 1, to: 0, t: 40, name: 'Oneway', flags: 1 });
    two(e2, 0, 2, { t: 50, name: 'Round' }); two(e2, 2, 1, { t: 50, name: 'Round' });
    const v2 = R.view(H.tiles(n2, e2).tiles);
    const ab = R.plan(v2, { from: { lat: 39.2, lon: -84.5999 }, to: { lat: 39.2, lon: -84.5901 }, level: 'quick' }).quick.names.map((x) => x.name);
    const ba = R.plan(v2, { from: { lat: 39.2, lon: -84.5901 }, to: { lat: 39.2, lon: -84.5999 }, level: 'quick' }).quick.names.map((x) => x.name);
    // U-turns: back the way you came at the junction C (forbidden) and at the dead end S2 (allowed)
    const v = R.view(H.tiles(nodes, edges).tiles), obj = R.objective(v, {});
    const gid = (a, b) => { const T = H.tiles(nodes, edges); const [k, l] = T.edgeAt.get(ix(a, b)); return v.edgeBase[v.keys.indexOf(k)] + l; };
    const uJunction = R.turnCost(v, gid(S, c), gid(c, S), obj), uDeadEnd = R.turnCost(v, gid(S, S2), gid(S2, S), obj);
    // a trip from the dead-end street's far side back: it has to turn at the dead end, not mid-street
    const left = R.turnCost(v, gid(S, c), gid(c, W), obj), right = R.turnCost(v, gid(S, c), gid(c, E), obj), straight = R.turnCost(v, gid(S, c), gid(c, N), obj);
    return { free, noLeft, onlyStraight, ab, ba, uJunction: uJunction === Infinity ? 'forbidden' : uJunction, uDeadEnd, left, right, straight };
  },

  // the level budgets (fun_route.js LEVELS), alternates 30 % different, and the same answer every time
  budgets() {
    const g = H.grid({ seed: 3, nx: 30, ny: 30, holes: 0.05, oneway: 0.05, signals: 0.15, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    const T = H.tiles(g.nodes, g.edges), v = R.view(T.tiles);
    const trips = [[{ lat: 39.152, lon: -84.618 }, { lat: 39.262, lon: -84.48 }], [{ lat: 39.2, lon: -84.6 }, { lat: 39.17, lon: -84.5 }], [{ lat: 39.25, lon: -84.61 }, { lat: 39.16, lon: -84.47 }]];
    const out = { levelsSame: JSON.stringify(Object.fromEntries(Object.entries(FunRoute.LEVELS).map(([k, L]) => [k, [L.budget, L.slackS]]))) === JSON.stringify(Object.fromEntries(Object.entries(R.LEVELS_COPY).map(([k, L]) => [k, [L.budget, L.slackS]]))),
      usesFunRoute: R.levels() === FunRoute.LEVELS, trips: [] };
    for (const [from, to] of trips) for (const level of ['quick', 'fun', 'max']) {
      const L = FunRoute.LEVELS[level], p = R.plan(v, { from, to, level });
      const best = p.routes[0], alts = p.routes.filter((r) => r.why.role === 'alternate');
      const diffs = [];
      for (const a of alts) diffs.push(1 - R.overlap(v, best, a));
      for (let i = 0; i < alts.length; i++) for (let j = i + 1; j < alts.length; j++) diffs.push(1 - R.overlap(v, alts[i], alts[j]));
      // the same plan again, and on the tiles in another order: the same routes
      const again = R.plan(v, { from, to, level }), shuffled = R.plan(R.view(T.tiles.slice().reverse()), { from, to, level });
      const sig = (q) => JSON.stringify(q.routes.map(plain));
      const goodness = (r) => { const obj = R.objective(v, {}); let s = 0, t = 0; for (const e of r.edgeIdx) { s += (1 - obj.bad[e]) * v.time[e]; t += v.time[e]; } return s / t; };
      out.trips.push({ level, quickS: p.quick.timeS, limitS: p.limitS, expectLimit: p.quick.timeS * (1 + L.budget) + L.slackS, times: p.routes.map((r) => r.timeS), roles: p.routes.map((r) => r.why.role),
        alts: alts.length, diffs, same: sig(p) === sig(again), sameShuffled: sig(p) === sig(shuffled), goodBest: goodness(best), goodQuick: goodness(p.quick), a: p.a });
    }
    return out;
  },

  // corners only count on good road: the subdivision cut-through is the quickest, Fun and Max take the back road
  subdivision() {
    const S = [39.30, -84.60], nodes = [at(S[0], S[1]), at(S[0], S[1] + 0.036)];
    const edges = [];
    const via = (pts, props) => { const ids = pts.map((p) => { nodes.push(at(p[0], p[1])); return nodes.length - 1; }); const chain = [0, ...ids, 1]; for (let k = 0; k + 1 < chain.length; k++) two(edges, chain[k], chain[k + 1], props(k)); };
    const wig = (dLat, n) => Array.from({ length: n }, (_, k) => [S[0] + dLat + (k % 2 ? 0.0006 : -0.0006), S[1] + 0.036 * (k + 1) / (n + 1)]);
    via(wig(0.004, 9), () => ({ name: 'Oak Hollow Subdivision', quality: 0.15, scenery: 0.4, fun: 0, conf: 1, cls: 6, t: 14 }));        // 10 x 14 s
    via([[S[0] - 0.003, S[1] + 0.018]], () => ({ name: 'Colerain Avenue', quality: 0.2, scenery: 0.2, fun: 0, conf: 1, cls: 2, t: 85 })); // strip mall, 170 s
    via(wig(-0.012, 7), () => ({ name: 'Pippin Road', quality: 0.85, scenery: 0.75, fun: 2.5, conf: 1, cls: 4, t: 26 }));               // 8 x 26 s
    // the trip starts and ends on short lanes into the two ends, so no way is forced by where it starts
    nodes.push(at(S[0], S[1] - 0.004), at(S[0], S[1] + 0.040));
    two(edges, nodes.length - 2, 0, { name: 'Start Lane', t: 30 }); two(edges, 1, nodes.length - 1, { name: 'End Lane', t: 30 });
    const v = R.view(H.tiles(nodes, edges).tiles);
    const from = { lat: S[0], lon: S[1] - 0.002 }, to = { lat: S[0], lon: S[1] + 0.038 };
    const out = {};
    for (const level of ['quick', 'fun', 'max']) {
      const p = R.plan(v, { from, to, level });
      out[level] = { best: p.routes[0].names.map((n) => n.name).filter(Boolean), quickest: p.quick.names.map((n) => n.name).filter(Boolean), timeS: p.routes[0].timeS, quickS: p.quick.timeS, limitS: p.limitS };
    }
    return out;
  },

  // members' data in the search: a near-tie (the plain lane 2 s quicker) flips to the loved, smooth, flowing lane, and
  // with no data (signed out) nothing changes
  crowd() {
    const A = [39.30, -84.70], nodes = [at(A[0], A[1] - 0.004), at(A[0], A[1]), at(A[0], A[1] + 0.03), at(A[0], A[1] + 0.034)];
    const edges = [];
    two(edges, 0, 1, { name: 'Start Lane', t: 30 }); two(edges, 2, 3, { name: 'End Lane', t: 30 });
    const north = [[A[0] + 0.004, A[1] + 0.01], [A[0] + 0.004, A[1] + 0.02]], south = [[A[0] - 0.004, A[1] + 0.01], [A[0] - 0.004, A[1] + 0.02]];
    const chain = (pts, props) => { const ids = pts.map((p) => { nodes.push(at(p[0], p[1])); return nodes.length - 1; }); const c = [1, ...ids, 2]; for (let k = 0; k + 1 < c.length; k++) two(edges, c[k], c[k + 1], props(k)); };
    chain(north, (k) => ({ name: 'Smooth Lane', quality: 0.6, scenery: 0.5, fun: 0.5, conf: 0.8, cls: 4, t: k === 1 ? 61 : 60 }));
    chain(south, (k) => ({ name: 'Plain Lane', quality: 0.6, scenery: 0.5, fun: 0.5, conf: 0.8, cls: 4, t: k === 1 ? 59 : 60 }));
    const v = R.view(H.tiles(nodes, edges).tiles);
    const from = { lat: A[0], lon: A[1] - 0.002 }, to = { lat: A[0], lon: A[1] + 0.032 };
    const roads = (r) => r.names.map((n) => n.name).filter((n) => /Lane$/.test(n) && !/Start|End/.test(n));
    const before = R.plan(v, { from, to, level: 'fun' });
    // the north lane as members measured it, both ways: smooth (0.06 g), flowing, loved (came back to it 5+ times)
    const line = [[A[0], A[1]], [A[0] + 0.004, A[1] + 0.01], [A[0] + 0.004, A[1] + 0.02], [A[0], A[1] + 0.03]];
    let L = 0; for (let k = 1; k < line.length; k++) L += R.distM(line[k - 1][0], line[k - 1][1], line[k][0], line[k][1]);
    const bins = Array.from({ length: Math.floor(L / 5) }, (_, b) => b);
    const ways = { 77: { 0: { i: bins, n: bins.map(() => 6), rough: bins.map(() => 0.06), rsd: bins.map(() => 0.01), cam: bins.map(() => 1), csd: bins.map(() => 0.2),
      fl: bins.map(() => 0.95), hb: bins.map(() => 0), fn: bins.map(() => 6), ag: 3 } } };
    ways[77][1] = ways[77][0];
    const items = Own.crowdItems({ ways, lines: { 77: line } });
    v.crowd = R.crowdOnto(v, items);
    const after = R.plan(v, { from, to, level: 'fun' });
    const objOn = R.objective(v, {}), aOn = R.search(v, objOn, R.snap(v, from.lat, from.lon), R.snap(v, to.lat, to.lon), 8);
    const smoothEdges = v.crowd ? v.crowd.edges : 0;
    v.crowd = null;
    const none = R.plan(v, { from, to, level: 'fun' });
    const cells = Own.cellsFor({ lat: 39.25, lon: -84.6 }, { lat: 39.29, lon: -84.75 });
    return { before: roads(before.routes[0]), after: roads(after.routes[0]), afterA8: R.assemble(v, aOn, objOn).names.map((n) => n.name).includes('Smooth Lane'),
      none: roads(none.routes[0]), smoothEdges, items: items.length, cells: cells.length, cell0: cells[0] };
  },

  // spoken directions offline: a left onto Second Street, a right onto Third, start and arrive
  maneuvers() {
    const nodes = [at(39.1, -84.5), at(39.1, -84.494), at(39.1045, -84.494), at(39.1045, -84.488), at(39.0955, -84.494), at(39.1, -84.488)];
    const edges = [];
    two(edges, 0, 1, { name: 'First Street', t: 40 }); two(edges, 1, 2, { name: 'Second Street', t: 40 }); two(edges, 2, 3, { name: 'Third Street', t: 40 });
    two(edges, 1, 4, { name: 'Stub', t: 40 }); two(edges, 1, 5, { name: 'First Street', t: 400 });
    const v = R.view(H.tiles(nodes, edges).tiles);
    const p = R.plan(v, { from: { lat: 39.1, lon: -84.4995 }, to: { lat: 39.1045, lon: -84.4885 }, level: 'quick' });
    const r = p.quick;
    return { steps: r.route.steps.map((s) => [s.type, s.street]), turns: r.route.turns.length, times: r.route.times.map((t) => t[2]), timeS: r.timeS, coords0: r.coords[0], coordsN: r.coords[r.coords.length - 1],
      lonlat0: r.route.coords[0], has: r.route.has, names: [...r.route.names.keys()] };
  },

  loops() {
    const g = H.grid({ seed: 9, nx: 28, ny: 28, holes: 0.05, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    const v = R.view(H.tiles(g.nodes, g.edges).tiles);
    const start = { lat: 39.205, lon: -84.55 };
    const res = R.loop(v, { start, km: 16, level: 'fun' });
    return { n: res.routes.length, ms: res.ms, loops: res.routes.map((r) => ({ km: r.distM / 1000, retraced: r.retraced, d0: R.distM(start.lat, start.lon, r.coords[0][0], r.coords[0][1]), dN: R.distM(start.lat, start.lon, r.coords[r.coords.length - 1][0], r.coords[r.coords.length - 1][1]) })) };
  },

  // the tiles' corridor: the ellipse grows with the level's budget, and covers() reads index.json
  corridor() {
    const a = { lat: 39.25, lon: -84.6 }, b = { lat: 39.29, lon: -84.75 };
    const n = (lv) => R.tilesFor(a, b, lv).length;
    const keys = R.indexKeys({ tiles: { '381_516': {}, '382_516': {} } });
    return { quick: n('quick'), fun: n('fun'), max: n('max'), long: R.tilesFor({ lat: 39.1, lon: -84.5 }, { lat: 39.9, lon: -83.0 }, 'fun').length,
      start: R.tileOf(39.1, -84.51), covers: R.covers(keys, [{ lat: 39.1, lon: -84.51 }, { lat: 39.2, lon: -84.4 }]), outside: R.covers(keys, [{ lat: 39.1, lon: -84.51 }, { lat: 40.5, lon: -84.4 }]) };
  },

  // the worker file in a sandbox that looks like a worker, on real tiles (written by tools/graph_etl/tiles.py into dir)
  async worker(dir) {
    const posted = [];
    const sandbox = { self: {}, console, Math, Date, JSON, Promise, Map, Set, Array, Object, Number, String, Error, Infinity, NaN, isFinite, setTimeout, clearTimeout, TextDecoder,
      Int32Array, Uint32Array, Uint16Array, Uint8Array, Float32Array, Float64Array, DataView, ArrayBuffer };
    sandbox.self.postMessage = (m) => posted.push(m);
    sandbox.fetch = async (u) => { const f = path.join(dir, String(u).replace(/^.*data\/graph\/v1\//, '')); if (!fs.existsSync(f)) return { ok: false, status: 404 };
      const b = fs.readFileSync(f); return { ok: true, json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; };
    sandbox.globalThis = sandbox;
    sandbox.importScripts = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', f), 'utf8'), sandbox, { filename: f }); };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/graph_worker.js'), 'utf8'), sandbox);
    const ask = async (data) => { const n = posted.length; await sandbox.self.onmessage({ data }); return posted[n]; };
    const from = { lat: 39.152, lon: -84.618 }, to = { lat: 39.262, lon: -84.48 };
    const covers = await ask({ id: 1, type: 'covers', points: [from, to] });
    const outside = await ask({ id: 2, type: 'covers', points: [from, { lat: 41, lon: -84 }] });
    const plan = await ask({ id: 3, type: 'plan', from, to, level: 'fun' });
    const loop = await ask({ id: 4, type: 'loop', start: { lat: 39.2, lon: -84.55 }, km: 12, level: 'fun' });
    const unknown = await ask({ id: 5, type: 'teleport' });
    const nowhere = await ask({ id: 6, type: 'plan', from: { lat: 41, lon: -84 }, to: { lat: 41.01, lon: -84 }, level: 'fun' });
    // the same trip on the same graph in memory (no codec): the worker's answer must be the same routes
    const g = H.grid({ seed: 3, nx: 30, ny: 30, holes: 0.05, oneway: 0.05, signals: 0.15, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    const mem = R.plan(R.view(H.tiles(g.nodes, g.edges).tiles), { from, to, level: 'fun' });
    const r0 = plan.result && plan.result.routes[0];
    return { covers, outside, planId: plan.id, planError: plan.error || null, n: plan.result ? plan.result.routes.length : 0, tiles: plan.result ? plan.result.tiles : null,
      sameAsMemory: !!r0 && JSON.stringify(plan.result.routes.map((r) => r.edges)) === JSON.stringify(mem.routes.map((r) => r.edges)) && Math.abs(r0.timeS - mem.routes[0].timeS) < 1e-6,
      routeShape: r0 ? { coords: !('coords' in r0) && !('coords' in r0.route) && r0.route.flat instanceof Float64Array, lonlat: Own.withCoords({ ...r0.route }).coords[0].length, names: r0.route.names instanceof Map, edgeIdx: 'edgeIdx' in r0, why: Object.keys(r0.why).sort() } : null,
      loopN: loop.result ? loop.result.routes.length : -1, loopError: loop.error || null, unknown, nowhere: nowhere.error || null };
  },

  // the page's side: a worker by message id, the in-page fallback, a timeout
  async client() {
    const g = H.grid({ seed: 4, nx: 12, ny: 12, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    const T = H.tiles(g.nodes, g.edges);
    const env = { load: async (i, j) => T.tiles.find((t) => t.tile.i === i && t.tile.j === j) || null, index: async () => ({ tiles: Object.fromEntries(T.tiles.map((t) => [`${t.tile.i}_${t.tile.j}`, {}])) }) };
    class FakeWorker {
      constructor() { this.h = R.host(env); this.seen = []; FakeWorker.last = this; }
      postMessage(m) { this.seen.push(m.type); this.h.handle(m).then((r) => setTimeout(() => this.onmessage({ data: r }), 0)); }
      terminate() {}
    }
    class SilentWorker { postMessage() {} terminate() {} }
    class BrokenWorker { constructor() { throw new Error('no workers'); } }
    const from = { lat: 39.155, lon: -84.615 }, to = { lat: 39.19, lon: -84.57 };
    const c1 = R.client({ Worker: FakeWorker });
    const [cov, res] = await Promise.all([c1.covers([from, to]), c1.plan({ from, to, level: 'fun' })]);
    const c2 = R.client({ Worker: BrokenWorker, env });
    const res2 = await c2.plan({ from, to, level: 'fun' });
    const c3 = R.client({ Worker: SilentWorker, timeoutMs: 50 });
    const timeout = await c3.plan({ from, to, level: 'fun' }).then(() => 'answered', (e) => e.message);
    const c4 = R.client({ Worker: BrokenWorker });
    const none = await c4.plan({ from, to, level: 'fun' }).then(() => 'answered', (e) => e.message);
    return { cov, n: res.routes.length, sent: FakeWorker.last.seen, inlineSame: JSON.stringify(res.routes.map((r) => r.edges)) === JSON.stringify(res2.routes.map((r) => r.edges)), timeout, none };
  },

  // the planner's side (own_routing.js): our routes as candidates; out of the tiles, nothing; instructions from Valhalla
  async glue() {
    const g = H.grid({ seed: 4, nx: 12, ny: 12, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    const T = H.tiles(g.nodes, g.edges);
    const env = { load: async (i, j) => T.tiles.find((t) => t.tile.i === i && t.tile.j === j) || null, index: async () => ({ tiles: Object.fromEntries(T.tiles.map((t) => [`${t.tile.i}_${t.tile.j}`, {}])) }) };
    const client = R.client({ Worker: null, env });
    const from = { lat: 39.155, lon: -84.615 }, to = { lat: 39.19, lon: -84.57 };
    const inside = await Own.plan(client, { from, to, level: 'fun' });
    const out = await Own.plan(client, { from, to: { lat: 40.5, lon: -84.57 }, level: 'fun' });
    const off = await Own.plan(null, { from, to, level: 'fun' });
    const broken = await Own.plan({ covers: async () => true, plan: async () => { throw new Error('boom'); } }, { from, to, level: 'fun' });
    const c = inside.cands[0];
    // online: Valhalla's maneuvers replace ours (one trace_route call, our line encoded); offline: ours stay
    const bodies = [];
    const trip = { legs: [{ maneuvers: [] }] };
    const parse = () => ({ steps: [{ lon: c.route.coords[3][0], lat: c.route.coords[3][1], type: 10, street: 'Valhalla Street' }], turns: [[0, 0]], times: [[0, 0, 0], [1, 1, 99]] });
    const onlineRoute = { ...c.route }, offlineRoute = { ...c.route, steps: c.route.steps.slice() }, slowRoute = { ...c.route, steps: c.route.steps.slice() };
    const online = await Own.instruct(onlineRoute, async (b) => { bodies.push(b); return { trip }; }, parse, { costing: 'auto' });
    const offline = await Own.instruct(offlineRoute, async () => { throw new Error('offline'); }, parse);
    const slow = await Own.instruct(slowRoute, () => new Promise(() => {}), parse, null, 30);
    // decode the encoded line back: it is our line
    const dec = (s) => { const pts = []; let i = 0, la = 0, lo = 0; while (i < s.length) { for (const k of [0, 1]) { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k) lo += d; else la += d; } pts.push([lo / 1e6, la / 1e6]); } return pts; };
    const back = dec(bodies[0].encoded_polyline);
    // one clock: Valhalla's quickest the same way as ours puts every one of ours on its clock; another way, nothing
    const cl = Own.candidates(inside.result), q0 = cl.find((x) => x.ownRole === 'quickest'), t0 = cl.map((x) => x.timeS);
    const same = Own.oneClock(cl, { coords: q0.route.coords.slice(), timeS: q0.timeS * 0.9 });
    const scaled = cl.every((x, i) => Math.abs(x.timeS - t0[i] * 0.9) < 1e-6);
    const cl2 = Own.candidates(inside.result), other = Own.oneClock(cl2, { coords: q0.route.coords.map(([lo, la]) => [lo + 0.01, la]), timeS: 100 });
    const flags = { on: (n, d) => (n === 'own_routing' ? false : d) };
    const store = (v) => ({ getItem: (k) => (k === Own.OFF_KEY ? v : null) });
    return { inside: { reason: inside.reason, n: inside.cands.length, kinds: [...new Set(inside.cands.map((x) => x.kind))], names: c.route.names instanceof Map, timeS: c.timeS === c.own.timeS, via: c.via },
      out: out.reason, outN: out.cands.length, off: off.reason, broken: [broken.reason, broken.error],
      online, onlineSteps: onlineRoute.steps.map((s) => s.street), bodies: bodies.length, shapeMatch: bodies[0].shape_match, sameLine: back.length === c.route.coords.length && Math.abs(back[5][0] - c.route.coords[5][0]) < 2e-6,
      offline, offlineSteps: offlineRoute.steps.length === c.route.steps.length, slow,
      clock: [same, scaled, other], onFlags: [Own.on({ flags, storage: store(null), router: R }), Own.on({ flags: { on: (n, d) => d }, storage: store('0'), router: R }), Own.on({ flags: { on: (n, d) => d }, storage: store(null), router: R })] };
  },

  // Best roads nearby from our tiles: the twisty good road is the first stage, timed from here; the side streets aren't
  explore() {
    const g = H.grid({ seed: 6, nx: 12, ny: 12, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    // make the grid plain (no corners on good road), then one road twisty and good along row 6
    for (const e of g.edges) { e.fun = 0; e.quality = 0.5; }
    for (const e of g.edges) if (e.name === 'Row 6') { e.fun = 3; e.quality = 0.85; e.name = 'Twisty Road'; }
    for (const e of g.edges) if (e.name === 'Col 3') { e.fun = 3; e.quality = 0.2; e.name = 'Subdivision Lane'; }
    const v = R.view(H.tiles(g.nodes, g.edges).tiles);
    const res = R.explore(v, { start: { lat: 39.152, lon: -84.618 }, maxKm: 10, maxS: 1800 });
    const s0 = res.stages[0];
    return { n: res.stages.length, first: s0 && s0.name, km: s0 && s0.km, good: s0 && s0.good, timed: s0 && (Number.isFinite(s0.aS) || Number.isFinite(s0.bS)),
      shape: s0 && s0.lat.length === s0.lon.length && s0.lat.length > 10, names: res.stages.map((x) => x.name), ms: res.ms };
  },

  // the fast path: our quickest alone, the tiles' scores along any line, the preload, one view reused
  async fast() {
    const g = H.grid({ seed: 4, nx: 12, ny: 12, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    const T = H.tiles(g.nodes, g.edges);
    // v2 road channels on every edge (graph_tiles.js edges.ch): carried through the view, the line scoring, the provider
    for (const t of T.tiles) t.edges.ch = { business_per_km: new Float32Array(t.edges.count).fill(9), sidewalk: new Float32Array(t.edges.count).fill(1) };
    let loads = 0;
    const env = { load: async (i, j) => { loads++; return T.tiles.find((t) => t.tile.i === i && t.tile.j === j) || null; }, index: async () => ({ tiles: Object.fromEntries(T.tiles.map((t) => [`${t.tile.i}_${t.tile.j}`, {}])) }) };
    const h = R.host(env);
    const pre = await h.handle({ id: 1, type: 'preload', lat: 39.17, lon: -84.6, km: 3 });
    const loadsAfterPreload = loads;
    const from = { lat: 39.155, lon: -84.615 }, to = { lat: 39.19, lon: -84.57 };
    const q = await h.handle({ id: 2, type: 'quick', from, to, level: 'fun' });
    const p = await h.handle({ id: 3, type: 'plan', from, to, level: 'fun' });
    const quickest = p.result.routes.find((r) => r.why.role === 'quickest');
    const line = Own.withCoords({ ...p.result.routes[0].route }).coords.map(([lo, la]) => [la, lo]);
    const sc = await h.handle({ id: 4, type: 'score', lines: [{ lat: line.map((x) => x[0]), lon: line.map((x) => x[1]) }, { lat: [41, 41.001], lon: [-84, -84] }] });
    const known = Array.from(sc.result[0].quality).filter(Number.isFinite).length / line.length;
    // the graph provider and the engine: the tiles' scores fill quality and scenery where nothing else knows
    globalThis.ApexFunRoute = FunRoute; globalThis.ApexCore = require('../web/apex_core.js');
    const Ctx = require('../web/route_ctx/registry.js'), Graph = require('../web/route_ctx/graph.js'), Engine = require('../web/route_engine.js');
    const c = Ctx.corridor('g', line.map(([la, lo]) => [lo, la]), {});
    const ch = Graph.channelsOf(c.lat.length, { quality: new Float32Array(c.lat.length).fill(0.7), scenery: new Float32Array(c.lat.length).fill(0.6), conf: new Float32Array(c.lat.length).fill(0.8) });
    const sm = Engine.samples(c, { channels: ch.channels });
    const strong = { ...ch.channels, speed_limit_kph: new Float32Array(c.lat.length).fill(40), density: new Float32Array(c.lat.length).fill(9), sidewalk: new Float32Array(c.lat.length).fill(1),
      road_class: new Float32Array(c.lat.length).fill(6), business_per_km: new Float32Array(c.lat.length).fill(20), access_per_km: new Float32Array(c.lat.length).fill(40), signals_per_km: new Float32Array(c.lat.length).fill(4),
      housing_density: new Float32Array(c.lat.length).fill(1200), impervious_pct: new Float32Array(c.lat.length).fill(60), lu_residential: new Float32Array(c.lat.length).fill(0.9) };
    const sm2 = Engine.samples(c, { channels: strong });
    const none = await Graph.provider.fetch([c], {});
    const viaWorker = await Graph.provider.fetch([c], { graphScore: async (lines) => (await h.handle({ id: 9, type: 'score', lines })).result });
    const biz = viaWorker.g.channels.business_per_km, walk = viaWorker.g.channels.sidewalk;
    return { preTiles: pre.result.tiles.length, loadsAfterPreload, loadsAfterPlan: loads, quickSame: JSON.stringify(q.result.route.edges) === JSON.stringify(quickest.edges), quickTiles: q.result.tiles.length,
      known, outside: Array.from(sc.result[1].quality).every((x) => x == null || Number.isNaN(x)), fillQ: sm.quality[5], fillS: sm.scenery[5], fillC: sm.qConf[5], strongQ: sm2.quality[5], status: ch.status, none: none.g.status,
      roadCh: [Array.from(biz).filter((x) => x === 9).length / biz.length, Array.from(walk).filter((x) => x === 1).length / walk.length] };
  },

  // the Cincinnati-size synthetic network: 16 tiles, ~150k edges; per query and per full plan
  perf() {
    const t0 = Date.now();
    const g = H.grid({ seed: 5, nx: 194, ny: 220, stepDeg: 0.0039, lat0: 39.001, lon0: -84.999, holes: 0.05, oneway: 0.05, signals: 0.1 });
    const T = H.tiles(g.nodes, g.edges);
    const buildMs = Date.now() - t0;
    let t = Date.now();
    const v = R.view(T.tiles);
    const viewMs = Date.now() - t;
    const trips = [[{ lat: 39.15, lon: -84.8 }, { lat: 39.45, lon: -84.45 }], [{ lat: 39.30, lon: -84.62 }, { lat: 39.33, lon: -84.40 }], [{ lat: 39.05, lon: -84.95 }, { lat: 39.6, lon: -84.3 }],
      [{ lat: 39.62, lon: -84.9 }, { lat: 39.2, lon: -84.7 }]];
    const queries = [], plans = [];
    for (const [from, to] of trips) {
      const obj = R.objective(v, {}), src = R.snap(v, from.lat, from.lon), dst = R.snap(v, to.lat, to.lon);
      for (const a of [0, 3, 12]) { t = Date.now(); const r = R.search(v, obj, src, dst, a); queries.push({ a, ms: Date.now() - t, settled: r.settled, km: R.distM(from.lat, from.lon, to.lat, to.lon) / 1000 }); }
      for (const level of ['fun', 'max', 'quick']) { t = Date.now(); const p = R.plan(v, { from, to, level }); plans.push({ level, ms: Date.now() - t, routes: p.routes.length }); }
    }
    return { tiles: T.tiles.length, edges: v.E, nodes: v.N, buildMs, viewMs, queries, plans };
  },
};

(async () => {
  const name = process.argv[2];
  const out = await CASES[name](process.argv[3]);
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
