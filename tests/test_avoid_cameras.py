"""Avoid cameras (web/fun_route.js camerasToExclude, IDEAS R-35): cameras near the trip, nearest its line first, capped;
and whether a route still passes one (unavoided: 'cameras', the card's "Couldn't avoid cameras"), which also steers our
own router's candidates (keepAvoiding). Speed cameras count as plate readers do (web/cameras.js classify)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
globalThis.ApexHazardReports = require(process.argv[1] + '/web/hazard_reports.js');
const F = require(process.argv[1] + '/web/fun_route.js');
const C = require(process.argv[1] + '/web/cameras.js');
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
  pass: (() => {
    const cam = { lat: 35.1, lon: -84.0 };
    const by = [[-84.0, 35.0], [-84.0, 35.2]];                       // [lon, lat], over the camera
    const beside = [[-84.0002, 35.0], [-84.0002, 35.2]];             // ~18 m off: a camera mapped beside its road
    const parallel = [[-84.003, 35.0], [-84.003, 35.2]];             // ~270 m off: the next road over
    const avoid = { ...F.AVOID_DEFAULT, cameras: true, cams: [cam] };
    const cands = [{ route: { coords: by, has: {} }, timeS: 600 }, { route: { coords: parallel, has: {} }, timeS: 700 }];
    const r = { by: F.unavoided(avoid, { coords: by }), beside: F.unavoided(avoid, { coords: beside }), parallel: F.unavoided(avoid, { coords: parallel }),
      kept: F.keepAvoiding(cands, avoid).map((c) => c.timeS),
      unknown: F.unavoided({ ...F.AVOID_DEFAULT, cameras: true }, { coords: by }),
      off: F.unavoided({ ...F.AVOID_DEFAULT, cams: [cam] }, { coords: by }) };
    const later = { coords: by }; F.unavoided(avoid, later);
    r.later = F.unavoided({ ...F.AVOID_DEFAULT, cameras: true }, later);   // kept on the route for the card
    r.both = F.unavoided({ ...avoid, police: true, points: [cam] }, { coords: by });
    return r;
  })(),
  speed: C.classify({ type: 'node', id: 7, lat: 35.1, lon: -84.0, tags: { highway: 'speed_camera' } }),
  passM: F.CAMERA_PASS_M,
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


def test_a_route_over_a_camera_says_so_and_gives_way_to_one_round_it(out):
    p = out["pass"]
    assert out["passM"] == 25
    assert p["by"] == ["cameras"] and p["beside"] == ["cameras"] and p["parallel"] == []
    assert p["kept"] == [700]
    assert p["later"] == ["cameras"] and p["both"] == ["police", "cameras"]


def test_unknown_cameras_say_nothing(out):
    """No camera list (the camera map slow or offline): no "Couldn't avoid" either way; off: nothing."""
    p = out["pass"]
    assert p["unknown"] == [] and p["off"] == []


def test_speed_cameras_are_cameras(out):
    assert out["speed"] == {"id": 7, "lat": 35.1, "lon": -84.0, "kind": "speed"}
