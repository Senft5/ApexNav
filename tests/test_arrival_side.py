"""Which side of the road the destination is on (web/directions.js arrivalSide), said and shown at the arrival as Apple
and Google Maps do: from the router's own word (Valhalla 5 right, 6 left), else from where the place lies against the
route's last metres; straight ahead, on the road or far off says nothing."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const D = require(process.argv[1] + '/web/directions.js');
const M = 110540, K = Math.cos(39.1 * Math.PI / 180) * 111320;
// a road heading north along lon -84.5, 200 m long, ending at 39.1
const lat = [], lon = [];
for (let i = 0; i <= 40; i++) { lat.push(39.1 - (40 - i) * 5 / M); lon.push(-84.5); }
const at = (east, north) => ({ lat: 39.1 + north / M, lon: -84.5 + east / K });
// heading east instead (a check that it isn't tied to north)
const latE = lat.map(() => 39.1), lonE = lat.map((_, i) => -84.5 - (40 - i) * 5 / K);
console.log(JSON.stringify({
  right: D.arrivalSide(lat, lon, at(25, 0)), left: D.arrivalSide(lat, lon, at(-25, -5)),
  ahead: D.arrivalSide(lat, lon, at(3, 60)), onRoad: D.arrivalSide(lat, lon, at(2, 1)), far: D.arrivalSide(lat, lon, at(400, 0)),
  eastRight: D.arrivalSide(latE, lonE, at(0, -30)), eastLeft: D.arrivalSide(latE, lonE, at(0, 30)),
  none: [D.arrivalSide([], [], at(10, 0)), D.arrivalSide(lat, lon, null)],
  said: [D.phrase({ type: 4, side: 'right' }), D.phrase({ type: 5 }), D.phrase({ type: 6 }), D.phrase({ type: 4, side: null }), D.phrase({ type: 4 })],
  strip: [D.stripNote({ type: 4, side: 'left' }).call, D.stripNote({ type: 4 }).call],
}));
"""


@pytest.fixture(scope="module")
def got():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def test_the_side_the_place_lies(got):
    assert got["right"] == "right" and got["left"] == "left"
    assert got["eastRight"] == "right" and got["eastLeft"] == "left"


def test_ahead_on_the_road_or_far_says_nothing(got):
    assert got["ahead"] is None and got["onRoad"] is None and got["far"] is None
    assert got["none"] == [None, None]


def test_said_and_shown(got):
    assert got["said"] == ["Your destination is on the right", "Your destination is on the right", "Your destination is on the left",
                           "Arriving at your destination", "Arriving at your destination"]
    assert got["strip"] == ["Destination on the left", "Destination"]
