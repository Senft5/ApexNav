"""Fun A→B routing (web/fun_route.js) on synthetic roads: no network, deterministic."""
import json
import re
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
globalThis.ApexRouteLoading = {};
require(root + '/web/stages.js');
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
// measured roads: a fully rough road (-8) loses a close call but can't sink a much more fun one
out.roughClose = F.rank([{ id: 'a', timeS: 1800, fun: fun(40, 30) }, { id: 'b', timeS: 1800, fun: fun(46, 30), adjust: -8 }], 'fun').map(c => c.id);
out.roughFar = F.rank([{ id: 'a', timeS: 1800, fun: fun(40, 30) }, { id: 'b', timeS: 1800, fun: fun(60, 30), adjust: -8 }], 'fun').map(c => c.id);
out.rankNoTime = F.rank([{ id: 'x', timeS: null, fun: fun(10, 0) }], 'fun').map(c => c.id);
// sun glare: 10 km straight at the low morning sun vs the same road with the sun behind
const Sun = require(root + '/web/sun.js');
const dawn = new Date(Sun.sunTimes(new Date('2026-06-21T12:00:00Z'), 39.1, -84.51).sunrise.getTime() + 30 * 60000);
const sp = Sun.sunPosition(dawn, 39.1, -84.51);
const line = (az) => { const n = 2001, lat = [], lon = [], dist = []; for (let i = 0; i < n; i++) { const m = i * 5; lat.push(39.1 + m * Math.cos(az) / 110540); lon.push(-84.51 + m * Math.sin(az) / (111320 * Math.cos(39.1 * Math.PI / 180))); dist.push(m); } return { lat, lon, dist }; };
out.glare = [F.glare(line(sp.azimuth), 900, dawn, Sun).minutes, F.glare(line(sp.azimuth + Math.PI), 900, dawn, Sun).minutes,
             F.glare(line(sp.azimuth), 900, new Date('2026-06-21T17:40:00Z'), Sun).minutes, F.glare(line(0), 900, dawn, null)];
out.options = F.distinctOptions([{ id: 'a', timeS: 7680, fun: fun(79, 0) }, { id: 'a2', timeS: 7700, fun: fun(80, 0) }, { id: 'b', timeS: 5880, fun: fun(51, 0) },
  { id: 'c', timeS: 7620, fun: fun(61, 0) }, { id: 'd', timeS: 5880, fun: fun(27, 0) }], 3).map(c => c.id);
out.dominated = F.distinctOptions([{ id: 'best', timeS: 4620, fun: fun(99, 0) }, { id: 'worse', timeS: 6120, fun: fun(64, 0) },
  { id: 'quick', timeS: 3900, fun: fun(40, 0) }], 3).map(c => c.id);
out.wetRank = F.rank([{ id: 'wet', timeS: 1800, fun: fun(46, 30), weatherCost: 12 }, { id: 'dry', timeS: 1800, fun: fun(40, 30) }], 'fun').map(c => c.id);
out.glareRank = F.rank([{ id: 'into', timeS: 1800, fun: fun(46, 30), glare: { minutes: 15 } }, { id: 'away', timeS: 1800, fun: fun(40, 30), glare: { minutes: 0 } }], 'fun').map(c => c.id);

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
// long trips: sections along the quickest route, chained
const far = P(90000, 0);
out.sections = [F.sectionCount(A, B, 3), F.sectionCount(A, far, 3), F.sectionCount(A, far, 2), F.sectionCount(A, P(23000, 0), 3)];
out.cuts = F.sectionPoints(ll(Array.from({ length: 9001 }, (_, i) => [i * 10, 0])), 3).map(p => Math.round((p.lon - lon0) / mLon / 1000));
const plan = (name, km0, value, n = 1) => ({ value, timeS: 600, legs: Array.from({ length: n }, (_, i) => ({ s: stage(name + i, km0 * 1000 + i * 2000, 0, 3, 5), fwd: true })) });
out.combined = F.combineSections([[plan('a', 5, 9), plan('a2', 8, 4)], [], [plan('c', 70, 6, 2), plan('c2', 75, 5)]], 1800, 'fun', 2)
  .map(p => p.legs.map(l => l.s.name).join(' '));
out.capped = F.combineSections([[plan('x', 5, 9, 2)], [plan('y', 40, 3, 2)], [plan('z', 70, 6, 2)]], 1800, 'fun', 1, 4).map(p => p.legs.map(l => l.s.name).join(' '));
out.empty = F.combineSections([[], []], 1200, 'fun', 2).length;
// the same stage picked by two neighbouring sections is driven once; a chain past the budget is left out
out.shared = F.combineSections([[plan('s', 20, 9)], [plan('s', 20, 8), plan('t', 50, 7)]], 1200, 'fun', 2).map(p => p.legs.map(l => l.s.name).join(' '));
const slow = (name, km0) => ({ ...plan(name, km0, 9), timeS: 1500 });
out.overBudget = F.combineSections([[slow('u', 5)], [slow('v', 50)]], 1200, 'fun', 2).length;
out.plansQuick = F.plansFromMatrix(list, times, quickS, 'quick', 3).length;
// shaping points along a 30 km line: every ~6 km, at most 8, never the ends
const line30 = ll(Array.from({ length: 3001 }, (_, i) => [i * 10, 0]));
out.along = F.alongPoints(line30).map(p => Math.round((p.lon - lon0) / mLon / 1000));
out.alongMax = F.alongPoints(ll(Array.from({ length: 20001 }, (_, i) => [i * 10, 0]))).length;
out.alongShort = F.alongPoints(ll([[0, 0], [1000, 0], [2000, 0]])).length;
// towns: 3 km through a town 10 km out; the city you start in and a village 1 km off the road don't count
const g30 = F.geometry(line30, globalThis.ApexCore || require(process.argv[1] + '/web/apex_core.js'));
out.townKm = F.townKm(g30, [{ ...P(10000, 0), cls: 'town' }, { ...P(0, 0), cls: 'city' }, { ...P(20000, 1000), cls: 'village' }]);
out.townKmNone = F.townKm(g30, null);
out.townCost = [F.townCost({ townKm: 3 }), F.townCost({ townKm: 50 }), F.townCost({ townKm: null })];
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
out.loops = loops.map(p => ({ names: p.legs.map(l => l.s.name), total: p.total, wps: globalThis.ApexStages.waypoints(S0, p).length }));
// the same stages as a "home in 60 minutes" loop: connectors at 60 km/h from the km matrix, stages at 50 km/h
const lsec = lkm.map(row => row.map(v => (v == null ? null : v / 60 * 3600)));
out.timeLoops = F.loopPlansFromMatrix(loopList, lsec, 3600, 3, F.LOOP_BY_TIME).map(p => ({ names: p.legs.map(l => l.s.name), total: p.total }));
// Explore: best first; a duplicate of a better road, a road past the search and one with no road to it are left out;
// 'slow' is near by crow fly but 20 min by road; 'west' is entered from its nearer (east) end
const exp = [stage('west', -6000, 0, 3, 20), stage('twin', -6000, 40, 3, 18), stage('far', 30000, 0, 3, 16), stage('lake', 0, 5000, 3, 14), stage('slow', 0, -9000, 3, 12), stage('north', 0, 9000, 3, 10), { ...stage('west2', 6000, 0, 3, 9), name: 'west' }];
const expList = F.exploreShortlist(S0, exp, 14);
out.expList = expList.map(s => s.name);
const expT = [F.exploreTargets(expList).map((b, c) => { const s = expList[c >> 1].name; return s === 'lake' ? null : s === 'slow' ? 1200 : F.kmBetween(S0, b) * 1.3 / 60 * 3600; })];
out.expPicks = F.explorePicks(expList, expT, 900).map(p => ({ name: p.s.name, fwd: p.fwd, min: Math.round(p.awayS / 60) }));
out.expPicks1 = F.explorePicks(expList, expT, 900, 1).map(p => p.s.name);
// routed loops are valued on the fun scale: retracing and missing the length cost points
out.loopValue = [F.loopValue({ fun: 60 }, 48, 48, 0), F.loopValue({ fun: 60 }, 48, 48, 0.1), F.loopValue({ fun: 60 }, 60, 48, 0), F.loopValue(null, 48, 48, 0)];
// why this route: roads the winner spends 2+ km more on than the quickest, and what it gains and costs
const qr = { timeS: 3600, fun: { good: 10 }, route: { names: new Map([['I-40', 50], ['Main St', 3]]) } };
const wr = { timeS: 5400, fun: { good: 48 }, route: { names: new Map([['Foothills Pkwy', 14], ['Main St', 4], ['US 129', 6], ['I-40', 20]]) } };
out.why = F.why(wr, qr);
out.whyQuick = F.why(qr, qr);
out.whyNoNames = F.why({ ...wr, route: {} }, qr);
// avoid options: costing, what a route still uses, and keeping to them when any candidate can
// where a route's stages are (IDEAS V-07): a 10 km straight route with two 1 km stages on it, the second driven backwards
{
  const N = 2001, rt = { lat: Array.from({ length: N }, (_, i) => 39.2 + i * 5 / 110540), lon: Array(N).fill(-84.6), dist: Array.from({ length: N }, (_, i) => i * 5) };
  const seg = (m0, m1, name) => ({ name, lat: [39.2 + m0 / 110540, 39.2 + m1 / 110540], lon: [-84.6, -84.6] });
  const spans = F.stageSpans(rt, [{ s: seg(2000, 3000, 'Ridge'), fwd: true }, { s: seg(7000, 6000, 'Hollow'), fwd: false }, { s: { name: 'Far', lat: [40, 40.01], lon: [-84, -84] }, fwd: true }]);
  out.spans = spans.map(s => [s.name, s.startM, s.endM]);
  out.ahead = [F.stageAhead(spans, 500), F.stageAhead(spans, 2500), F.stageAhead(spans, 9000)].map(a => a && [a.span.name, a.on, a.toM]);
  out.respan = F.stageSpans({ ...rt, dist: rt.dist.map(d => d + 100) }, spans).map(s => [s.name, s.startM]);
}
out.costDefault = F.costing().costing_options.auto;
out.costAll = F.costing({ highways: true, tolls: true, ferries: true, unpaved: false }).costing_options.auto;
const allowGravel = { highways: false, tolls: false, ferries: false, unpaved: false };
out.costCar = [F.costing(allowGravel, { clearance: 'low', width_cm: 195 }).costing_options.auto, F.costing(allowGravel, { clearance: 'high' }).costing_options.auto,
  F.costing(allowGravel, { width_cm: 50 }).costing_options.auto];
out.carNote = [F.carNote({ clearance: 'low', width_cm: 195, label: 'Miata' }, allowGravel), F.carNote({ clearance: 'stock' }), F.carNote(null), F.carNote({ clearance: 'low', label: 'Miata' })];
const tollRoad = { route: { has: { tolls: true, highways: false } } }, freeRoad = { route: { has: { tolls: false, highways: false } } }, unknown = { route: {} };
out.unavoided = [F.unavoided({ tolls: true }, tollRoad.route), F.unavoided({ tolls: false }, tollRoad.route), F.unavoided({ tolls: true }, unknown.route)];
out.keep = [F.keepAvoiding([tollRoad, freeRoad], { tolls: true }).length, F.keepAvoiding([tollRoad], { tolls: true }).length, F.keepAvoiding([tollRoad, freeRoad], { tolls: false }).length];
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
    assert r["roughClose"] == ["a", "b"] and r["roughFar"] == ["b", "a"]
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


def test_long_trips_are_chained_sections(r):
    assert r["sections"] == [1, 3, 2, 2], "23 km crow fly is already two sections"
    assert r["cuts"] == [0, 30, 60, 90], "cut points at equal distances along the quickest route"
    assert r["combined"] == ["a0 c0 c1", "a20 c0 c1"], "best of each section in travel order, then a variant"
    assert r["capped"] == ["x0 x1 z0 z1"], "at most 4 stages: the weakest section gives way"
    assert r["empty"] == 0
    assert r["shared"] == ["s0", "s0 t0"], "a stage two sections both found is driven once"
    assert r["overBudget"] == 0, "sections each within budget can still add up past the trip's"


def test_town_km_counts_towns_on_the_way_not_where_you_start(r):
    assert 2.8 <= r["townKm"] <= 3.2, r["townKm"]
    assert r["townKmNone"] is None, "no place data: unknown"
    assert r["townCost"] == [9, 60, 0]


def test_explore_lists_the_best_roads_you_can_reach_in_time(r):
    assert r["expList"] == ["west", "lake", "slow", "north"], "no duplicate road, nothing past the search"
    assert r["expPicks"] == [{"name": "west", "fwd": False, "min": 4}, {"name": "north", "fwd": True, "min": 12}], \
        "best first, by road time: no road to 'lake', 'slow' is 20 min away; entered from the nearer end"
    assert r["expPicks1"] == ["west"]


def test_loops_use_real_distances_and_fit_the_target(r):
    assert "far" not in r["loopList"], "a stage 60 km away can't be in a 48 km loop"
    assert r["loops"], "stages around the start make loops"
    for p in r["loops"]:
        assert abs(p["total"] - 48) / 48 <= 0.25
        assert "east" not in p["names"], "no road reaches it"
        assert p["wps"] <= 10
        assert len(set(p["names"])) == len(p["names"]), "no stage twice"
    sets = [tuple(sorted(p["names"])) for p in r["loops"]]
    assert len(set(sets)) == len(sets), "a loop and the same loop backwards are one choice"


def test_why_this_route_names_the_roads_it_is_for(r):
    assert r["why"] == {"roads": [{"name": "Foothills Pkwy", "km": 14}, {"name": "US 129", "km": 6}], "gained": 38, "extraMin": 30}
    assert r["whyQuick"] is None, "the quickest route needs no reason"
    assert r["whyNoNames"] == {"roads": [], "gained": 38, "extraMin": 30}, "no road names: still the corners and the cost"


def test_avoid_options_reach_the_router_and_are_honest(r):
    assert r["costDefault"] == {"use_highways": 0.15, "use_tolls": 0.3, "exclude_unpaved": True}
    assert r["costAll"] == {"use_highways": 0, "use_tolls": 0, "use_ferry": 0}
    assert r["unavoided"] == [["tolls"], [], []], "unknown flags say nothing"
    low, high, silly = r["costCar"]
    assert low["exclude_unpaved"] is True and low["width"] == 1.95, "a lowered car stays off gravel; its width goes to the router (IDEAS R-20)"
    assert "exclude_unpaved" not in high and "width" not in high and "width" not in silly
    assert r["carNote"] == ["Planned for your Miata: no unpaved roads, roads wide enough.", "", "", ""]
    assert r["keep"] == [1, 1, 2], "a toll-free candidate wins the pool; if none is, the toll road stays (and the card says so)"


def test_loops_by_drive_time_fit_the_time(r):
    assert r["timeLoops"], "stages around the start make a one-hour loop"
    for p in r["timeLoops"]:
        assert abs(p["total"] - 3600) / 3600 <= 0.25
        assert "east" not in p["names"] and "far" not in p["names"]


def test_route_options_are_really_different(r):
    assert r["options"] == ["a", "b", "c"], "a stage plan the router drew like the winner is not a second option"
    assert r["dominated"] == ["best", "quick"], "a route slower and less fun than another is never offered"


def test_driving_into_a_low_sun_costs(r):
    into, away, noon, nosun = r["glare"]
    assert abs(into - 15) < 0.5, "15 minutes straight at a sun 5° up"
    assert away == 0 and noon == 0, "sun behind you, or high at noon: no glare"
    assert nosun is None
    assert r["glareRank"][0] == "away", "15 minutes into the sun outweighs a 6-point fun lead"
    assert r["wetRank"][0] == "dry", "a forecast of rain along most of it outweighs a 6-point fun lead (IDEAS R-21)"


def test_loops_are_valued_on_the_fun_scale(r):
    full, retraced, long_, unscored = r["loopValue"]
    assert full == 60, "a clean loop of the asked length is worth its fun score"
    assert retraced == 40, "a tenth driven twice costs 20 points"
    assert abs(long_ - 40) < 1e-9, "25 % long costs 20 points"
    assert unscored == 0


MATRIX = r"""
const fs = require('node:fs');
const html = fs.readFileSync(process.argv[1] + '/web/index.html', 'utf8');
const source = html.match(/async function valhallaMatrix\(.*?\n    }/s)[0];
const calls = [];
const RouteLoading = { json: async (url, opts) => { const b = JSON.parse(opts.body); calls.push(b.sources.length * b.targets.length);
  return { sources_to_targets: b.sources.map((s, i) => b.targets.map((t, j) => (j === 0 ? null : { time: 60, distance: Math.round((s.lat - 39) * 100) + j }))) }; } };
const m = new Function('RouteLoading', 'VALHALLA', 'FunRoute', 'avoid', 'routingCar', 'return (' + source + ')')(RouteLoading, 'https://v', { costing: () => ({}) }, {}, () => null);
const pts = (n) => Array.from({ length: n }, (_, i) => ({ lat: 39 + i / 100, lon: -84 }));
(async () => {
  const r = await m(pts(13), pts(13));
  process.stdout.write(JSON.stringify({ calls, rows: r.km.length, cols: r.km[0].length, last: r.km[12][12], nul: r.times[5][0], nulKm: r.km[5][0] }));
})();
"""


def test_big_matrix_is_split_into_calls_of_100_pairs():
    res = subprocess.run([NODE, "-e", MATRIX, os.path.abspath(".")], capture_output=True, text=True, check=True)
    r = json.loads(res.stdout)
    assert all(c <= 100 for c in r["calls"]) and sum(r["calls"]) == 169
    assert r["rows"] == 13 and r["cols"] == 13 and r["last"] == 24, "rows come back in order"
    assert r["nul"] is None and r["nulKm"] is None, "no road stays unknown"


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
globalThis.ApexUnits = require(root + "/web/units.js");
const FunRoute = require(root + '/web/fun_route.js');
const html = fs.readFileSync(root + '/web/index.html', 'utf8');
const source = html.match(/async function funRoute\(.*?\n    }/s)[0];
const useOptionSource = html.match(/async function useOption\(.*?\n    }/s)[0];
const marksSource = html.match(/function timeMarksOf\(.*?\n    }/s)[0];
const fewerSource = html.match(/const fewerTownKm = .*?;\n/s)[0];
const townsOnSource = html.match(/async function townsOn\(.*?\n    }/s)[0];
const whyText = new Function('return (' + html.match(/function whyText\(w.*?\) \{.*?\n    }/s)[0] + ')')();
const lat0 = 39.2, lon0 = -84.6, mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const ll = (pts) => pts.map(([x, y]) => [lon0 + x * mLon, lat0 + y * mLat]);
const straight = ll(Array.from({ length: 1001 }, (_, i) => [i * 10, 0]));
const wiggly = ll(Array.from({ length: 2401 }, (_, i) => [i * 5, 60 * Math.sin(2 * Math.PI * i * 5 / 400)]));
const A = { lat: lat0, lon: lon0 }, B = { lat: lat0, lon: lon0 + 10000 * mLon };
async function run({ level, routes, osrm, discover, matrix, places, avoid = FunRoute.AVOID_DEFAULT }) {
  const built = [], toasts = [], calls = { matrix: 0, routes: 0 };
  const funRoute = new Function('funLevel', 'valhallaRoutes', 'osrmRoutes', 'toast', 'FunRoute', 'ApexStages', 'state', 'allHighlights', 'valhallaMatrix',
    'Core', 'RouteLoading', 'funOf', 'applyMeasured', 'trackFromPolyline', 'buildRoute', 'totalOf', 'window', 'whyText', 'avoid', 'let routeOptions = null; ' + useOptionSource + '; ' + townsOnSource + '; const weatherOn = async () => {}; const tasteOn = () => {}; const measuredStages = async (s) => s; ' + fewerSource + '; ' + marksSource + '; const stepsOf = () => []; return (' + source + ')')(
    level, async (pts, through, alts) => { calls.routes++; return routes(pts, alts); }, osrm || (async () => { throw Error('down'); }),
    (m) => toasts.push(m), FunRoute, { discover, places }, { hlOn: false }, async () => [],
    async (s, t) => { calls.matrix++; return { times: await matrix(s, t) }; },
    Core, { yieldToUI: async () => {} }, (t, turns) => FunRoute.score(t, []), async () => false,
    async (coords, id, name) => ({ id, name, ...FunRoute.geometry(coords, Core) }),
    async (pts, id, name, t) => built.push(t), (t) => t.dist[t.dist.length - 1], {}, whyText, avoid);
  await funRoute(A, B, 'route_dest', 'To B', { from: null, to: B, via: [] }, { step() {} });
  return { built, toasts, calls };
}
(async () => {
  const out = {};
  // 1. Quick: no stage search; the twistier alternate wins when it costs 1 minute.
  let r = await run({ level: 'quick', routes: async (pts, alts) => [{ coords: straight, turns: [], timeS: 600 }, { coords: wiggly, turns: [], timeS: 660, names: new Map([['Twisty Rd', 14]]), times: [[...wiggly[0], 0], [...wiggly[1200], 330]] }],
                      discover: async () => { throw Error('should not search'); } });
  out.quick = { fun: r.built[0].fun.fun, extraS: r.built[0].extraS, via: r.built[0].request.via.length, shaping: r.built[0].request.via.every(v => v.shaping), matrix: r.calls.matrix, why: r.built[0].why, marks: r.built[0].timeMarks.map(([m, sec]) => [Math.round(m / 100) / 10, sec]) };
  // 2. No tiles: the router's own routes still compete, no error.
  r = await run({ level: 'fun', routes: async () => [{ coords: straight, turns: [], timeS: 600 }], discover: async () => { throw Error('no tiles'); } });
  out.noTiles = { built: r.built.length, fun: r.built[0].fun.fun };
  // 3. Valhalla down: OSRM's route.
  r = await run({ level: 'fun', routes: async () => { throw Error('down'); }, osrm: async () => [{ coords: straight, turns: [], timeS: 700 }], discover: async () => [] });
  out.osrm = { built: r.built.length, timeS: r.built[0].timeS };
  // 4. A stage on the way: shortlisted, timed by the matrix, routed, wins, and its points become shaping vias.
  const stage = { km: 5, score: 20, lat: wiggly.slice(0, 1001).map(p => p[1] + 300 * mLat), lon: wiggly.slice(0, 1001).map(p => p[0]) };
  const onStage = wiggly.map(p => [p[0], p[1] + 300 * mLat]);
  r = await run({ level: 'fun', discover: async () => [stage],
                  routes: async (pts) => pts.length === 2 ? [{ coords: straight, turns: [], timeS: 600 }] : [{ coords: onStage, turns: [], timeS: 720 }],
                  matrix: async (s, t) => s.map(() => t.map(() => 60)) });
  out.stage = { fun: r.built[0].fun.fun, via: r.built[0].request.via.length, shaping: r.built[0].request.via.every(v => v.shaping), extraS: r.built[0].extraS, matrix: r.calls.matrix };
  // 4b. The router's way through the stage points is a road 300 m away (a shortcut past it, R-14): the plan is dropped.
  r = await run({ level: 'fun', discover: async () => [stage],
                  routes: async (pts) => pts.length === 2 ? [{ coords: straight, turns: [], timeS: 600 }] : [{ coords: wiggly, turns: [], timeS: 720 }],
                  matrix: async (s, t) => s.map(() => t.map(() => 60)) });
  out.shortcut = { timeS: r.built[0].timeS, via: r.built[0].request.via.length };
  out.coverage = { kept: FunRoute.stageCoverage(onStage, { legs: [{ s: stage }] }), skipped: FunRoute.stageCoverage(wiggly, { legs: [{ s: stage }] }), none: FunRoute.stageCoverage(wiggly, { legs: [] }) };
  // 5. All down: one toast, nothing built.
  r = await run({ level: 'fun', routes: async () => { throw Error('down'); }, discover: async () => [] });
  out.down = { built: r.built.length, toasts: r.toasts };
  // 6. Avoiding tolls: the quick toll road is dropped and the toll-free one is the baseline (no "+N for fun");
  //    when every route has a toll, it stays and the card says so.
  const tolls = { ...FunRoute.AVOID_DEFAULT, tolls: true };
  r = await run({ level: 'quick', avoid: tolls, discover: async () => [],
                  routes: async () => [{ coords: wiggly, turns: [], timeS: 500, has: { tolls: true } }, { coords: straight, turns: [], timeS: 600, has: { tolls: false } }] });
  out.avoidTolls = { timeS: r.built[0].timeS, extraS: r.built[0].extraS, why: r.built[0].why, unavoided: r.built[0].unavoided };
  r = await run({ level: 'quick', avoid: tolls, discover: async () => [],
                  routes: async () => [{ coords: straight, turns: [], timeS: 600, has: { tolls: true } }] });
  out.tollOnly = r.built[0].unavoided;
  // 7. Avoiding towns: the straight road through a town (1.5 km round a point 5 km out) loses to a 1 min longer bow round it;
  //    without the option the straight road wins; with no place data nothing is known and nothing changes.
  const bow = ll([...Array.from({ length: 501 }, (_, i) => [i * 10, i * 5]), ...Array.from({ length: 500 }, (_, i) => [5010 + i * 10, 2500 - (i + 1) * 5])]);
  const two = async () => [{ coords: straight, turns: [], timeS: 600 }, { coords: bow, turns: [], timeS: 660 }];
  const town = [{ lat: lat0, lon: lon0 + 5000 * mLon, cls: 'town', name: 'Mid' }];
  const towns = { ...FunRoute.AVOID_DEFAULT, towns: true };
  r = await run({ level: 'quick', avoid: towns, discover: async () => [], places: async () => town, routes: two });
  out.towns = { timeS: r.built[0].timeS, townKm: r.built[0].townKm, why: r.built[0].why, toast: r.toasts.at(-1) };
  r = await run({ level: 'quick', discover: async () => [], places: async () => { throw Error('not asked'); }, routes: two });
  out.townsOff = { timeS: r.built[0].timeS, townKm: r.built[0].townKm === undefined ? 'unset' : r.built[0].townKm };
  r = await run({ level: 'quick', avoid: towns, discover: async () => [], places: async () => { throw Error('no tiles'); }, routes: two });
  out.townsUnknown = { timeS: r.built[0].timeS, townKm: r.built[0].townKm };
  process.stdout.write(JSON.stringify(out));
})().catch(e => { console.error(e); process.exitCode = 1; });
"""


def test_app_fun_route_picks_and_falls_back():
    res = subprocess.run([NODE, "-e", APP, os.path.abspath(".")], capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    r = json.loads(res.stdout)
    assert r["quick"]["fun"] > 50 and r["quick"]["extraS"] == 60 and r["quick"]["matrix"] == 0
    assert len(r["quick"]["marks"]) == 2 and r["quick"]["marks"][0] == [0, 0] and r["quick"]["marks"][1][1] == 330, r["quick"]["marks"]
    assert r["quick"]["via"] >= 1 and r["quick"]["shaping"], "the winning 12 km alternate is pinned so a reroute stays on it"
    assert r["shortcut"] == {"timeS": 600, "via": 0}, "a route that skipped its stage is not a stage route"
    assert r["coverage"]["kept"] == 1 and r["coverage"]["skipped"] == 0 and r["coverage"]["none"] == 1
    assert r["avoidTolls"] == {"timeS": 600, "extraS": 0, "why": None, "unavoided": []}, "the toll road is dropped, not ranked"
    assert r["tollOnly"] == ["tolls"], "no toll-free way: the card says so"
    assert (r["towns"]["timeS"], r["towns"]["townKm"]) == (660, 0), "the bow round the town wins when towns are avoided"
    assert r["towns"]["why"].endswith("1.9 mi less in towns, +1 min"), r["towns"]["why"]
    assert r["towns"]["toast"].endswith("+1 min for fun and fewer towns"), r["towns"]["toast"]
    assert r["townsOff"] == {"timeS": 600, "townKm": "unset"}, "not asked: the quickest straight road, no town lookup"
    assert r["townsUnknown"] == {"timeS": 600, "townKm": None}, "no place data: unknown (the card says it couldn't check), no cost"
    assert re.fullmatch(r"For Twisty Rd 8\.7 mi · \d+ more good corners, \+1 min", r["quick"]["why"]), r["quick"]["why"]
    assert r["noTiles"] == {"built": 1, "fun": r["noTiles"]["fun"]}
    assert r["osrm"] == {"built": 1, "timeS": 700}
    assert r["stage"]["matrix"] == 1 and r["stage"]["via"] >= 2 and r["stage"]["shaping"] and r["stage"]["fun"] > 50 and r["stage"]["extraS"] == 120
    assert r["down"]["built"] == 0 and len(r["down"]["toasts"]) == 1


def test_stages_are_placed_along_the_route_for_siri(r):
    assert r["spans"] == [["Ridge", 2000, 3000], ["Hollow", 6000, 7000]], "the far stage isn't on the route"
    assert r["ahead"] == [["Ridge", False, 1500], ["Ridge", True, 500], None]
    assert r["respan"] == [["Ridge", 2100], ["Hollow", 6100]], "spans placed again on a rerouted track"
