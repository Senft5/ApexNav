"""Along the way, live (web/along_ahead.js): on a planned route the co-driver says the last fuel before 80 km or more with
none ("Last fuel for 52 miles, in half a mile, on the right."), an EV its chargers, and a viewpoint or waterfall by name,
at most one every 5 minutes; each once, on the side of the road it is on."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const A = require(process.argv[1] + '/web/along_ahead.js'), U = require(process.argv[1] + '/web/units.js');
const KY = 110540, kx = 111320 * Math.cos(35.5 * Math.PI / 180);
// 200 km due north, 50 m samples
const n = 4001, dist = Array.from({ length: n }, (_, i) => i * 50), lat = dist.map((m) => 35.5 + m / KY), lon = dist.map(() => -83.9);
const off = (m, eastM) => ({ lat: 35.5 + m / KY, lon: -83.9 + eastM / kx, m });
const scenic = [
  { kind: 'fuel', ...off(5000, 60) },                       // fuel at 5 km, the next at 20 km: no line
  { kind: 'fuel', ...off(20000, 80) },                      // then none for 90 km: the last fuel, on the right (east)
  { kind: 'view', name: "Wiseman's View", ...off(30000, -150) },
  { kind: 'view', name: null, ...off(33000, 0) },           // 3 km on: within 5 minutes of the last
  { kind: 'falls', name: 'A Very Long Name For A Waterfall That Goes On', ...off(60000, 200) },
  { kind: 'fuel', ...off(110000, -40) },                    // the next; then 90 km to the end
  { kind: 'charge', ...off(40000, 30) },
];
const t = { dist, lat, lon, scenic };
const base = { spoken: (m) => U.spokenShort(m), metric: false };
const at = (m, v, o = {}) => A.due(t, m, v, { ...base, ...o });
console.log(JSON.stringify({
  lastStops: A.lastStops(scenic, 200000, 'fuel').map((p) => [p.m, p.gapM]),
  fuelFar: at(20000 - 1500, 25), fuelNow: at(20000 - 800, 25), fuelSaid: at(20000 - 800, 25, { said: new Set(['fuel:20000']) }),
  view: at(30000 - 400, 25), viewSoon: at(33000 - 400, 25, { lastViewS: 1000, nowS: 1120 }), viewLater: at(33000 - 400, 25, { lastViewS: 1000, nowS: 1400 }),
  falls: at(60000 - 300, 25), slow: at(30000 - 200, 3),
  end: at(110000 - 800, 25), fuelKm: at(20000 - 800, 25, { metric: true }).text,
  ev: at(40000 - 800, 25, { electric: true }),
  bare: A.due({ dist, lat, lon }, 1000, 25, base),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_only_the_stop_before_a_long_stretch(out):
    assert out["lastStops"] == [[20000, 90000], [110000, 90000]]


def test_the_last_fuel_said_once_about_45_s_out_on_its_side(out):
    assert out["fuelFar"] is None
    assert out["fuelNow"] == {"key": "fuel:20000", "view": False, "text": "Last fuel for 56 miles, in half a mile, on the right."}
    assert out["fuelSaid"] is None
    assert out["end"]["text"] == "Last fuel of the route, in half a mile, on the left."
    assert out["fuelKm"].startswith("Last fuel for 90 kilometres, ")


def test_an_electric_car_hears_its_chargers(out):
    assert out["ev"]["text"] == "Last charger of the route, in half a mile, on the right."


def test_viewpoints_by_name_at_most_every_5_minutes(out):
    assert out["view"]["text"] == "Wiseman's View on the left, in a quarter mile." and out["view"]["view"] is True
    assert out["viewSoon"] is None and out["viewLater"]["text"] == "A viewpoint in a quarter mile."
    assert out["falls"]["text"] == "A waterfall on the right, in a quarter mile."
    assert out["slow"] is None and out["bare"] is None


def test_wired_through_the_quiet_gate_on_the_planned_route():
    js = open(os.path.join(ROOT, "web", "cockpit.js")).read()
    assert "track === plannedRoute && Array.isArray(track.scenic) && window.ApexAlongAhead" in js
    assert "lastViewS: state.notesMode === 'quiet' ? nowS : drive.viewAt" in js
    assert "alongSay = null; drive.alongSaid = null; drive.viewAt = null;" in js
    assert '<script src="along_ahead.js" defer></script>' in open(os.path.join(ROOT, "web", "index.html")).read()
