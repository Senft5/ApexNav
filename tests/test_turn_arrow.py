"""The arrow at the next turn on the drive's map (web/turn_arrow.js): the route's own line through the junction, from
before the turn to past it, a head pointing the way the route leaves; none for an arrival or a step off the route."""
import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
ROOT = Path(__file__).resolve().parents[1]

# an L: 300 m north, then 300 m east, a vertex every 10 m; the turn at 300 m
RUNNER = r"""
const A = require(process.argv[1] + '/web/turn_arrow.js');
const KY = 111195, lat0 = 39.1, KX = 111195 * Math.cos(lat0 * Math.PI / 180), t = { lat: [], lon: [], dist: [] };
for (let k = 0; k <= 60; k++) { const n = Math.min(k, 30) * 10, e = Math.max(0, k - 30) * 10;
  t.lat.push(lat0 + n / KY); t.lon.push(-84.5 + e / KX); t.dist.push(k * 10); }
const xy = ([lon, lat]) => [(lon + 84.5) * KX, (lat - lat0) * KY];
const fc = A.arrow(t, { m: 300, type: 10 }, { before: 45, after: 30, head: 14, halfW: 9 });
console.log(JSON.stringify({
  shaft: fc.features[0].geometry.coordinates.map(xy), head: fc.features[1].geometry.coordinates[0].map(xy),
  parts: fc.features.map((f) => [f.properties.part, f.geometry.type]),
  end: A.arrow(t, { m: 595, type: 15 }, { before: 45, after: 30, head: 14, halfW: 9 }) ? 'ok' : null,
  none: [A.arrow(t, { m: 600, type: 4 }), A.arrow(t, { m: 700, type: 10 }), A.arrow(t, { m: -5, type: 10 }), A.arrow(t, null),
         A.arrow({ lat: [1], lon: [1], dist: [0] }, { m: 0, type: 10 }), A.arrow(t, { m: NaN, type: 10 }), A.arrow(t, { m: 2, type: 10 }, { before: 0, after: 5, head: 14 })],
  at: A.pointAt(t, 305) && xy([A.pointAt(t, 305).lon, A.pointAt(t, 305).lat]), off: A.pointAt(t, 601),
}));
"""


@pytest.fixture(scope="module")
def out():
    if not NODE:
        pytest.skip("node not installed")
    return json.loads(subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, check=True).stdout)


def close(a, b, tol=0.5):
    return abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol


def test_shaft_follows_the_route_through_the_turn(out):
    shaft = out["shaft"]
    assert out["parts"] == [["shaft", "LineString"], ["head", "Polygon"]]
    assert close(shaft[0], [0, 255])                     # 45 m before the turn, on the northbound leg
    assert any(close(p, [0, 300]) for p in shaft)        # through the corner itself
    assert close(shaft[-1], [16, 300])                   # to the head's base: 30 m past, less the 14 m head


def test_head_points_the_way_the_route_leaves(out):
    left, tip, right, first = out["head"]
    assert first == left                                 # a closed ring
    assert close(tip, [30, 300])                         # the tip 30 m past the turn, east
    assert close(left, [16, 309]) and close(right, [16, 291])   # 9 m either side of the base, square to the way out
    assert math.hypot(tip[0] - 16, tip[1] - 300) == pytest.approx(14, abs=0.5)


def test_near_the_end_it_stops_at_the_route_end(out):
    assert out["end"] == "ok"                            # a turn 5 m from the end still has an arrow, cut short
    assert close(out["at"], [5, 300])
    assert out["off"] is None


def test_no_arrow(out):
    # an arrival, a step past the end or before the start, no step, a one-point track, no distance, too short a run
    assert out["none"] == [None] * 7
