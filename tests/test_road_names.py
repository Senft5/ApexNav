"""web/road_names.js: a drive is named after the road that carried most of it, from map tiles on the phone."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

SCRIPT = r"""
const R = require('./web/road_names.js');
const line = (name, coords, extra = {}) => ({ properties: { name, ...extra }, geometry: { type: 'LineString', coordinates: coords } });
// Two parallel east-west roads ~110 m apart at lat 39.24, and an unnamed track right on the point.
const feats = [
  line('Dry Ridge Road', [[-84.71, 39.2400], [-84.69, 39.2400]]),
  line('Bank Street', [[-84.71, 39.2410], [-84.69, 39.2410]]),
  { properties: { class: 'track' }, geometry: { type: 'LineString', coordinates: [[-84.71, 39.2401], [-84.69, 39.2401]] } },
  { properties: { 'name:en': 'Ridge Pike', name: 'Ridge Pike (local)' }, geometry: { type: 'MultiLineString', coordinates: [[[-84.80, 39.30], [-84.79, 39.30]]] } },
];
console.log(JSON.stringify({
  onRidge: R.nearestRoadName(feats, 39.2401, -84.70),
  onBank: R.nearestRoadName(feats, 39.2409, -84.70),
  between: R.nearestRoadName(feats, 39.2405, -84.70),
  english: R.nearestRoadName(feats, 39.30, -84.795),
  nothing: R.nearestRoadName([], 39.24, -84.70),
  main: R.mainRoad({ 'Dry Ridge Road': 6000, 'Bank Street': 2000 }, 10000),
  tooLittle: R.mainRoad({ 'Dry Ridge Road': 3000, 'Bank Street': 2000 }, 10000),
  none: R.mainRoad({}, 0),
  short: ['Northwest Expressway', 'Carolina Trace Road', 'North Main Street', 'Interstate 74 West', 'I-275', 'North Road', 'Dry Ridge Rd', null].map(R.shortRoadName),
}));
"""


def test_road_names():
    root = Path(__file__).resolve().parents[1]
    p = subprocess.run([NODE, "-e", SCRIPT], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout)
    assert r["onRidge"] == "Dry Ridge Road"           # the unnamed track 11 m away does not win
    assert r["onBank"] == "Bank Street"
    assert r["between"] is None                       # ~55 m from both: more than 30 m, unknown
    assert r["english"] == "Ridge Pike"               # name:en first, MultiLineString handled
    assert r["nothing"] is None
    assert r["main"] == "Dry Ridge Road"
    assert r["tooLittle"] is None                     # under a third of the drive: keep the date name
    assert r["none"] is None
    # U-100: as signs shorten them, for a line that must fit; a ref or a two-word compass name stays
    assert r["short"] == ["Northwest Expy", "Carolina Trace Rd", "N Main St", "Interstate 74 W", "I-275", "North Rd", "Dry Ridge Rd", None]


def test_the_road_name_is_held_through_a_junction():
    """U-137: no "Road: --" for a beat in a junction: the last name holds 5 s, and as long as the car is in a known junction."""
    js = r"""
const R = require('./web/road_names.js');
const steps = [];
let h = null;
const at = (name, t, j) => { const r = R.holdRoadName(h, name, t, j); h = r.hold; steps.push(r.name); };
at('Dry Ridge Road', 0); at(null, 2000); at(null, 5000); at(null, 5001);       // held 5 s, then unknown
at('Bank Street', 6000); at(null, 7000, true); at(null, 20000, true); at(null, 24000); at(null, 26000);   // a long junction
at('Mill Road', 27000); at('Dry Ridge Road', 27500);                           // a new name always wins
console.log(JSON.stringify(steps));
"""
    root = Path(__file__).resolve().parents[1]
    p = subprocess.run([NODE, "-e", js], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert p.returncode == 0, p.stderr
    assert json.loads(p.stdout) == ["Dry Ridge Road", "Dry Ridge Road", "Dry Ridge Road", None,
                                    "Bank Street", "Bank Street", "Bank Street", "Bank Street", None, "Mill Road", "Dry Ridge Road"]


TRACK = r"""
const R = require('./web/road_names.js');
const line = (name, coords) => ({ properties: { name }, geometry: { type: 'LineString', coordinates: coords } });
const feats = [line('Dry Ridge Road', [[-84.75, 39.2400], [-84.70, 39.2400]]), line('Bank Street', [[-84.70, 39.2400], [-84.69, 39.2400]])];
// east along 39.2400 from -84.74 to -84.69 (about 4.3 km): 3.4 km on Dry Ridge Road, 0.9 km on Bank Street
const kx = 111320 * Math.cos(39.24 * Math.PI / 180), lat = [], lon = [];
for (let m = 0; m <= 4300; m += 5) { lat.push(39.2401); lon.push(-84.74 + m / kx); }
const off = { lat: lat.map((v) => v + 0.01), lon };
console.log(JSON.stringify({ road: R.roadOfTrack(feats, { lat, lon }), off: R.roadOfTrack(feats, off), none: R.roadOfTrack([], { lat, lon }),
  short: R.roadOfTrack(feats, { lat: [39.24], lon: [-84.7] }),
  stand: ['', 'web_20261027_080000', 'Drive 10/26/2026 5:03 PM', 'my trip'].map((n) => R.isStandInName(n, 'my trip.csv')),
  kept: ['Sunday run', 'Dry Ridge Road', 'Drive to the coast'].map((n) => R.isStandInName(n, 'x.csv')) }));
"""


def test_an_imported_drive_is_named_after_its_road():
    out = json.loads(subprocess.run([NODE, "-e", TRACK], capture_output=True, text=True, check=True, cwd=Path(__file__).resolve().parents[1]).stdout)
    assert out["road"] == "Dry Ridge Road"
    assert out["off"] is None and out["none"] is None and out["short"] is None   # 1 km off any road, no tiles: unknown
    assert out["stand"] == [True, True, True, True]
    assert out["kept"] == [False, False, False]
