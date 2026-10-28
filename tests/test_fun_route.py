"""Fun A→B routing (web/fun_route.js) on synthetic roads: no network, deterministic."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const root = process.argv[1];
globalThis.ApexCore = require(root + '/web/apex_core.js');
const F = require(root + '/web/fun_route.js');
const lat0 = 39.2, lon0 = -84.6, mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const ll = (pts) => pts.map(([x, y]) => [lon0 + x * mLon, lat0 + y * mLat]);
const P = (x, y) => ({ lat: lat0 + y * mLat, lon: lon0 + x * mLon });
const straight = (len) => ll(Array.from({ length: len / 10 + 1 }, (_, i) => [i * 10, 0]));
// S-bends: amplitude 60 m, wavelength 400 m (a good corner every 200 m)
const wiggly = (len) => ll(Array.from({ length: len / 5 + 1 }, (_, i) => [i * 5, 60 * Math.sin(2 * Math.PI * i * 5 / 400)]));
// Town grid: 400 m blocks with a right-angle turn at each junction (staircase)
const stair = (blocks) => { const pts = [[0, 0]]; for (let b = 0; b < blocks; b++) { const [x, y] = pts[pts.length - 1]; for (let k = 1; k <= 40; k++) pts.push(b % 2 ? [x, y + k * 10] : [x + k * 10, y]); } return ll(pts); };
const out = {};
const g = (c) => F.geometry(c);
out.straight = F.score(g(straight(8000)));
out.wiggly = F.score(g(wiggly(8000)));
// half twisty, half a long straight
const mixed = ll([...Array.from({ length: 801 }, (_, i) => [i * 5, 60 * Math.sin(2 * Math.PI * i * 5 / 400)]), ...Array.from({ length: 400 }, (_, i) => [4000 + (i + 1) * 10, 0])]);
out.mixed = F.score(g(mixed));
const grid = g(stair(16));
out.gridRaw = F.score(grid);
// the router's maneuvers sit on every block corner
const turnsM = []; for (let b = 1; b < 16; b++) turnsM.push(b * 400);
out.gridTurns = F.score(grid, turnsM);
out.short = F.score(g(straight(300)));

// ranking
const fun = (f, good) => ({ fun: f, good });
const cands = [
  { id: 'quick', timeS: 1800, fun: fun(30, 20) },
  { id: 'alt', timeS: 1920, fun: fun(45, 30) },          // +2 min, a better road
  { id: 'detour', timeS: 2600, fun: fun(70, 120) },      // +13 min through a great stage
  { id: 'huge', timeS: 3900, fun: fun(95, 300) },        // +35 min: past every budget but Max
];
for (const lv of ['quick', 'fun', 'max']) out['rank_' + lv] = F.rank(cands, lv).map(c => c.id);
out.rankAdjust = F.rank([{ id: 'a', timeS: 1800, fun: fun(40, 30) }, { id: 'b', timeS: 1800, fun: fun(42, 30), adjust: -6 }], 'fun').map(c => c.id);
out.rankNoTime = F.rank([{ id: 'x', timeS: null, fun: fun(10, 0) }], 'fun').map(c => c.id);

// corridor: A at (0,0), B 20 km east
const A = P(0, 0), B = P(20000, 0);
const stage = (name, x0, y0, km, score) => { const n = Math.round(km * 200); return { name, km, score, lat: Array.from({ length: n }, (_, i) => lat0 + y0 * mLat), lon: Array.from({ length: n }, (_, i) => lon0 + (x0 + i * 5) * mLon) }; };
const stages = [
  stage('behind', -15000, 0, 4, 30),      // behind A: never
  stage('far', 8000, 25000, 4, 28),        // 25 km off the line: outside the ellipse
  stage('good', 6000, 2000, 5, 20),
  stage('dupe', 6000, 2100, 5, 19),        // the same road again (dual carriageway)
  stage('ok', 13000, -1500, 4, 12),
  stage('meh', 3000, 500, 3, 5),
  stage('late', 15000, 1000, 3, 4),
];
out.shortlist = F.shortlist(A, B, stages, F.LEVELS.fun.budget, 4).map(s => s.name);
out.shortlistMax = F.shortlist(A, B, stages, 2.0, 4).map(s => s.name);
const list = F.shortlist(A, B, stages, F.LEVELS.fun.budget, 4);
const mp = F.matrixPoints(A, B, list);
out.pairs = mp.sources.length * mp.targets.length;
// Synthetic matrix: 60 km/h crow fly between points, except no road into 'ok' from its west end.
const kmh = 60, t = (a, b) => F.kmBetween(a, b) / kmh * 3600;
const times = mp.sources.map((s, r) => mp.targets.map((d, c) => (list[c >> 1] && list[c >> 1].name === 'ok' && c % 2 === 0 ? null : t(s, d))));
const quickS = t(A, B) * 1.1;
const plans = F.plansFromMatrix(list, times, quickS, 'fun', 3);
out.plans = plans.map(p => ({ legs: p.legs.map(l => l.s.name + (l.fwd ? '>' : '<')), min: p.timeS / 60, wps: F.waypoints(A, B, p).length }));
out.quickMin = quickS / 60;
out.limitMin = (quickS * (1 + F.LEVELS.fun.budget) + F.LEVELS.fun.slackS) / 60;
out.plansQuick = F.plansFromMatrix(list, times, quickS, 'quick', 3).length;
// shaping points along a 30 km line: every ~6 km, at most 8, never the ends
const line30 = ll(Array.from({ length: 3001 }, (_, i) => [i * 10, 0]));
out.along = F.alongPoints(line30).map(p => Math.round((p.lon - lon0) / mLon / 1000));
out.alongMax = F.alongPoints(ll(Array.from({ length: 20001 }, (_, i) => [i * 10, 0]))).length;
out.alongShort = F.alongPoints(ll([[0, 0], [1000, 0], [2000, 0]])).length;
// a stop near the start goes before the stage points, not after them
const vias = [{ id: 's1', distM: 5000 }, { id: 's2', distM: 9000 }];
out.insertEarly = F.insertVia(vias, { id: 'pin' }, 1000).map(v => v.id);
out.insertLate = F.insertVia(vias, { id: 'pin' }, 12000).map(v => v.id);
// loops: stages around the start, matrix distances = 1.3 x crow fly, except a lake: no road into 'east' from either end
const S0 = P(0, 0);
const ring = [stage('north', -2000, 8000, 5, 20), stage('east', 9000, 0, 5, 30), stage('south', -2000, -8000, 5, 15), stage('far', 60000, 0, 5, 50), stage('west', -12000, 0, 4, 10)];
const loopList = F.loopShortlist(S0, ring, 48, 6);
out.loopList = loopList.map(s => s.name);
const lmp = F.matrixPoints(S0, S0, loopList);
const lkm = lmp.sources.map((a) => lmp.targets.map((b, c) => (loopList[c >> 1] && loopList[c >> 1].name === 'east' ? null : F.kmBetween(a, b) * 1.3)));
const loops = F.loopPlansFromMatrix(loopList, lkm, 48, 3);
out.loops = loops.map(p => ({ names: p.legs.map(l => l.s.name), total: p.total, wps: F.waypoints(S0, S0, p).length }));
process.stdout.write(JSON.stringify(out));
"""

TILES = r"""
let calls = 0;
globalThis.ApexCore = require(process.argv[1] + '/web/apex_core.js');
globalThis.ApexRouteLoading = {
  json: async () => ({ tiles: ['https://t/{z}/{x}/{y}.pbf'] }),
  arrayBuffer: async () => { calls++; return new ArrayBuffer(0); },
  yieldToUI: async () => {},
};
require(process.argv[1] + '/web/stages.js');
(async () => {
  await globalThis.ApexStages.roadPieces({ lat: 39.1, lon: -84.5 }, 14);
  process.stdout.write(JSON.stringify({ calls }));
})();
"""


@pytest.fixture(scope="module")
def r():
    res = subprocess.run([NODE, "-e", RUNNER, os.path.abspath(".")], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_twisty_beats_straight_and_long_straights_are_dull(r):
    assert r["straight"]["fun"] < 5 and r["straight"]["good"] == 0
    assert r["wiggly"]["fun"] >= 80 and r["wiggly"]["twist"] == 100 and r["wiggly"]["flow"] == 100
    assert r["straight"]["dullShare"] == 1.0 and r["wiggly"]["dullShare"] == 0.0
    assert r["straight"]["fun"] < r["mixed"]["fun"] < r["wiggly"]["fun"]
    assert r["short"] is None, "too short to judge stays unknown"


def test_junction_turns_are_not_corners(r):
    assert r["gridRaw"]["twist"] >= 30, "without maneuvers a town grid looks twisty"
    assert r["gridTurns"]["twist"] == 0 and r["gridTurns"]["fun"] <= 15, "the router's turns take those corners away"


def test_rank_respects_each_levels_budget(r):
    assert r["rank_quick"] == ["alt", "quick"], "quick: +2 min for a better road is fine; +13 is past the budget"
    assert r["rank_fun"][0] == "detour" and "huge" not in r["rank_fun"]
    assert r["rank_max"][0] == "huge"
    assert r["rankAdjust"] == ["a", "b"], "a measured rough road loses a near tie"
    assert r["rankNoTime"] == ["x"], "with no times there is still an answer"


def test_shortlist_keeps_corridor_stages_without_duplicates(r):
    assert r["shortlist"] == ["good", "ok", "meh", "late"]
    assert "behind" not in r["shortlistMax"] and "dupe" not in r["shortlistMax"]
    assert r["pairs"] <= 100, "the public matrix takes at most 100 pairs"


def test_plans_use_real_connector_times_and_budget(r):
    assert r["plans"], "stages near the line make plans"
    for p in r["plans"]:
        assert p["min"] <= r["limitMin"] + 1e-6
        assert p["wps"] <= 10
        for leg in p["legs"]:
            assert leg != "ok>", "no road into ok's west end, so it can only be driven east to west"
    assert r["plans"][0]["legs"][0].startswith("good"), "the best stage leads"
    assert r["plansQuick"] <= len(r["plans"])


def test_loops_use_real_distances_and_fit_the_target(r):
    assert "far" not in r["loopList"], "a stage 60 km away can't be in a 48 km loop"
    assert r["loops"], "stages around the start make loops"
    for p in r["loops"]:
        assert abs(p["total"] - 48) / 48 <= 0.25
        assert "east" not in p["names"], "no road reaches it"
        assert p["wps"] <= 10
        assert len(set(p["names"])) == len(p["names"]), "no stage twice"


MATRIX = r"""
const fs = require('node:fs');
const html = fs.readFileSync(process.argv[1] + '/web/index.html', 'utf8');
const source = html.match(/async function valhallaMatrix\(.*?\n    }/s)[0];
const calls = [];
const RouteLoading = { json: async (url, opts) => { const b = JSON.parse(opts.body); calls.push(b.sources.length * b.targets.length);
  return { sources_to_targets: b.sources.map((s, i) => b.targets.map((t, j) => (j === 0 ? null : { time: 60, distance: Math.round((s.lat - 39) * 100) + j }))) }; } };
const m = new Function('RouteLoading', 'VALHALLA', 'COSTING', 'return (' + source + ')')(RouteLoading, 'https://v', {});
const pts = (n) => Array.from({ length: n }, (_, i) => ({ lat: 39 + i / 100, lon: -84 }));
(async () => {
  const r = await m(pts(13), pts(13));
  process.stdout.write(JSON.stringify({ calls, rows: r.km.length, cols: r.km[0].length, last: r.km[12][12], nul: r.times[5][0] }));
})();
"""


def test_big_matrix_is_split_into_calls_of_100_pairs():
    res = subprocess.run([NODE, "-e", MATRIX, os.path.abspath(".")], capture_output=True, text=True, check=True)
    r = json.loads(res.stdout)
    assert all(c <= 100 for c in r["calls"]) and sum(r["calls"]) == 169
    assert r["rows"] == 13 and r["cols"] == 13 and r["last"] == 24, "rows come back in order"
    assert r["nul"] is None, "no road stays unknown"


def test_alternates_keep_shaping_points_and_stops_go_in_order(r):
    assert r["along"] == [5, 10, 15, 20, 25], "a 30 km alternate is pinned every 5–6 km"
    assert r["alongMax"] == 8 and r["alongShort"] == 0
    assert r["insertEarly"] == ["pin", "s1", "s2"]
    assert r["insertLate"] == ["s1", "s2", "pin"]


def test_stage_search_shrinks_to_the_tile_budget():
    res = subprocess.run([NODE, "-e", TILES, os.path.abspath(".")], capture_output=True, text=True, check=True)
    calls = json.loads(res.stdout)["calls"]
    assert 0 < calls <= 64, f"a 14 km search at 39°N fetched {calls} tiles (it used to give up at 81)"


APP = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const root = process.argv[1];
const Core = require(root + '/web/apex_core.js');
globalThis.ApexCore = Core;
const FunRoute = require(root + '/web/fun_route.js');
const html = fs.readFileSync(root + '/web/index.html', 'utf8');
const source = html.match(/async function funRoute\(.*?\n    }/s)[0];
const lat0 = 39.2, lon0 = -84.6, mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const ll = (pts) => pts.map(([x, y]) => [lon0 + x * mLon, lat0 + y * mLat]);
const straight = ll(Array.from({ length: 1001 }, (_, i) => [i * 10, 0]));
const wiggly = ll(Array.from({ length: 2401 }, (_, i) => [i * 5, 60 * Math.sin(2 * Math.PI * i * 5 / 400)]));
const A = { lat: lat0, lon: lon0 }, B = { lat: lat0, lon: lon0 + 10000 * mLon };
async function run({ level, routes, osrm, discover, matrix }) {
  const built = [], toasts = [], calls = { matrix: 0, routes: 0 };
  const funRoute = new Function('funLevel', 'valhallaRoutes', 'osrmRoutes', 'toast', 'FunRoute', 'ApexStages', 'state', 'allHighlights', 'valhallaMatrix',
    'Core', 'RouteLoading', 'funOf', 'applyMeasured', 'trackFromPolyline', 'buildRoute', 'totalOf', 'window', 'return (' + source + ')')(
    level, async (pts, through, alts) => { calls.routes++; return routes(pts, alts); }, osrm || (async () => { throw Error('down'); }),
    (m) => toasts.push(m), FunRoute, { discover }, { hlOn: false }, async () => [],
    async (s, t) => { calls.matrix++; return { times: await matrix(s, t) }; },
    Core, { yieldToUI: async () => {} }, (t, turns) => FunRoute.score(t, []), async () => false,
    async (coords, id, name) => ({ id, name, ...FunRoute.geometry(coords, Core) }),
    async (pts, id, name, t) => built.push(t), (t) => t.dist[t.dist.length - 1], {});
  await funRoute(A, B, 'route_dest', 'To B', { from: null, to: B, via: [] }, { step() {} });
  return { built, toasts, calls };
}
(async () => {
  const out = {};
  // 1. Quick: no stage search; the twistier alternate wins when it costs 1 minute.
  let r = await run({ level: 'quick', routes: async (pts, alts) => [{ coords: straight, turns: [], timeS: 600 }, { coords: wiggly, turns: [], timeS: 660 }],
                      discover: async () => { throw Error('should not search'); } });
  out.quick = { fun: r.built[0].fun.fun, extraS: r.built[0].extraS, via: r.built[0].request.via.length, shaping: r.built[0].request.via.every(v => v.shaping), matrix: r.calls.matrix };
  // 2. No tiles: the router's own routes still compete, no error.
  r = await run({ level: 'fun', routes: async () => [{ coords: straight, turns: [], timeS: 600 }], discover: async () => { throw Error('no tiles'); } });
  out.noTiles = { built: r.built.length, fun: r.built[0].fun.fun };
  // 3. Valhalla down: OSRM's route.
  r = await run({ level: 'fun', routes: async () => { throw Error('down'); }, osrm: async () => [{ coords: straight, turns: [], timeS: 700 }], discover: async () => [] });
  out.osrm = { built: r.built.length, timeS: r.built[0].timeS };
  // 4. A stage on the way: shortlisted, timed by the matrix, routed, wins, and its points become shaping vias.
  const stage = { km: 5, score: 20, lat: wiggly.slice(0, 1001).map(p => p[1] + 300 * mLat), lon: wiggly.slice(0, 1001).map(p => p[0]) };
  r = await run({ level: 'fun', discover: async () => [stage],
                  routes: async (pts) => pts.length === 2 ? [{ coords: straight, turns: [], timeS: 600 }] : [{ coords: wiggly, turns: [], timeS: 720 }],
                  matrix: async (s, t) => s.map(() => t.map(() => 60)) });
  out.stage = { fun: r.built[0].fun.fun, via: r.built[0].request.via.length, shaping: r.built[0].request.via.every(v => v.shaping), extraS: r.built[0].extraS, matrix: r.calls.matrix };
  // 5. All down: one toast, nothing built.
  r = await run({ level: 'fun', routes: async () => { throw Error('down'); }, discover: async () => [] });
  out.down = { built: r.built.length, toasts: r.toasts };
  process.stdout.write(JSON.stringify(out));
})().catch(e => { console.error(e); process.exitCode = 1; });
"""


def test_app_fun_route_picks_and_falls_back():
    res = subprocess.run([NODE, "-e", APP, os.path.abspath(".")], capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    r = json.loads(res.stdout)
    assert r["quick"]["fun"] > 50 and r["quick"]["extraS"] == 60 and r["quick"]["matrix"] == 0
    assert r["quick"]["via"] >= 1 and r["quick"]["shaping"], "the winning 12 km alternate is pinned so a reroute stays on it"
    assert r["noTiles"] == {"built": 1, "fun": r["noTiles"]["fun"]}
    assert r["osrm"] == {"built": 1, "timeS": 700}
    assert r["stage"]["matrix"] == 1 and r["stage"]["via"] >= 2 and r["stage"]["shaping"] and r["stage"]["fun"] > 50 and r["stage"]["extraS"] == 120
    assert r["down"]["built"] == 0 and len(r["down"]["toasts"]) == 1
