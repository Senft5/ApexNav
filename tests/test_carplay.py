"""What the car's screen is told (web/carplay.js, CarPlay/ApexCarPlay.swift): the route line, up to three choices, the
next maneuver with distances, and recent places; nothing invented when a value is unknown."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/carplay.js'), D = require(process.argv[1] + '/web/directions.js');
const n = 1001, t = { id: 'route_dest', name: 'To Robbinsville', lat: [], lon: [], dist: [], timeS: 4620, fun: { fun: 99 },
  steps: [{ m: 1200, type: 15, street: 'Deals Gap Road' }, { m: 3000, type: 8 }, { m: 4990, type: 4 }] };
for (let i = 0; i < n; i++) { t.lat.push(35.3 + i * 5 / 110540); t.lon.push(-83.8); t.dist.push(i * 5); }
const opts = [{ fun: { fun: 99 }, timeS: 4620, distM: null }, { fun: { fun: 40 }, timeS: 3900, distM: 70000 }];
console.log(JSON.stringify({
  line: C.line(t).length, ends: [C.line(t)[0], C.line(t).slice(-1)[0]],
  one: C.routeMessage(t, null, 0, (m) => `${(m / 1609.344).toFixed(1)} mi`),
  two: C.routeMessage(t, opts, 1, null),
  none: C.routeMessage({ lat: [1], lon: [1], dist: [0] }, null, 0),
  g0: C.guideMessage(t, 100, 3600, D.phrase), g1: C.guideMessage(t, 1300, null, D.phrase), g2: C.guideMessage(t, 4995, 0, D.phrase),
  places: C.placesMessage([{ label: 'Home', lat: 35.1, lon: -83.2 }, { label: 'Bad', lat: null, lon: 1 }, null]),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_route_line_is_small_and_keeps_both_ends(out):
    assert out["line"] <= 401
    assert out["ends"] == [[35.3, -83.8], [round(35.3 + 1000 * 5 / 110540, 6), -83.8]]


def test_route_choices(out):
    one = out["one"]
    assert one["kind"] == "route" and one["name"] == "To Robbinsville" and one["picked"] == 0
    assert one["options"] == [{"summary": "Fun 99 · 77 min", "detail": "3.1 mi", "timeS": 4620, "distM": 5000}]
    two = out["two"]
    assert [o["summary"] for o in two["options"]] == ["Fun 99 · 77 min", "Fun 40 · 65 min"] and two["picked"] == 1
    assert two["options"][0]["distM"] is None, "an option not built yet has no known length"
    assert out["none"] is None


def test_next_maneuver(out):
    assert out["g0"] == {"kind": "guide", "key": "route_dest:1200", "instruction": "Turn left onto Deals Gap Road", "street": "Deals Gap Road",
                         "type": 15, "distM": 1100, "remainM": 4900, "remainS": 3600}
    assert out["g1"]["instruction"] == "Arriving at your destination", "a step that isn't said (continue) is skipped"
    assert out["g1"]["remainS"] is None, "unknown time stays unknown"
    assert out["g2"] is None or out["g2"]["distM"] == 0


def test_places(out):
    assert out["places"] == {"kind": "places", "list": [{"name": "Home", "at": [35.1, -83.2]}]}


def test_only_road_hazards_alert_the_car():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert "if (text && opts.alert && driveActive) carPost({ kind: 'hazard'" in html
    # the urgent speech lane also carries turn-now directions and crests: only member, reported and convoy hazards set alert
    assert html.count("alert: true") == 3
