"""Traffic as a fun penalty (web/traffic.js): Apple's path must follow ours, congestion costs fun without delay, detours."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const T = require(process.argv[1]);
const out = {};
// A straight road north from (45, -122): one sample per 5 m.
const line = (n, lon = -122, lat0 = 45) => ({ lat: Array.from({ length: n }, (_, i) => lat0 + i * 5 / 110540), lon: Array(n).fill(lon) });
const road = line(401);                                                     // 2 km
const apple = (s, path = road) => ({ s, lat: path.lat.filter((_, i) => i % 10 === 0), lon: path.lon.filter((_, i) => i % 10 === 0) });
const parallel = line(401, -122 + 300 / (111320 * Math.cos(45 * Math.PI / 180)));   // a road 300 m east

out.chunks = T.chunksAhead(Array.from({ length: 5001 }, (_, i) => i * 5), 1000).map(c => [c.startM, c.endM]);
out.shortTail = T.chunksAhead(Array.from({ length: 1801 }, (_, i) => i * 5), 0).map(c => [c.startM, c.endM]);
out.nearEnd = T.chunksAhead(Array.from({ length: 201 }, (_, i) => i * 5), 300);

out.clear = T.classifyChunk(road, apple(130), apple(120));
out.slowNoDelay = T.classifyChunk(road, apple(40), apple(30));             // 1.33x but only 10 s lost
out.jam = T.classifyChunk(road, apple(400), apple(120));
out.shortJam = T.classifyChunk(road, apple(70), apple(30));                // 2.3x, 40 s: slow, not a jam
out.otherRoad = T.classifyChunk(road, apple(400, parallel), apple(120));   // Apple took another road: unknown
out.noNight = T.classifyChunk(road, apple(400), null);
out.nightFaster = T.classifyChunk(road, apple(100), apple(120));            // never below 1

// Fun: a 2 km road with a good corner every 100 m (score 100 per piece).
const track = { lat: road.lat, lon: road.lon, dist: road.lat.map((_, i) => i * 5),
                events: Array.from({ length: 20 }, (_, k) => ({ type: 'corner', severity: 3, index: 10 + 20 * k })) };
const probe = (level, ratio) => ({ lat: road.lat, lon: road.lon, level, ratio, delayS: 0 });
out.funClear = T.routeFun(track, []);
out.funSlow = T.routeFun(track, [probe('slow', 1.3)]);
out.funJam = T.routeFun(track, [probe('jam', 3)]);
out.funUnknown = T.routeFun(track, [probe('unknown', null)]);
out.funElsewhere = T.routeFun(track, [{ ...parallel, level: 'jam', ratio: 3 }]);

out.pick = T.pickDetour({ fun: 20, timeS: 1800, delayS: 600 }, [
  { fun: 60, timeS: 2000, crossesJam: true },        // crosses the jam: never
  { fun: 40, timeS: 3600, crossesJam: false },       // +20 min over the jammed route: too long
  { fun: 30, timeS: 2500, crossesJam: false },       // +100 s: take it
  { fun: 25, timeS: 2300, crossesJam: false }]);
out.stay = T.pickDetour({ fun: 50, timeS: 1800, delayS: 300 }, [{ fun: 50.2, timeS: 1800, crossesJam: false }]);
out.boxes = T.jamPolygons([probe('jam', 3), probe('slow', 1.3)]).length;
out.manyBoxes = T.jamPolygons(Array(6).fill(probe('jam', 3))).length;

const m = new T.TrafficMonitor(), log = [];
for (let s = 0; s <= 1200; s += 10) {
  const t = s * 1000;
  if (m.due(t)) { m.started(); log.push(s); m.done(t, { throttled: s >= 240 && s < 600 }); }
}
out.schedule = log;
const r = new T.TrafficMonitor(); r.routeChanged(0);
out.afterSwitch = [r.due(60000), r.due(120000)];
const q = new T.TrafficMonitor();
out.say = [q.shouldSay('a', 0), q.shouldSay('a', 300000), q.shouldSay('b', 300000), q.shouldSay('a', 600000)];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    path = os.path.abspath("web/traffic.js")
    out = subprocess.run([NODE, "-e", RUNNER, path], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_chunks_cover_the_next_20_km(r):
    assert r["chunks"] == [[1000, 5000], [5000, 9000], [9000, 13000], [13000, 17000], [17000, 21000]]
    assert r["shortTail"] == [[0, 4000], [4000, 8000], [8000, 9000]], "a tail of 1 km or more is its own chunk"
    assert r["nearEnd"] == [], "under 1 km left: nothing to ask"


def test_levels(r):
    assert r["clear"]["level"] == "clear"
    assert r["jam"]["level"] == "jam" and r["jam"]["delayS"] == 280
    assert r["slowNoDelay"]["level"] == "slow", "congestion counts even when it costs only seconds"
    assert r["shortJam"]["level"] == "slow", "a jam needs 60 s lost"
    assert r["nightFaster"]["ratio"] == 1


def test_never_claims_traffic_without_a_matching_path(r):
    assert r["otherRoad"]["level"] == "unknown" and r["otherRoad"]["ratio"] is None
    assert r["noNight"]["level"] == "unknown"


def test_congestion_lowers_fun(r):
    assert r["funClear"]["fun"] == pytest.approx(100, rel=0.05)
    assert r["funSlow"]["fun"] == pytest.approx(r["funClear"]["fun"] / 1.3 ** 2, rel=1e-6)
    assert r["funJam"]["fun"] == pytest.approx(r["funClear"]["fun"] / 9, rel=1e-6)
    assert r["funJam"]["crossesJam"] and r["funJam"]["jamM"] == pytest.approx(2000, abs=1)
    assert r["funJam"]["rawFun"] == r["funClear"]["fun"]
    assert r["funUnknown"]["fun"] == r["funClear"]["fun"], "unknown traffic is no penalty"
    assert r["funElsewhere"]["fun"] == r["funClear"]["fun"], "a jam on another road is not ours"


def test_detour_choice(r):
    assert r["pick"]["index"] == 2 and r["pick"]["extraS"] == 100
    assert r["stay"] is None, "not enough more fun to switch"


def test_exclusion_boxes(r):
    assert r["boxes"] == 3
    assert r["manyBoxes"] == 12, "Valhalla caps total exclusion perimeter"


def test_probe_schedule(r):
    # every 2 min; throttled at 240 and 480 -> 4 then 8 min backoff; back to 2 min after a clean probe
    assert r["schedule"] == [0, 120, 240, 480, 960, 1080, 1200]
    assert r["afterSwitch"] == [False, True]
    assert r["say"] == [True, False, True, True]
