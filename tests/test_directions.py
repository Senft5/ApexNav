"""Spoken directions at junctions (web/directions.js, IDEAS V-04): an early call and one at the turn, US units, "then"
for a turn straight after, roundabouts and arrival, nothing for maneuvers that aren't turns, and a corner note at a
junction left to the direction."""
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
const steps = [
  { m: 0, type: 1, street: 'Main St' },                       // start: never said
  { m: 2000, type: 15, street: 'Deals Gap Road' },
  { m: 2100, type: 10, street: 'US 129' },                    // 100 m after: "then"
  { m: 5000, type: 8, street: 'US 129' },                     // continue: never said
  { m: 8000, type: 26, street: 'Foothills Pkwy', exits: 2 },
  { m: 9000, type: 4, street: null },
];
// drive at 20 m/s, a check every 10 m, collect what is said and where
const said = new Set(), heard = [];
for (let m = 0; m <= 9100; m += 10) for (const l of D.due(steps, m, 20, said, 'r1')) { said.add(l.key); heard.push([m, l.text, l.now]); }
const out = { heard };
out.words = [50, 120, 300, 480, 805, 1609, 4000].map(D.distWords);
globalThis.ApexUnits = { metric: () => true };                 // Settings → Units: kilometres (U-22)
out.metricWords = [50, 320, 960, 1000, 2460].map(D.distWords);
delete globalThis.ApexUnits;
out.junction = [D.atJunction(steps, 1980), D.atJunction(steps, 2070), D.atJunction(steps, 9000), D.atJunction(steps, 5000)];
// starting right at a turn: no early call, only the turn
const s2 = new Set();
out.close = D.due([{ m: 100, type: 16, street: null }], 0, 25, s2, 'r2').map((l) => l.text);
// placing: maneuvers that aren't said are dropped, out-of-order or unplaced ones too
out.placed = D.placeSteps([{ lat: 1, lon: 1, type: 1 }, { lat: 2, lon: 2, type: 15, street: 'A' }, { lat: 3, lon: 3, type: 10 }, { lat: 4, lon: 4, type: 9 }],
  (lat) => ({ 2: 500, 3: null, 4: 900 })[lat]);
out.strip = [{ type: 15, street: 'Deals Gap Road' }, { type: 9, street: null }, { type: 26, street: 'X', exits: 3 }, { type: 4 }, { type: 8, street: 'Y' }].map(D.stripNote);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_two_calls_per_turn_with_then(out):
    texts = [t for _, t, _ in out["heard"]]
    assert texts == [
        "In 0.4 miles, turn left onto Deals Gap Road",
        "Turn left onto Deals Gap Road, then turn right onto US 129",
        "Turn right onto US 129",
        "In 0.4 miles, at the roundabout, take the 2nd exit onto Foothills Pkwy",
        "At the roundabout, take the 2nd exit onto Foothills Pkwy",
        "Arriving at your destination",
    ]


def test_timing(out):
    at = {t: m for m, t, _ in out["heard"]}
    assert 2000 - 600 <= at["In 0.4 miles, turn left onto Deals Gap Road"] <= 2000 - 200   # 30 s out at 20 m/s, not inside 10 s
    assert 2000 - 100 <= at["Turn left onto Deals Gap Road, then turn right onto US 129"] <= 2000   # 5 s out
    assert all(now == t.startswith(("Turn", "At the", "Arriving")) for _, t, now in out["heard"])


def test_us_units(out):
    assert out["words"] == ["200 feet", "400 feet", "0.2 miles", "0.3 miles", "half a mile", "1 mile", "2.5 miles"]
    assert out["metricWords"] == ["100 metres", "300 metres", "1 kilometre", "1 kilometre", "2.5 kilometres"]


def test_corner_notes_at_junctions_left_out(out):
    assert out["junction"] == [True, True, False, False]


def test_close_start_and_placing(out):
    assert out["close"] == ["Bear left"]
    assert out["placed"] == [{"m": 500, "type": 15, "street": "A", "exits": None}, {"m": 900, "type": 9, "street": None, "exits": None}]


def test_strip_notes(out):
    assert out["strip"] == [
        {"code": "Left", "call": "Deals Gap Road", "dir": "L", "angle": 90},
        {"code": "Bear right", "call": "", "dir": "R", "angle": 45},
        {"code": "Roundabout · exit 3", "call": "X", "dir": "O", "angle": 0},
        {"code": "Arrive", "call": "Destination", "dir": "A", "angle": 0},
        None,
    ]
