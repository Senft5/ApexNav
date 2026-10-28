"""Avoid cameras (web/fun_route.js camerasToExclude, IDEAS R-35): cameras near the trip, nearest its line first, capped."""
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
