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
    // a via-way rule: no straight on from South through the North arm to North Road beyond; the way round is the Loop
    const nodesV = nodes.concat([at(C[0] + 2 * d, C[1])]), N2 = nodesV.length - 1, edgesV = edges.slice();
    two(edgesV, N, N2, { ...st, name: 'North Road', t: 30 });
    const ixV = (a, b) => edgesV.findIndex((x) => x.from === a && x.to === b);
    const viaRoute = (rv) => { const vv = R.view(H.tiles(nodesV, edgesV, [], rv).tiles);
      return R.plan(vv, { from: { lat: C[0] - 1.5 * d, lon: C[1] }, to: { lat: C[0] + 1.6 * d, lon: C[1] }, level: 'quick' }).quick.names.map((x) => x.name); };
    const viaFree = viaRoute([]), viaNo = viaRoute([{ from: ixV(S, c), via: [ixV(c, N)], to: ixV(N, N2) }]);
    return { free, noLeft, onlyStraight, ab, ba, viaFree, viaNo, uJunction: uJunction === Infinity ? 'forbidden' : uJunction, uDeadEnd, left, right, straight };
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

  // the levels spend their budgets on better road (the levels audit, 2026-11-08): (1) a plain main road (the quickest), a
  // good road a little way off (inside Fun's budget) and a great road further off (inside Long way's only): Fun takes the
  // near one, Long way the far one. (2) a plain main road and a longer way that's hardly better: neither level lengthens it
  levelSpread() {
    const build = (roads) => {
      const S = [39.35, -84.65], nodes = [at(S[0], S[1]), at(S[0], S[1] + 0.06)], edges = [];
      const via = (pts, props) => { const ids = pts.map((p) => { nodes.push(at(p[0], p[1])); return nodes.length - 1; }); const c = [0, ...ids, 1]; for (let k = 0; k + 1 < c.length; k++) two(edges, c[k], c[k + 1], props(k)); };
      const wig = (dLat, n, w) => Array.from({ length: n }, (_, k) => [S[0] + dLat + (k % 2 ? w : -w), S[1] + 0.06 * (k + 1) / (n + 1)]);
      for (const r of roads) via(wig(r.dLat, r.n, r.w), (k) => ({ name: r.name, quality: r.quality, scenery: r.scenery, fun: r.fun, conf: 1, cls: r.cls, t: r.t, ...(r.seg ? r.seg(k) : {}) }));
      nodes.push(at(S[0], S[1] - 0.004), at(S[0], S[1] + 0.064));
      two(edges, nodes.length - 2, 0, { name: 'Start Lane', t: 30 }); two(edges, 1, nodes.length - 1, { name: 'End Lane', t: 30 });
      const v = R.view(H.tiles(nodes, edges).tiles);
      const from = { lat: S[0], lon: S[1] - 0.002 }, to = { lat: S[0], lon: S[1] + 0.062 };
      const out = {};
      for (const level of ['quick', 'fun', 'max']) {
        const p = R.plan(v, { from, to, level }), b = p.routes[0];
        out[level] = { best: [...new Set(b.names.map((n) => n.name).filter((n) => n && !/Lane$/.test(n)))], timeS: b.timeS, quickS: p.quick.timeS, limitS: p.limitS,
          goodness: b.why.goodness, role: b.why.role, all: p.routes.map((r) => [...new Set(r.names.map((n) => n.name).filter((n) => n && !/Lane$/.test(n)))].join('+')),
          goods: p.routes.map((r) => r.why.goodness) };
      }
      return out;
    };
    // (1) Main Street 600 s; Mill Road 830 s (+38 %, inside Fun's 1090 s); Ridge Road 1350 s (inside Long way's 1797 s
    // only), the best road here but reached over 15 s of rough lane (Ridge Gap), the stretch t x exp(a x bad) shuns at
    // every weight: before the spread and the pick, Long way came back with Fun's Mill Road
    const spread = build([
      { name: 'Main Street', dLat: 0, n: 9, w: 0.0001, quality: 0.3, scenery: 0.2, fun: 0, cls: 3, t: 60 },
      { name: 'Mill Road', dLat: 0.008, n: 9, w: 0.0008, quality: 0.65, scenery: 0.55, fun: 1, cls: 4, t: 83 },
      { name: 'Ridge Road', dLat: -0.02, n: 9, w: 0.0015, quality: 0.9, scenery: 0.85, fun: 3, cls: 4, t: 145,
        seg: (k) => (k === 4 ? { name: 'Ridge Gap', quality: 0.1, scenery: 0.2, fun: 0, cls: 6, t: 15 } : {}) },
    ]);
    // (2) Main Street 600 s; Elm Drive 800 s (+33 %), a plain residential street hardly better
    const none = build([
      { name: 'Main Street', dLat: 0, n: 9, w: 0.0001, quality: 0.3, scenery: 0.2, fun: 0, cls: 3, t: 60 },
      { name: 'Elm Drive', dLat: 0.008, n: 9, w: 0.0008, quality: 0.31, scenery: 0.25, fun: 0, cls: 5, t: 80 },
    ]);
    return { spread, none };
  },

  // the pick weighs the road's length as the route engine does (2026-11-08, engine-rank): route summaries shaped like the
  // levels audit's public trips (minutes, km, G, km of side street and of good road on the tiles' quality)
  levelRoad() {
    const r = (name, min, km, G, poorKm, goodKm) => ({ name, timeS: min * 60, distM: km * 1000, why: { goodness: G, poorKm, goodKm } });
    const trips = {
      // the 17 and 22 min ways have the higher G, bought with more subdivision than the 12 min way drives
      subdivisionLike: { limit: { fun: 16.6, max: 27.8 }, routes: [r('base', 9.4, 6.8, 0.204, 4.74, 0.1), r('A', 12.0, 9.1, 0.262, 3.26, 0.5),
        r('B', 17.2, 13.2, 0.323, 5.79, 2.66), r('C', 22.1, 17.8, 0.339, 5.48, 4.21)] },
      // B's G is a strip mall's; C is 11 km more of the best road for no more side street than the quickest's
      colerainLike: { limit: { fun: 24.5, max: 38.8 }, routes: [r('base', 16.7, 12.8, 0.301, 4.40, 3.8), r('A', 17.4, 13.8, 0.313, 3.40, 4.17),
        r('B', 19.6, 15.2, 0.340, 4.46, 7.46), r('C', 31.6, 27.0, 0.403, 4.47, 14.57)] },
      // at Long way D's 10 more min buy little G but 10 km more good road
      harrisonLike: { limit: { fun: 32.8, max: 50.6 }, routes: [r('base', 24.1, 22.8, 0.414, 0.77, 17.61), r('A', 31.1, 30.3, 0.454, 0.76, 27.74),
        r('B', 31.6, 31.2, 0.469, 1.48, 24.70), r('D', 41.9, 41.4, 0.478, 0.75, 37.52)] },
      // no good road: the longer ways are hardly better
      noGoodRoad: { limit: { fun: 11.2, max: 20.1 }, routes: [r('base', 5.3, 3.2, 0.2, 2.32, 0), r('A', 8.7, 5.8, 0.253, 2.40, 0.36), r('B', 11.6, 8.0, 0.263, 2.90, 0.40)] },
    };
    const out = {};
    for (const [k, t] of Object.entries(trips)) out[k] = Object.fromEntries(['fun', 'max'].map((lv) => [lv, R.pick(t.routes[0], t.routes, t.limit[lv] * 60, R.K.BUY[lv]).name]));
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

  // members' data without waiting on the network (own_routing.js crowdSoon): a slow server gives the plan nothing within
  // the budget and the whole answer after (to plan again with); the cells are then kept, and the next plan over them
  // has the data at once without asking; a way is kept in each cell its line meets
  async crowdSoon() {
    const line = [[39.255, -84.62], [39.262, -84.58]];                 // crosses cells 392_-847 and 392_-846
    const answer = { ways: { 9: { 0: { i: [0, 1], n: [3, 3], rough: [0.05, 0.05], fl: [0.9, 0.9], hb: [0, 0], fn: [3, 3], ag: 2 } } }, lines: { 9: line } };
    const asked = [];
    const slow = (cells) => { asked.push(cells.slice()); return new Promise((r) => setTimeout(() => r(answer), 120)); };
    const from = { lat: 39.25, lon: -84.63 }, to = { lat: 39.27, lon: -84.57 };
    const t0 = Date.now(), a = Own.crowdSoon(slow, from, to, 30), now = await a.now, nowMs = Date.now() - t0, late = await a.late;
    const t1 = Date.now(), b = Own.crowdSoon(slow, from, to, 30), now2 = await b.now, now2Ms = Date.now() - t1, late2 = await b.late;
    const kept = ['392_-847', '392_-846'].map((c) => Object.keys((Own._cells.get(c) || { ways: {} }).ways).length);
    const off = Own.crowdSoon(undefined, from, to);
    return { now, nowMs, late: late ? late.length : null, now2: now2 ? now2.length : null, now2Ms, late2, asks: asked.length, kept, off: await off.now };
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

  // loops off the highway (the owner, 2026-11-04: "it also seems to route mostly highway for loops"): a grid whose every
  // fourth row and column is a motorway, fast and good road with no corners; each level's loops, their motorway share
  // and how they were built (from the best roads, not a ring)
  loopsOffHighway() {
    const g = H.grid({ seed: 11, nx: 40, ny: 40, holes: 0.03, stepDeg: 0.004, lat0: 39.15, lon0: -84.62, motorway: true });
    const v = R.view(H.tiles(g.nodes, g.edges).tiles);
    const start = { lat: 39.23, lon: -84.52 };
    const out = {};
    for (const level of ['quick', 'fun', 'max']) {
      const res = R.loop(v, { start, km: 24, level });
      out[level] = res.routes.map((r) => {
        let hw = 0, all = 0;
        for (const e of r.edgeIdx) { all += v.len[e]; if (v.cls[e] <= 1) hw += v.len[e]; }
        return { hwy: hw / all, km: r.distM / 1000, kind: r.kind || null, retraced: r.retraced, d0: R.distM(start.lat, start.lon, r.coords[0][0], r.coords[0][1]), dN: R.distM(start.lat, start.lon, r.coords[r.coords.length - 1][0], r.coords[r.coords.length - 1][1]) };
      });
    }
    return out;
  },

  // the levels (the owner, 2026-11-08: "fun should never go on the highway. Quick should essentially be a normal route"):
  // (1) a motorway and a trunk road beside a back road: Quick on the highway, Fun and Long way never (plan, quickest,
  // through); (2) a river crossed only by an interstate bridge: the shortest highway link, said why; (3) a highway-free
  // way over twice the quickest's time: still no highway, flagged absurd; (4) Quick's plan inside a minute of the quickest
  levelsHighway() {
    const MW = 64 | 1, RAMP = 128 | 1;
    const hwyM = (v, r) => { let m = 0; for (const e of r.edgeIdx) if (v.cls[e] <= 1) m += v.len[e]; return m; };
    const names = (r) => [...new Set(r.names.map((n) => n.name).filter(Boolean))];
    const out = {};
    // (1) S -> T 9 km east: I-74 (motorway, ramps at both ends), US-52 (trunk, north), Back Road (curvy, good, slower)
    {
      const S = [39.40, -84.70], nodes = [at(S[0], S[1] - 0.004), at(S[0], S[1]), at(S[0], S[1] + 0.105), at(S[0], S[1] + 0.109)], edges = [];
      const [s0, A, B, t0] = [0, 1, 2, 3];
      two(edges, s0, A, { name: 'Start Lane', t: 30, cls: 5 }); two(edges, B, t0, { name: 'End Lane', t: 30, cls: 5 });
      const chain = (pts, props) => { const ids = pts.map((p) => { nodes.push(at(p[0], p[1])); return nodes.length - 1; }); const c = [A, ...ids, B];
        for (let k = 0; k + 1 < c.length; k++) { const pr = props(k, c.length - 1); edges.push({ from: c[k], to: c[k + 1], ...pr }); if (!(pr.flags & 1)) edges.push({ from: c[k + 1], to: c[k], ...pr }); } };
      // the motorway one-way eastbound (a ramp on, the motorway, a ramp off), at 31 m/s
      chain([[S[0] - 0.003, S[1] + 0.004], [S[0] - 0.003, S[1] + 0.101]], (k, n) => (k === 0 || k === n - 1 ? { name: 'I-74 ramp', cls: 0, flags: RAMP, quality: 0.7, fun: 0, t: 25 } : { name: 'I-74', cls: 0, flags: MW, quality: 0.82, fun: 0, t: 270 }));
      chain([[S[0] + 0.01, S[1] + 0.02], [S[0] + 0.01, S[1] + 0.085]], (k) => ({ name: 'US-52', cls: 1, quality: 0.75, fun: 0, t: k === 1 ? 300 : 70 }));
      const wig = Array.from({ length: 9 }, (_, k) => [S[0] - 0.012 + (k % 2 ? 0.0012 : -0.0012), S[1] + 0.105 * (k + 1) / 10]);
      chain(wig, () => ({ name: 'Back Road', cls: 4, quality: 0.85, scenery: 0.8, fun: 2.5, t: 60 }));
      const v = R.view(H.tiles(nodes, edges).tiles);
      const from = { lat: S[0], lon: S[1] - 0.002 }, to = { lat: S[0], lon: S[1] + 0.107 };
      out.one = {};
      for (const level of ['quick', 'fun', 'max']) {
        const p = R.plan(v, { from, to, level }), q = R.quickest(v, { from, to, level }), th = R.through(v, { from, to, level });
        out.one[level] = { best: names(p.routes[0]), bestHwyM: hwyM(v, p.routes[0]), hwyKm: p.routes[0].hwyKm, quickHwyM: hwyM(v, p.quick), mode: p.hwy.mode,
          others: p.routes.filter((r) => r !== p.quick).map((r) => hwyM(v, r)), hasQuick: p.routes.includes(p.quick), quickest: names(q), quickestHwyM: hwyM(v, q), throughHwyM: hwyM(v, th),
          timeS: p.routes[0].timeS, quickS: p.quick.timeS, limitS: p.limitS, times: p.routes.map((r) => r.timeS) };
      }
    }
    // (2) a river at lon -84.65: the only way across is I-275's bridge (ramp, bridge, ramp). I-275 also runs on from the
    // start to the bridge (quicker than River Road): Quick drives it all; Fun only the bridge and its ramps
    {
      const y = 39.50, nodes = [], edges = [];
      const n = (lat, lon) => { nodes.push(at(lat, lon)); return nodes.length - 1; };
      const s0 = n(y, -84.704), S = n(y, -84.70), W1 = n(y + 0.004, -84.66), MW = n(y + 0.004, -84.655), ME = n(y + 0.004, -84.645), E1 = n(y + 0.004, -84.64), T = n(y, -84.60), t0 = n(y, -84.596);
      const MS = n(y + 0.002, -84.698);
      two(edges, s0, S, { name: 'Start Lane', t: 30, cls: 5 }); two(edges, T, t0, { name: 'End Lane', t: 30, cls: 5 });
      two(edges, S, W1, { name: 'River Road', cls: 4, quality: 0.8, fun: 1, t: 300 });
      two(edges, E1, T, { name: 'Ridge Road', cls: 4, quality: 0.8, fun: 1, t: 300 });
      // ramps and the bridge both ways
      for (const [a, b] of [[W1, MW], [ME, E1]]) two(edges, a, b, { name: 'I-275 ramp', cls: 0, flags: 128, quality: 0.7, fun: 0, t: 20 });
      two(edges, MW, ME, { name: 'I-275', cls: 0, flags: 64, quality: 0.82, fun: 0, t: 30 });
      // I-275 from near the start to the bridge: quicker than River Road
      two(edges, S, MS, { name: 'I-275 ramp', cls: 0, flags: 128, quality: 0.7, fun: 0, t: 15 });
      two(edges, MS, MW, { name: 'I-275', cls: 0, flags: 64, quality: 0.82, fun: 0, t: 120 });
      const v = R.view(H.tiles(nodes, edges).tiles);
      const from = { lat: y, lon: -84.702 }, to = { lat: y, lon: -84.598 };
      out.river = {};
      for (const level of ['quick', 'fun', 'max']) {
        const p = R.plan(v, { from, to, level }), b = p.routes[0];
        out.river[level] = { mode: p.hwy.mode, hwyKm: b.hwyKm, hwyName: b.route.hwyName, reason: b.route.hwyReason || null, names: names(b), quickHwyKm: p.quick.hwyKm,
          others: p.routes.filter((r) => r !== p.quick).map((r) => +r.hwyKm.toFixed(3)) };
      }
      // a car on I-275 (heading east, on the motorway before the bridge) rerouted at Fun: off it by the shortest way
      const th = R.through(v, { from: { lat: y + 0.0025, lon: -84.69, heading: 75 }, to, level: 'fun' });
      out.river.onIt = { reason: th.route.hwyReason || null, hwyKm: th.hwyKm };
      // what the card says, from the ranking's marks on the pick (route_engine.js whyHighway)
      const F = FunRoute, E = require('../web/route_engine.js');
      const pf = R.plan(v, { from, to, level: 'fun' });
      const cands = pf.routes.map((r, i) => ({ id: i, timeS: r.timeS, route: r.route, extraS: 0 }));
      const ranked = F.rank(cands, 'fun');
      out.river.rankHwy = ranked.map((c) => +c.route.hwyKm.toFixed(3));
      out.river.why = (E.whyHighway(ranked[0], { metric: false }) || {}).text || null;
    }
    // (3) the only highway-free way is a long way round (Loop Road, about 2.6 x the motorway's time)
    {
      const y = 39.60, nodes = [], edges = [];
      const n = (lat, lon) => { nodes.push(at(lat, lon)); return nodes.length - 1; };
      const s0 = n(y, -84.704), S = n(y, -84.70), T = n(y, -84.60), t0 = n(y, -84.596), L1 = n(y + 0.03, -84.68), L2 = n(y + 0.03, -84.62);
      two(edges, s0, S, { name: 'Start Lane', t: 30, cls: 5 }); two(edges, T, t0, { name: 'End Lane', t: 30, cls: 5 });
      two(edges, S, T, { name: 'I-71', cls: 0, flags: 64, quality: 0.82, fun: 0, t: 280 });
      two(edges, S, L1, { name: 'Loop Road', cls: 4, quality: 0.7, fun: 1, t: 300 }); two(edges, L1, L2, { name: 'Loop Road', cls: 4, quality: 0.7, fun: 1, t: 300 }); two(edges, L2, T, { name: 'Loop Road', cls: 4, quality: 0.7, fun: 1, t: 300 });
      const v = R.view(H.tiles(nodes, edges).tiles);
      const from = { lat: y, lon: -84.702 }, to = { lat: y, lon: -84.598 };
      const p = R.plan(v, { from, to, level: 'fun' }), b = p.routes[0];
      const cands = p.routes.map((r, i) => ({ id: i, timeS: r.timeS, route: r.route }));
      const ranked = FunRoute.rank(cands, 'fun'), E = require('../web/route_engine.js');
      out.absurd = { absurd: p.hwy.absurd, mode: p.hwy.mode, hwyKm: b.hwyKm, names: names(b), ratio: b.timeS / p.quick.timeS, routes: p.routes.length,
        rankHwy: ranked.map((c) => c.route.hwyKm), rankAbsurd: ranked.map((c) => !!c.hwyAbsurd), why: (E.whyHighway(ranked[0]) || {}).text || null,
        quickPick: FunRoute.rank(cands, 'quick')[0].route.hwyKm };
    }
    // (4) Quick on the city grid: the plan's budget is the quickest + 60 s, every route inside it
    {
      const g = H.grid({ seed: 3, nx: 30, ny: 30, holes: 0.05, oneway: 0.05, signals: 0.15, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
      const v = R.view(H.tiles(g.nodes, g.edges).tiles);
      const p = R.plan(v, { from: { lat: 39.152, lon: -84.618 }, to: { lat: 39.262, lon: -84.48 }, level: 'quick' });
      out.quick = { limitS: p.limitS, quickS: p.quick.timeS, over: Math.max(...p.routes.map((r) => r.timeS)) - p.quick.timeS, mode: p.hwy.mode };
    }
    return out;
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

  // Best roads nearby from our tiles never lists a neighbourhood street, even one the tile's quality calls good (a v1
  // tile, a stale model), nor a road that only leads to its own dead end; a country lane tagged "residential" (TIGER) with
  // no houses beside it stays. The owner's report: the top pick was a residential neighbourhood.
  exploreRoads() {
    const g = H.grid({ seed: 6, nx: 12, ny: 12, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    for (const e of g.edges) { e.fun = 0; e.quality = 0.5; }
    // the frontage of each road, per edge (v2 tiles' road channels): plain suburban by default
    const ch = g.edges.map(() => ({ addr: 12, bldg: 20, density: 3 }));
    g.edges.forEach((e, k) => {
      if (e.name === 'Row 6') { e.fun = 3; e.quality = 0.85; e.cls = 4; e.name = 'Twisty Road'; ch[k] = { addr: 6, bldg: 10, density: 2 }; }
      // a curvy subdivision street the model scored well: more corners than the back road, houses every 15 m
      if (e.name === 'Col 3') { e.fun = 4; e.quality = 0.7; e.cls = 6; e.name = 'Maple Court'; ch[k] = { addr: 70, bldg: 90, density: 7 }; }
      // a county lane tagged residential in open country
      if (e.name === 'Col 8') { e.fun = 3; e.quality = 0.8; e.cls = 6; e.name = 'Creek Lane'; ch[k] = { addr: 0, bldg: 2, density: 1 }; }
    });
    // a good twisty road off the grid's east edge that goes nowhere: 3 legs of about 430 m (1.3 km) to a dead end; and the
    // twisty road itself runs on past its last junction into a 900 m dead-end spur
    const east = 11 + 2 * 12, base = g.nodes.length;
    for (let k = 1; k <= 3; k++) g.nodes.push({ lat: g.nodes[east].lat + (k % 2 ? 0.0006 : -0.0006), lon: g.nodes[east].lon + k * 0.005, flags: 0 });
    for (let k = 0; k < 3; k++) {
      const a = k === 0 ? east : base + k - 1, b = base + k;
      for (const [from, to] of [[a, b], [b, a]]) { g.edges.push({ from, to, fun: 3.5, quality: 0.9, cls: 4, name: 'Spur Road', scenery: 0.6, conf: 1 }); ch.push({ addr: 2, bldg: 4, density: 1 }); }
    }
    const end6 = 11 + 6 * 12, base3 = g.nodes.length;
    for (let k = 1; k <= 2; k++) g.nodes.push({ lat: g.nodes[end6].lat + (k % 2 ? 0.0004 : 0), lon: g.nodes[end6].lon + k * 0.0052, flags: 0 });
    for (let k = 0; k < 2; k++) {
      const a = k === 0 ? end6 : base3 + k - 1, b = base3 + k;
      for (const [from, to] of [[a, b], [b, a]]) { g.edges.push({ from, to, fun: 3, quality: 0.85, cls: 4, name: 'Twisty Road', scenery: 0.6, conf: 1 }); ch.push({ addr: 6, bldg: 10, density: 2 }); }
    }
    // a long twisty rural road off the west edge that also ends: 9 legs of about 430 m (3.9 km), worth driving there and back
    const west = 0 + 9 * 12, base2 = g.nodes.length;
    for (let k = 1; k <= 9; k++) g.nodes.push({ lat: g.nodes[west].lat + (k % 2 ? 0.0006 : -0.0006), lon: g.nodes[west].lon - k * 0.005, flags: 0 });
    for (let k = 0; k < 9; k++) {
      const a = k === 0 ? west : base2 + k - 1, b = base2 + k;
      for (const [from, to] of [[a, b], [b, a]]) { g.edges.push({ from, to, fun: 2, quality: 0.8, cls: 5, name: 'Long Hollow Road', scenery: 0.6, conf: 1 }); ch.push({ addr: 2, bldg: 4, density: 1 }); }
    }
    const T = H.tiles(g.nodes, g.edges);
    for (const t of T.tiles) t.edges.ch = { addr_per_km: new Float32Array(t.edges.count).fill(NaN), bldg_per_km: new Float32Array(t.edges.count).fill(NaN), density: new Float32Array(t.edges.count).fill(NaN) };
    g.edges.forEach((e, k) => {
      const [key, li] = T.edgeAt.get(k), t = T.tiles.find((x) => `${x.tile.i}_${x.tile.j}` === key);
      t.edges.ch.addr_per_km[li] = ch[k].addr; t.edges.ch.bldg_per_km[li] = ch[k].bldg; t.edges.ch.density[li] = ch[k].density;
    });
    const v = R.view(T.tiles);
    const res = R.explore(v, { start: { lat: 39.172, lon: -84.6 }, maxKm: 10, maxS: 1800 });
    // the same subdivision in a v1 tile (no road channels): nothing known beside it, so only the tile's quality decides
    const v1 = R.view(H.tiles(g.nodes, g.edges).tiles);
    const res1 = R.explore(v1, { start: { lat: 39.172, lon: -84.6 }, maxKm: 10, maxS: 1800 });
    const lh = res.stages.find((s) => s.name === 'Long Hollow Road');
    // loops (graph_router.js loop, built from explore's stages) take neither the subdivision nor the out-and-back road
    const lp = R.loop(v, { start: { lat: 39.172, lon: -84.6 }, km: 12, level: 'fun' }).routes;
    const loopStages = [...new Set(lp.flatMap((r) => r.stages || []))];
    const tw = res.stages.find((s) => s.name === 'Twisty Road'), lastLon = g.nodes[end6].lon;
    const twEnds = tw ? [tw.lon[0], tw.lon[tw.lon.length - 1]] : [];
    return { loopStages, loops: lp.length, spurCut: !!tw && Math.max(...twEnds) <= lastLon + 0.0005, twistyKm: tw && +tw.km.toFixed(2),
      longHollow: lh ? { km: +lh.km.toFixed(2), deadEnd: !!lh.deadEnd } : null, names: res.stages.map((s) => s.name), first: res.stages[0] && res.stages[0].name, v1names: res1.stages.map((s) => s.name),
      street: R.streetEdge && FunRoute.streetSample ? [R.streetEdge(v, v.name.findIndex((_, e) => v.cls[e] === 6 && v.roadCh.addr_per_km[e] === 70)), FunRoute.streetSample({ cls: 6, addr: 0, bldg: 2, density: 1 }), FunRoute.streetSample({ cls: 6 })] : null };
  },

  // Best roads nearby on the real Cincinnati tiles (web/data/graph/v1) at two public places: the map's own stage search
  // (stages.js, saved in tests/fixtures/best_roads from OpenFreeMap) ranked by the route engine with our tiles' context,
  // as cockpit.js exploreNear does where the tiles cover you, and our tiles' own search. A neighbourhood is told by our
  // tiles along the stage: the area's density 6 or more and a house every 25 m (40 addresses per km), or mostly
  // residential class with that many houses.
  bestRoadsReal() {
    globalThis.ApexFunRoute = FunRoute; globalThis.ApexCore = require('../web/apex_core.js');
    const Graph = require('../web/route_ctx/graph.js'), Engine = require('../web/route_engine.js'), T = require('../web/graph_tiles.js');
    const dir = path.join(ROOT, 'web/data/graph/v1');
    const tiles = fs.readdirSync(dir).filter((f) => f.endsWith('.vgr')).map((f) => { const b = fs.readFileSync(path.join(dir, f)); return T.decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); });
    const v = R.view(tiles);
    const what = (s) => {
      const sc = R.scoreLine(v, s.lat, s.lon);
      let n = 0, res = 0, addr = 0, an = 0, dens = 0, dn = 0;
      for (let i = 0; i < s.lat.length; i++) {
        if (!Number.isFinite(sc.cls[i])) continue;
        n++; if (sc.cls[i] >= 6) res++;
        const a = sc.ch.addr_per_km[i], d = sc.ch.density[i];
        if (Number.isFinite(a)) { addr += a; an++; }
        if (Number.isFinite(d)) { dens += d; dn++; }
      }
      const A = an ? addr / an : null, D = dn ? dens / dn : null, R6 = n ? res / n : 0;
      return { name: s.name, addr: A && Math.round(A), density: D && +D.toFixed(1), residential: +R6.toFixed(2),
        neighbourhood: A != null && A >= 40 && ((D != null && D >= 6) || R6 >= 0.5) };
    };
    const out = {};
    for (const place of ['devou_park', 'mount_airy_forest']) {
      const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'best_roads', `${place}.json`), 'utf8'));
      const stages = fx.stages.map((s) => ({ ...s }));
      const cs = Engine.stageCorridors(stages, 12, { departAt: Date.parse('2026-11-04T14:00:00-05:00') }), byId = {};
      for (const c of cs) byId[c.id] = Graph.channelsOf(c.lat.length, R.scoreLine(v, Array.from(c.lat), Array.from(c.lon)));
      const ranked = [...Engine.rescoreStages(stages.slice(0, 12), byId), ...stages.slice(12)];
      const list = FunRoute.exploreShortlist(fx.start, ranked, fx.maxKm, 12).map(what);
      const own = R.explore(v, { start: fx.start, maxKm: fx.maxKm, maxS: fx.minutes * 60, max: 12 }).stages.map(what);
      out[place] = { list, own, dropped: ranked.filter((s) => s.notRoad).map((s) => [s.name, s.notRoad]) };
    }
    return out;
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
    // our own route's per-edge table (route.graph) laid on its corridor on the page, no worker: the same scores
    const own = p.result.routes[0], oc = Ctx.corridor('o', Own.withCoords({ ...own.route }).coords, {});
    oc.graph = own.route.graph;
    const local = await Graph.provider.fetch([oc], {}), remote = await Graph.provider.fetch([{ ...oc, graph: null, id: 'o' }], { graphScore: async (lines) => (await h.handle({ id: 10, type: 'score', lines })).result });
    const lq = local.o.channels.graph_quality, rq = remote.o.channels.graph_quality;
    let agree = 0; for (let i = 0; i < lq.length; i++) if (Math.abs(lq[i] - rq[i]) < 1e-6) agree++;
    const tableAgree = agree / lq.length;
    return { preTiles: pre.result.tiles.length, loadsAfterPreload, loadsAfterPlan: loads, quickSame: JSON.stringify(q.result.route.edges) === JSON.stringify(quickest.edges), quickTiles: q.result.tiles.length,
      known, outside: Array.from(sc.result[1].quality).every((x) => x == null || Number.isNaN(x)), fillQ: sm.quality[5], fillS: sm.scenery[5], fillC: sm.qConf[5], strongQ: sm2.quality[5], status: ch.status, none: none.g.status,
      tableAgree, tableStatus: local.o.status, roadCh: [Array.from(biz).filter((x) => x === 9).length / biz.length, Array.from(walk).filter((x) => x === 1).length / walk.length] };
  },

  // points routed on our tiles (a reroute along the planned route's points, a stage, a shared road; own_routing.js
  // through): through every via in order, the quickest between them, joined where each leg arrived; no via = the quickest;
  // the worker's 'through' message and the page's side (coverage first: a point off the tiles gives null, Valhalla's turn)
  async through() {
    const g = H.grid({ seed: 4, nx: 12, ny: 12, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    const T = H.tiles(g.nodes, g.edges), v = R.view(T.tiles);
    const from = { lat: 39.155, lon: -84.615 }, to = { lat: 39.19, lon: -84.57 }, via = { lat: 39.19, lon: -84.61 };
    const direct = R.through(v, { from, to, level: 'quick' }), quick = R.quickest(v, { from, to, level: 'quick' });
    const bent = R.through(v, { from, to, via: [via], level: 'quick' });
    const near = (r, p) => Math.min(...r.coords.map(([la, lo]) => R.distM(la, lo, p.lat, p.lon)));
    const env = { load: async (i, j) => T.tiles.find((t) => t.tile.i === i && t.tile.j === j) || null, index: async () => ({ tiles: Object.fromEntries(T.tiles.map((t) => [`${t.tile.i}_${t.tile.j}`, {}])) }) };
    const h = R.host(env);
    const msg = await h.handle({ id: 1, type: 'through', from, to, via: [via], level: 'quick' });
    const keys = new Set(T.tiles.map((t) => `${t.tile.i}_${t.tile.j}`));
    const client = { covers: async (pts) => R.covers(keys, pts), through: async (req) => (await h.handle({ id: 2, type: 'through', ...req })).result };
    const page = await Own.through(client, [from, via, to]), off = await Own.through(client, [from, { lat: 41, lon: -84 }]);
    return { sameAsQuickest: JSON.stringify(direct.edges) === JSON.stringify(quick.edges), viaNear: near(bent, via), toNear: near(bent, to), longer: bent.timeS > direct.timeS,
      worker: msg.result && msg.result.route ? msg.result.route.edges.length === bent.edges.length : false,
      page: page ? { source: page.source, n: page.coords.length, steps: page.steps.length, first: page.coords[0], timeS: page.timeS > 0 } : null, off };
  },

  // the plan reuses the first route's time-only search when it is asked on the same view for the same trip (graph_router.js
  // quickKey): the same routes as a plan on a fresh view, and a different trip or avoid choice doesn't reuse it
  quickMemo() {
    const g = H.grid({ seed: 7, nx: 14, ny: 14, holes: 0.1, oneway: 0.1, signals: 0.2, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    const T = H.tiles(g.nodes, g.edges);
    const key = (p) => JSON.stringify(p.routes.map((r) => [r.edges, +r.timeS.toFixed(6), r.why.role, r.why.a]));
    const reqs = [{ from: { lat: 39.152, lon: -84.617 }, to: { lat: 39.2, lon: -84.57 }, level: 'fun' },
      { from: { lat: 39.152, lon: -84.617, heading: 90 }, to: { lat: 39.2, lon: -84.57 }, level: 'max', avoid: { highways: true } },
      { from: { lat: 39.19, lon: -84.6 }, to: { lat: 39.155, lon: -84.575 }, level: 'quick', prefs: { tight: 1 } }];
    const out = reqs.map((req) => {
      const v = R.view(T.tiles);
      R.quickest(v, req);
      const hit = v.quickMemo && v.quickMemo.key;
      const reused = key(R.plan(v, req)), fresh = key(R.plan(R.view(T.tiles), req));
      return { same: reused === fresh, memo: !!hit };
    });
    // another trip on the same view: not the memo's
    const v = R.view(T.tiles);
    R.quickest(v, reqs[0]);
    const other = key(R.plan(v, { ...reqs[0], avoid: { highways: true } })) === key(R.plan(R.view(T.tiles), { ...reqs[0], avoid: { highways: true } }));
    return { out, other };
  },

  // posted limits on our routes from the tiles they were planned on (own_routing.js limitsAlong: the limit sign and the
  // ETA offline, no map matching): each 5 m sample of the track gets its edge's posted limit; an edge with no posted limit
  // (unknown, or only the class's estimate) is null; a track with a stretch cut out (a loop's spur) still finds its place;
  // a route without the table (Valhalla's) gets nothing
  limits() {
    const Core = require('../web/apex_core.js');
    const g = H.grid({ seed: 4, nx: 12, ny: 12, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    const T = H.tiles(g.nodes, g.edges);
    for (const t of T.tiles) for (let e = 0; e < t.edges.count; e++) {
      t.edges.speed[e] = e % 7 === 0 ? 0 : 30 + 10 * (e % 5);
      if (e % 11 === 0 && t.edges.speed[e]) t.edges.flags[e] |= R.FLAG_BITS.speedEst;
    }
    const v = R.view(T.tiles);
    const r = R.quickest(v, { from: { lat: 39.155, lon: -84.615 }, to: { lat: 39.19, lon: -84.57 }, level: 'quick' });
    const route = Own.withCoords({ ...r.route });
    const rs = Core.resamplePolyline(route.coords.map((c) => c[1]), route.coords.map((c) => c[0]), 5);
    const got = Own.limitsAlong(rs.lat, rs.lon, route);
    // the truth: each sample's edge by metres along the router's own line, away from the edges' ends
    const g2 = route.graph, along = rs.lat.map((_, i) => i * 5);
    let agree = 0, n = 0, posted = 0, nulls = 0, wantNull = 0;
    along.forEach((m, i) => {
      let k = 0; while (k < g2.end.length - 1 && g2.end[k] < m) k++;
      if (Math.abs(g2.end[k] - m) < 15 || (k > 0 && Math.abs(g2.end[k - 1] - m) < 15)) return;
      const want = Number.isFinite(g2.limit[k]) && g2.limit[k] > 0 ? g2.limit[k] / 3.6 : null;
      n++; if (want == null) wantNull++;
      if ((want == null && got[i] == null) || (want != null && got[i] != null && Math.abs(want - got[i]) < 1e-6)) agree++;
    });
    got.forEach((x) => { if (x == null) nulls++; else posted++; });
    // a stretch cut out of the middle, as removeSpurs does to a loop
    const cut = [...rs.lat.keys()].filter((i) => i < 100 || i > 160);
    const got2 = Own.limitsAlong(cut.map((i) => rs.lat[i]), cut.map((i) => rs.lon[i]), route);
    const sameCut = cut.every((i, k) => got2[k] === got[i]);
    const est = Array.from(g2.limitEst).filter(Number.isFinite).length;
    return { samples: rs.lat.length, n, agree, posted, nulls, wantNull, est, sameCut, noTable: Own.limitsAlong(rs.lat, rs.lon, { coords: route.coords }),
      ofLine: Own.routeOfLine(route.coords) === route, notOurs: Own.routeOfLine([[0, 0], [1, 1]]) };
  },

  // each planned route's light geometry made in the worker (graph_router.js host 'plan'): the page's own function on the
  // same line, so the ranking scores the same corners; without apex_core.js in the worker, none (made on the page)
  async geo() {
    const g = H.grid({ seed: 4, nx: 12, ny: 12, stepDeg: 0.004, lat0: 39.15, lon0: -84.62 });
    const T = H.tiles(g.nodes, g.edges);
    const env = { load: async (i, j) => T.tiles.find((t) => t.tile.i === i && t.tile.j === j) || null, index: async () => ({ tiles: Object.fromEntries(T.tiles.map((t) => [`${t.tile.i}_${t.tile.j}`, {}])) }) };
    const from = { lat: 39.155, lon: -84.615 }, to = { lat: 39.19, lon: -84.57 };
    const bare = await R.host(env).handle({ id: 1, type: 'plan', from, to, level: 'fun' });
    globalThis.ApexCore = require('../web/apex_core.js');
    const res = await R.host(env).handle({ id: 2, type: 'plan', from, to, level: 'fun' });
    const same = res.result.routes.map((r) => {
      const page = FunRoute.geometry(Own.withCoords({ ...r.route }).coords, globalThis.ApexCore);
      return r.geo && r.geo.lat.length === page.lat.length && Array.from(r.geo.lat).every((x, i) => x === page.lat[i]) && Array.from(r.geo.lon).every((x, i) => x === page.lon[i])
        && JSON.stringify(r.geo.events) === JSON.stringify(page.events);
    });
    return { bare: bare.result.routes.every((r) => !r.geo), n: same.length, same: same.every(Boolean), corners: res.result.routes[0].geo.events.length };
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
