"""A day out with stops (web/trip_stops.js, IDEAS R-17): your stops listed, moved and removed; shaping points aren't stops."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const T = require(process.argv[1] + '/web/trip_stops.js');
const req = { via: [{ lat: 1, lon: 1, shaping: true }, { lat: 2, lon: 2, label: 'Look Rock', distM: 500 }, { lat: 3, lon: 3, shaping: true }, { lat: 4, lon: 4 }, { lat: 5, lon: 5, label: 'Cafe' }] };
console.log(JSON.stringify({ stops: T.stops(req), up: T.move(req, 2, -1), down: T.move(req, 0, 1), edge: T.move(req, 0, -1), rm: T.remove(req, 1), none: T.stops(null) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_stops(out):
    assert out["stops"] == [{"i": 1, "label": "Look Rock", "lat": 2, "lon": 2}, {"i": 3, "label": "Stop 1", "lat": 4, "lon": 4},
                            {"i": 4, "label": "Cafe", "lat": 5, "lon": 5}]
    assert out["none"] == []


def test_move_and_remove(out):
    assert [v["lat"] for v in out["up"]] == [2, 5, 4]
    assert [v["lat"] for v in out["down"]] == [4, 2, 5]
    assert [v["lat"] for v in out["edge"]] == [2, 4, 5]
    assert out["rm"] == [{"lat": 2, "lon": 2, "label": "Look Rock"}, {"lat": 5, "lon": 5, "label": "Cafe"}]
