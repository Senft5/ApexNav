"""Road marks on a planned route (web/road_marks.js): the route context's stop signs that apply, railway level crossings,
one-lane bridges and speed bumps become note events on the track, one per thing (mapped twice within 40 m is one; bumps
within 200 m of the last are one "Speed bumps" run); none without a context, none off the track."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1];
const O = require(R + '/web/route_ctx/osm_overpass.js'), M = require(R + '/web/road_marks.js'), Core = require(R + '/web/apex_core.js');
// a straight east-west road at 39 N, 2 km, the route context's 25 m samples
const n = 81, lat0 = 39, lon0 = -84.5, dLon = 25 / (111320 * Math.cos(39 * Math.PI / 180));
const c = { id: 's', lat: Float64Array.from({ length: n }, () => lat0), lon: Float64Array.from({ length: n }, (_, i) => lon0 + i * dLon), distM: Float64Array.from({ length: n }, (_, i) => i * 25) };
const at = (i, dyM = 0) => [lat0 + dyM / 110540, lon0 + i * dLon];
const way = (id, tags, pts, nodes) => ({ type: 'way', id, tags, nodes, geometry: pts.map(([la, lo]) => ({ lat: la, lon: lo })) });
const node = (id, [la, lo], tags) => ({ type: 'node', id, lat: la, lon: lo, tags });
const els = { elements: [
  way(1, { highway: 'tertiary', name: 'Ridge' }, [at(-1), at(10), at(20), at(30), at(31), at(32), at(33), at(50)], [100, 110, 120, 130, 131, 132, 133, 150]),
  way(9, { highway: 'tertiary', name: 'Ridge', bridge: 'yes', lanes: '1' }, [at(50), at(53)], [150, 153]),
  way(10, { highway: 'tertiary', name: 'Ridge' }, [at(53), at(60), at(81)], [153, 160, 181]),
  way(2, { highway: 'primary', name: 'Pike' }, [at(10, -200), at(10), at(10, 200)], [210, 110, 211]),      // the route is the minor road: its stop applies
  way(3, { highway: 'residential', name: 'Lane' }, [at(20), at(20, 200)], [120, 220]),                      // a stop for Lane, not for the route
  node(110, at(10), { highway: 'stop' }), node(120, at(20), { highway: 'stop' }),
  node(130, at(30), { traffic_calming: 'hump' }), node(131, at(31), { traffic_calming: 'hump' }), node(132, at(32), { traffic_calming: 'table' }),
  node(133, at(33), { railway: 'level_crossing' }),
  node(170, at(70, 12), { hazard: 'animal_crossing', animal: 'deer' }),                                  // a sign at the roadside
  node(160, at(60), { ford: 'yes' }),                                                                     // the road through a creek
] };
const ctx = O.aggregate(c, O.parse(els), new Uint8Array(n).fill(1));
const t = { lat: Array.from(c.lat), lon: Array.from(c.lon), dist: Array.from(c.distM) };
const near = (a, b, la, lo) => Core.nearestIndex(a, b, la, lo, -1);
const ev = M.events(ctx, c, t, near);
const far = { lat: t.lat.map((v) => v + 0.01), lon: t.lon, dist: t.dist };          // a different road 1.1 km north
const chicane = M.marksOf({ points: [{ kind: 'calming', atM: 100, label: 'chicane' }, { kind: 'stop', atM: 300 }, { kind: 'stop', atM: 320 }, { kind: 'give_way', atM: 500 }, { kind: 'signal', atM: 600 }] });
console.log(JSON.stringify({ ev: ev.map((e) => ({ type: e.type, kind: e.kind, code: e.code, call: e.call, dist_m: e.dist_m })),
  far: M.events(ctx, c, far, near).length, none: M.events(null, c, t, near).length, noTrack: M.events(ctx, c, null, near).length, chicane,
  place: M.placeAt(c, 37.5), past: M.placeAt(c, 5000),
  felt: M.events(ctx, c, Object.assign({}, t, { events: [{ type: 'bump', dist_m: 790 }, { type: 'corner', dist_m: 250 }] }), near).map((e) => e.code),
  feltFar: M.events(ctx, c, Object.assign({}, t, { events: [{ type: 'bump', dist_m: 900 }] }), near).map((e) => e.code),
  feltStop: M.unfelt([{ kind: 'stop', dist_m: 250 }], [{ type: 'bump', dist_m: 250 }]).length,
  rural: M.events({ points: [{ kind: 'animal_crossing', atM: 200, label: 'deer' }, { kind: 'animal_crossing', atM: 220, label: 'deer' }, { kind: 'animal_crossing', atM: 600, label: 'cattle' },
    { kind: 'animal_crossing', atM: 900 }, { kind: 'buggy', atM: 1100, label: 'horse-drawn vehicles' }], spans: [{ kind: 'covered_bridge', fromM: 1500, toM: 1530 }, { kind: 'one_lane_bridge', fromM: 1500, toM: 1530 }] }, c, t, near)
    .map((e) => [e.code, e.call, e.dist_m]),
  surface: (() => {
    const N = (fill) => new Float32Array(n).fill(fill), un = N(NaN), sp = N(NaN), sm = N(NaN), un2 = N(NaN);
    for (let i = 10; i <= 14; i++) un[i] = 1; un[15] = 0; for (let i = 20; i <= 22; i++) sp[i] = 0;   // 250-350 m tiles, 500-550 m Overpass: one stretch
    for (let i = 40; i <= 41; i++) un[i] = 1;                                                          // 25 m of it: no call
    for (let i = 60; i <= 66; i++) sm[i] = 4; sm[12] = 5;                                              // rough 1500-1650 m; rough gravel is gravel
    for (let i = 0; i <= 5; i++) un2[i] = 1;                                                           // the route starts on it
    return { marks: M.marksOf({ channels: { unpaved: un, surface_paved: sp, smoothness: sm } }, c),
      ev: M.events({ channels: { unpaved: un, surface_paved: sp, smoothness: sm } }, c, t, near).map((e) => [e.code, e.call, e.dist_m]),
      start: M.marksOf({ channels: { unpaved: un2 } }, c), noCorridor: M.marksOf({ channels: { unpaved: un } }) };
  })(),
  union: M.union([{ code: 'GRAVEL', dist_m: 250 }], [{ code: 'GRAVEL', dist_m: 260 }, { code: 'STOP', dist_m: 100 }]).map((m) => m.code + m.dist_m),
  answered: [M.mapAnswered(ctx), M.mapAnswered({ channels: { side_roads_per_km: new Float32Array(3).fill(NaN) } }), M.mapAnswered(null)],
  feltSaved: M.unfelt([{ kind: 'calming', dist_m: 500 }], [{ type: 'bump', dist_m: 520 }]).length }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_marks_a_driver_needs_from_the_map(out):
    got = [(e["code"], e["call"], round(e["dist_m"])) for e in out["ev"]]
    assert got == [("STOP", "Stop sign", 250), ("HUMP", "Speed bumps", 750), ("RAIL", "Railway crossing", 825), ("BRIDGE", "One-lane bridge", 1275), ("FORD", "Water crossing", 1500), ("ANIMAL", "Deer crossing", 1750)]   # the span starts at its first sample matched to the bridge
    assert all(e["type"] == "mark" for e in out["ev"])


def test_nothing_invented_or_off_the_road(out):
    assert out["far"] == 0 and out["none"] == 0 and out["noTrack"] == 0
    # a chicane is no bump; a stop mapped twice is one; give-way and signals are not called
    assert out["chicane"] == [{"kind": "stop", "atM": 300, "endM": 320, "n": 2}]
    assert out["place"][0] == pytest.approx(39) and out["past"] is None


def test_each_mark_has_its_own_glyph_on_the_strip():
    js = "const I = require(process.argv[1] + '/web/instruments.js'); console.log(JSON.stringify(['STOP', 'RAIL', 'BRIDGE', 'HUMP', 'ANIMAL', 'BUGGY', 'COVERED', 'GRAVEL', 'ROUGH', 'FORD', 'NARROW', 'JUNC', 'SCHOOL', 'ICE', 'RBT', 'XYZ'].map((c) => I.tulipSVG({ type: 'mark', code: c }, '#fff', '#f70'))));"
    svgs = json.loads(subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, check=True).stdout)
    assert "<polygon" in svgs[0] and "M58 32 L80 54" in svgs[1] and "M36 30" in svgs[2] and "Q50 34" in svgs[3]
    assert len(set(svgs[:15])) == 15 and all(s.count("#f70") == 0 for s in svgs[15:])   # an unknown code: the bare hazard straight


def test_rural_signs_deer_buggies_and_a_covered_bridge(out):
    # a deer sign mapped twice is one call; the sign's animal is named; a covered one-lane bridge gets both warnings
    assert out["rural"] == [["ANIMAL", "Deer crossing", 200], ["ANIMAL", "Cattle crossing", 600], ["ANIMAL", "Animal crossing", 900],
                            ["BUGGY", "Horse-drawn buggies", 1100], ["COVERED", "Covered bridge", 1500], ["BRIDGE", "One-lane bridge", 1500]]


def test_where_the_road_turns_unpaved_or_rough(out):
    s = out["surface"]
    assert s["marks"] == [{"kind": "unpaved", "atM": 250, "endM": 550, "n": 1}, {"kind": "rough", "atM": 1500, "endM": 1650, "n": 1}]
    assert s["ev"] == [["GRAVEL", "Unpaved road", 250], ["ROUGH", "Rough road", 1500]]
    assert s["start"] == [] and s["noCorridor"] == []     # already on it: no call; no distances: nothing placed


def test_a_mapped_hump_the_track_already_calls_is_one_call(out):
    # a bump felt inside the 750-800 m run (a member's or the crowd's) is the call; one 100 m past it is a different thing
    assert out["felt"] == ["STOP", "RAIL", "BRIDGE", "FORD", "ANIMAL"]
    assert out["feltFar"] == ["STOP", "HUMP", "RAIL", "BRIDGE", "FORD", "ANIMAL"]
    assert out["feltStop"] == 1 and out["feltSaved"] == 0     # only bumps go; a saved mark (no end) uses its start


def test_a_later_answer_only_adds_and_the_map_answer_is_known(out):
    assert out["union"] == ["STOP100", "GRAVEL250"]          # the tiles' gravel stays; the map's same gravel is not twice
    assert out["answered"] == [True, False, False]          # an unavailable answer (all unknown) asks again


def test_a_deer_crossing_is_called_in_cruise_from_dusk_to_dawn():
    js = ("const M = require(process.argv[1] + '/web/road_marks.js'), r = Math.PI / 180, deer = { type: 'mark', kind: 'animal_crossing' };"
          "console.log(JSON.stringify([M.cruiseWorthy(deer, 3 * r), M.cruiseWorthy(deer, -20 * r), M.cruiseWorthy(deer, 30 * r), M.cruiseWorthy(deer, null),"
          "M.cruiseWorthy({ type: 'mark', kind: 'stop' }, -20 * r), M.cruiseWorthy(null, 0)]))")
    got = json.loads(subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, check=True).stdout)
    assert got == [True, True, False, False, False, False]
    assert "ApexRoadMarks.cruiseWorthy(e, sunAltNow())" in open(os.path.join(ROOT, "web", "cockpit.js")).read()


def test_the_road_ahead_gets_the_marks_too():
    """A free drive (no route) asks the map for the horizon's own corridor, and a mark said on the last horizon is not
    said again on the next one, which overlaps it."""
    js = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "attachHorizonMarks(t);" in js and "await contextOn([c], CTX_BUDGET_MS, 'ahead', ['osm_overpass', 'events'], { placesOnly: true });" in js
    assert "free.marksSaid = [...(free.marksSaid || []), ...old.marks.filter(" in js


def test_a_t_junction_where_the_road_ahead_ends():
    """Free driving: where the road ahead ends at a T (horizon.js tee), a mark at its end; a stop sign there is the call."""
    runner = r"""
const M = require(process.argv[1] + '/web/road_marks.js');
const t = { dist: [0, 500, 1000], lat: [35.5, 35.5045, 35.509], lon: [-83.9, -83.9, -83.9] };
const tee = M.teeMark(t);
console.log(JSON.stringify({ tee, none: M.teeMark({ dist: [0] }),
  kept: M.noTeeAtStop([tee]).length, atStop: M.noTeeAtStop([{ kind: 'stop', code: 'STOP', dist_m: 985 }, tee]).map((m) => m.code),
  farStop: M.noTeeAtStop([{ kind: 'stop', code: 'STOP', dist_m: 600 }, tee]).map((m) => m.code) }));
"""
    out = json.loads(subprocess.run([NODE, "-e", runner, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["tee"] == {"type": "mark", "kind": "tee", "code": "TJUNC", "call": "T-junction", "index": 2, "dist_m": 1000, "end_m": 1000, "lat": 35.509, "lon": -83.9}
    assert out["none"] is None and out["kept"] == 1
    assert out["atStop"] == ["STOP"] and out["farStop"] == ["STOP", "TJUNC"]
    js = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "if (h.tee && window.ApexRoadMarks && ApexRoadMarks.teeMark)" in js and "e.kind === 'tee' ? 4" in js


NARROW = r"""
const R = process.argv[1];
const O = require(R + '/web/route_ctx/osm_overpass.js'), M = require(R + '/web/road_marks.js'), Core = require(R + '/web/apex_core.js');
const n = 121, lat0 = 39, lon0 = -84.5, dLon = 25 / (111320 * Math.cos(39 * Math.PI / 180));   // 3 km east-west, 25 m samples
const c = { id: 's', lat: Float64Array.from({ length: n }, () => lat0), lon: Float64Array.from({ length: n }, (_, i) => lon0 + i * dLon), distM: Float64Array.from({ length: n }, (_, i) => i * 25) };
const at = (i) => [lat0, lon0 + i * dLon];
const way = (id, tags, a, b) => ({ type: 'way', id, tags, nodes: [id * 10, id * 10 + 1], geometry: [at(a), at(b)].map(([la, lo]) => ({ lat: la, lon: lo })) });
const run = (ways) => {
  const ctx = O.aggregate(c, O.parse({ elements: ways }), new Uint8Array(n).fill(1));
  const t = { lat: Array.from(c.lat), lon: Array.from(c.lon), dist: Array.from(c.distM) };
  return { spans: ctx.spans.filter((s) => s.kind === 'single_track').map((s) => [s.fromM, s.toM, s.label || null]),
    ev: M.events(ctx, c, t, (a, b, la, lo) => Core.nearestIndex(a, b, la, lo, -1)).map((e) => [e.code, e.call, e.dist_m]) };
};
console.log(JSON.stringify({
  // two lanes, then a single track 500-1000 m, a mapped passing place (two lanes, 100 m), one again to 1600 m, two lanes
  road: run([way(1, { highway: 'tertiary' }, -1, 20), way(2, { highway: 'tertiary', lanes: '1', name: 'Hollow Rd' }, 20, 40),
    way(3, { highway: 'tertiary', lanes: '2' }, 40, 44), way(4, { highway: 'tertiary', lanes: '1' }, 44, 64), way(5, { highway: 'tertiary', lanes: '2' }, 64, 121)]),
  // a one-way lane, a one-lane bridge (its own call), a driveway and a 100 m pinch are not a narrow road
  not: run([way(1, { highway: 'secondary', lanes: '1', oneway: 'yes' }, -1, 30), way(2, { highway: 'secondary', lanes: '1', bridge: 'yes' }, 30, 40),
    way(3, { highway: 'service', lanes: '1' }, 40, 70), way(4, { highway: 'secondary' }, 70, 80), way(5, { highway: 'secondary', lanes: '1' }, 80, 84), way(6, { highway: 'secondary' }, 84, 121)]),
  // the route starts on it: the car is already on the narrow road
  start: run([way(1, { highway: 'unclassified', lanes: '1' }, -1, 40), way(2, { highway: 'unclassified' }, 40, 121)]),
  untagged: run([way(1, { highway: 'tertiary' }, -1, 121)]) }));
"""


def test_a_narrow_road_where_it_narrows_to_one_lane():
    """A two-way road the map has as one lane is a single track: "Narrow road" where it starts, once for the stretch."""
    out = json.loads(subprocess.run([NODE, "-e", NARROW, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["road"]["ev"] == [["NARROW", "Narrow road", 525]]          # its first sample matched to it; the passing place is no second call
    assert out["road"]["spans"][0][2] == "Hollow Rd" and len(out["road"]["spans"]) == 2
    assert [e[0] for e in out["not"]["ev"]] == ["BRIDGE"] and out["not"]["spans"] == [[2025, 2100, None]]   # the pinch: a span, too short to call
    assert out["start"]["ev"] == [] and out["untagged"] == {"spans": [], "ev": []}


JUNCTION = r"""
const R = process.argv[1];
const O = require(R + '/web/route_ctx/osm_overpass.js'), M = require(R + '/web/road_marks.js'), Core = require(R + '/web/apex_core.js');
const n = 81, lat0 = 39, lon0 = -84.5, dLon = 25 / (111320 * Math.cos(39 * Math.PI / 180));   // 2 km east-west, 25 m samples
const c = { id: 's', lat: Float64Array.from({ length: n }, () => lat0), lon: Float64Array.from({ length: n }, (_, i) => lon0 + i * dLon), distM: Float64Array.from({ length: n }, (_, i) => i * 25) };
const at = (i, dyM = 0) => [lat0 + dyM / 110540, lon0 + i * dLon];
const way = (id, tags, pts, nodes) => ({ type: 'way', id, tags, nodes, geometry: pts.map(([la, lo]) => ({ lat: la, lon: lo })) });
// the road, with a lane joining at 500 m, another at 1250 m, a driveway at 1500 m and a stop-controlled crossroad at 1750 m
const els = { elements: [
  way(1, { highway: 'tertiary' }, [at(-1), at(20), at(50), at(60), at(70), at(81)], [100, 120, 150, 160, 170, 181]),
  way(2, { highway: 'unclassified' }, [at(20), at(20, 300)], [120, 220]), way(3, { highway: 'residential' }, [at(50), at(50, -300)], [150, 250]),
  way(4, { highway: 'service' }, [at(60), at(60, 100)], [160, 260]), way(5, { highway: 'secondary' }, [at(70, -300), at(70), at(70, 300)], [270, 170, 271]),
  { type: 'node', id: 170, lat: at(70)[0], lon: at(70)[1], tags: { highway: 'stop' } },
] };
const ctx = O.aggregate(c, O.parse(els), new Uint8Array(n).fill(1));
const dist = Array.from({ length: 401 }, (_, i) => i * 5);
const t = (sight) => ({ lat: dist.map(() => lat0), lon: dist.map((d) => lon0 + d / 25 * dLon), dist, sightM: sight ? dist.map(sight) : undefined });
const near = (a, b, la, lo) => Core.nearestIndex(a, b, la, lo, -1);
const ev = (tr) => M.events(ctx, c, tr, near).filter((e) => e.kind === 'side_road' || e.kind === 'stop').map((e) => [e.code, e.call, e.dist_m]);
// a blind bend before 500 m (40 m of sight from 400 to 440 m) and before 1750 m, open road elsewhere
const blind = (d) => (d >= 400 && d <= 440) || (d >= 1650 && d <= 1690) ? 40 : 400;
console.log(JSON.stringify({ points: ctx.points.filter((p) => p.kind === 'side_road').map((p) => p.atM),
  blind: ev(t(blind)), open: ev(t(() => 400)), unknown: ev(t(null)),
  hidden: [M.hidden(t(blind), 100), M.hidden(t(blind), 10), M.hidden(t(null), 100)] }));
"""


def test_a_hidden_junction_where_a_side_road_joins_out_of_sight():
    """A public road joining where you can't see it until you're within 80 m (a blind bend) is "Hidden junction"; one
    you can see coming, a driveway, and one at a stop sign (the stop is the call) are not. Unknown sight is never hidden."""
    out = json.loads(subprocess.run([NODE, "-e", JUNCTION, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["points"] == [500, 1250, 1750]                     # public roads only, not the driveway
    assert out["blind"] == [["JUNC", "Hidden junction", 500], ["STOP", "Stop sign", 1750]]
    assert out["open"] == [["STOP", "Stop sign", 1750]] and out["unknown"] == out["open"]
    assert out["hidden"] == [True, False, False]
    js = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "(e.type === 'corner' || e.kind === 'side_road') && ApexDirections.atJunction(steps, noteM(e))" in js   # the route's own turn is the direction


ICY = r"""
const R = process.argv[1];
const O = require(R + '/web/route_ctx/osm_overpass.js'), M = require(R + '/web/road_marks.js'), Core = require(R + '/web/apex_core.js');
const n = 161, lat0 = 39, lon0 = -84.5, dLon = 25 / (111320 * Math.cos(39 * Math.PI / 180));   // 4 km east-west, 25 m samples
const c = { id: 's', lat: Float64Array.from({ length: n }, () => lat0), lon: Float64Array.from({ length: n }, (_, i) => lon0 + i * dLon), distM: Float64Array.from({ length: n }, (_, i) => i * 25) };
const at = (i) => [lat0, lon0 + i * dLon];
const way = (id, tags, a, b) => ({ type: 'way', id, tags, nodes: [id * 10, id * 10 + 1], geometry: [at(a), at(b)].map(([la, lo]) => ({ lat: la, lon: lo })) });
const road = { highway: 'tertiary' };
const ctx = O.aggregate(c, O.parse({ elements: [way(1, road, -1, 20), way(2, { ...road, bridge: 'yes', name: 'Mill Creek Bridge' }, 20, 22), way(3, road, 22, 30),
  way(4, { ...road, bridge: 'yes' }, 30, 31), way(5, road, 31, 80), way(6, { ...road, bridge: 'yes', lanes: '1' }, 80, 82), way(7, road, 82, 120),
  way(8, { ...road, bridge: 'yes' }, 120, 122), way(9, road, 122, 161)] }), new Uint8Array(n).fill(1));
const t = { lat: Array.from(c.lat), lon: Array.from(c.lon), dist: Array.from(c.distM) };
// our tiles' bridge spans (osm_tiles.js 'bridge', motorways too) are not read; a second answer of the same bridge is one
const twice = { ...ctx, spans: [...ctx.spans, { kind: 'bridge', fromM: 1800, toM: 1850 }, { kind: 'road_bridge', fromM: 3010, toM: 3050 }] };
const mway = O.aggregate(c, O.parse({ elements: [way(1, { highway: 'motorway', oneway: 'yes' }, -1, 60), way(2, { highway: 'motorway', oneway: 'yes', bridge: 'yes' }, 60, 62), way(3, { highway: 'motorway', oneway: 'yes' }, 62, 161)] }), new Uint8Array(n).fill(1));
console.log(JSON.stringify({ mway: M.events(mway, c, t, (a, b, la, lo) => Core.nearestIndex(a, b, la, lo, -1)).length, spans: ctx.spans.filter((s) => s.kind === 'road_bridge').map((s) => [s.fromM, s.label || null]),
  ev: M.events(twice, c, t, (a, b, la, lo) => Core.nearestIndex(a, b, la, lo, -1)).map((e) => [e.code, e.call, e.dist_m]),
  cold: [3, 0, -10, 3.5, 12, null, undefined, NaN].map(M.bridgeCold), cruise: M.cruiseWorthy({ type: 'mark', kind: 'icy_bridge' }, 1) }));
"""


def test_a_bridge_may_be_icy_in_the_cold():
    """Any bridge on the road is a cold-weather call, "Bridge may be icy": bridges less than 500 m apart are one call
    (plural), a one-lane bridge keeps its own call, and the same bridge from two answers is one. Not on motorways or trunk
    roads. Said only at 3 C or colder."""
    out = json.loads(subprocess.run([NODE, "-e", ICY, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["spans"][0] == [525, "Mill Creek Bridge"] and len(out["spans"]) == 4
    assert out["ev"] == [["ICE", "Bridges may be icy", 525], ["BRIDGE", "One-lane bridge", 2025], ["ICE", "Bridge may be icy", 3000]]
    assert out["cold"] == [True, True, True, False, False, False, False, False]
    assert out["cruise"] is True                                          # in the cold, at any pace: ice on a straight is ice
    assert out["mway"] == 0                                               # not a motorway's bridges: one every mile


def test_the_road_ahead_that_meets_a_roundabout_says_it():
    """horizon.js ends the road ahead at a roundabout (end 'roundabout'); the page lays a "Roundabout" mark there, braked
    for like the T (to the ring's entry, about 15 mph)."""
    js = r"""
const M = require(process.argv[1] + '/web/road_marks.js');
const t = { lat: [35.5, 35.51], lon: [-83.9, -83.9], dist: [0, 1110] };
console.log(JSON.stringify({ rb: M.roundaboutMark(t), tee: M.teeMark(t).code, none: M.roundaboutMark({ dist: [0] }) }));
"""
    o = json.loads(subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, check=True).stdout)
    assert o["rb"]["code"] == "RBT" and o["rb"]["call"] == "Roundabout" and o["rb"]["dist_m"] == 1110 and o["tee"] == "TJUNC" and o["none"] is None
    src = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "h.end === 'roundabout' && window.ApexRoadMarks && ApexRoadMarks.roundaboutMark" in src
    assert "e.kind === 'roundabout' ? 7" in src
