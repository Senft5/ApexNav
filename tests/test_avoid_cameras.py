"""Avoid cameras (web/fun_route.js camerasToExclude, IDEAS R-35): cameras near the trip, nearest its line first, capped;
and every candidate keeps to it (unavoided/keepAvoiding with the plan's camera list, avoid.cams), not only Valhalla's.
Plate readers and fixed speed cameras alike: the camera map has both (web/cameras.js), and the plan takes every kind."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const F = require(process.argv[1] + '/web/fun_route.js');
const pts = [{ lat: 35.0, lon: -84.0 }, { lat: 35.2, lon: -84.0 }];
const nodes = [
  { lat: 35.1, lon: -84.03 },          // ~2.7 km off: outside the 2 km pad round the trip
  { lat: 35.1, lon: -84.001 },         // on the line
  { lat: 35.15, lon: -84.01 },         // ~0.9 km off
  { lat: 36.0, lon: -84.0 },           // far north
  { lat: NaN, lon: -84.0 }, null,
];
console.log(JSON.stringify({
  all: F.camerasToExclude(nodes, pts),
  one: F.camerasToExclude(nodes, pts, 1),
  none: F.camerasToExclude(nodes, pts, 0),
  short: F.camerasToExclude(nodes, [pts[0]]),
  dflt: F.AVOID_DEFAULT.cameras, label: F.AVOID_LABELS.cameras,
}));

"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_near_the_trip_nearest_first(out):
    assert out["all"] == [{"lat": 35.1, "lon": -84.001}, {"lat": 35.15, "lon": -84.01}]
    assert out["one"] == [{"lat": 35.1, "lon": -84.001}]


def test_nothing_to_send(out):
    assert out["none"] == [] and out["short"] == []


def test_off_by_default(out):
    assert out["dflt"] is False and out["label"] == "cameras"


KEEP = r"""
globalThis.ApexHazardReports = require(process.argv[1] + '/web/hazard_reports.js');
const F = require(process.argv[1] + '/web/fun_route.js');
const cams = [{ lat: 35.1, lon: -84.0 }];                                   // a speed camera on the straight road
const by = [[-84.0, 35.0], [-84.0, 35.2]];                                   // [lon, lat]: past it
const beside = [[-84.0005, 35.0], [-84.0005, 35.2]];                         // a parallel road ~45 m off: not past it
const round = [[-84.0, 35.0], [-84.02, 35.1], [-84.0, 35.2]];                // 1.8 km round it
const avoid = { ...F.AVOID_DEFAULT, cameras: true, cams };
const cands = () => [{ route: { coords: by, has: {} }, timeS: 600 }, { route: { coords: round, has: {} }, timeS: 700 }];
const c1 = cands(), only = [{ route: { coords: by, has: {} }, timeS: 600 }];
console.log(JSON.stringify({
  kept: F.keepAvoiding(c1, avoid).map((c) => c.timeS),
  unavoided: F.unavoided(avoid, c1[0].route),
  later: F.unavoided({ ...F.AVOID_DEFAULT, cameras: true }, c1[0].route),    // the card, later: kept on the route
  beside: F.unavoided(avoid, { coords: beside, has: {} }),
  off: F.unavoided({ ...F.AVOID_DEFAULT, cams }, { coords: by, has: {} }),
  unknown: F.unavoided({ ...F.AVOID_DEFAULT, cameras: true }, { coords: by, has: {} }),
  onlyOne: F.keepAvoiding(only, avoid).map((c) => c.timeS),
  both: F.unavoided({ ...avoid, police: true, points: [{ lat: 35.15, lon: -84.0 }] }, { coords: by, has: {} }),
  m: F.CAMERA_ON_M,
}));
"""


@pytest.fixture(scope="module")
def keep():
    return json.loads(subprocess.run([NODE, "-e", KEEP, ROOT], capture_output=True, text=True, check=True).stdout)


def test_a_route_past_a_camera_gives_way_to_one_round_it(keep):
    assert keep["kept"] == [700]
    assert keep["unavoided"] == ["cameras"] and keep["later"] == ["cameras"]


def test_only_a_route_that_drives_past_one_counts(keep):
    assert keep["m"] == 35
    assert keep["beside"] == [] and keep["off"] == []
    assert keep["unknown"] == []          # no camera list for this plan (map offline, trip too big): nothing said


def test_when_none_can_the_route_stays_and_says_so(keep):
    assert keep["onlyOne"] == [600]
    assert keep["both"] == ["police", "cameras"]
