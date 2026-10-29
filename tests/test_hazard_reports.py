"""Hazards people reported (web/hazard_reports.js, IDEAS Q-15/Q-16): which one to call ahead, and when to ask "still there?"."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const H = require(process.argv[1] + '/web/hazard_reports.js');
const N = (m) => m / 110540;                       // metres north as latitude
const me = { lat: 35.6, lon: -83.9, heading: 0 };  // heading north
const list = [
  { id: 'behind', kind: 'pothole', lat: 35.6 - N(100), lon: -83.9, heading: null },
  { id: 'far', kind: 'gravel', lat: 35.6 + N(900), lon: -83.9, heading: 0 },
  { id: 'oncoming', kind: 'police', lat: 35.6 + N(120), lon: -83.9, heading: 180 },
  { id: 'ahead', kind: 'debris', lat: 35.6 + N(200), lon: -83.9, heading: 10 },
  { id: 'side', kind: 'animal', lat: 35.6 + N(50), lon: -83.9 + 200 / 90000, heading: null },
];
const out = {};
out.next = H.nextAhead(list, me, 300, new Set());
out.afterSaid = H.nextAhead(list, me, 300, new Set(['ahead']));
out.noHeading = H.nextAhead(list, { lat: 35.6, lon: -83.9, heading: null }, 300, new Set());
const w = H.createPassWatch(), seen = [];
const pos = (m) => ({ lat: 35.6 + N(m), lon: -83.9, heading: 0 });
for (const m of [0, 150, 190, 210, 250, 290, 300]) seen.push(w.update(list, pos(m), new Set())?.id ?? null);
out.passed = seen;
const w2 = H.createPassWatch();
out.mine = [190, 200, 300].map((m) => w2.update(list, pos(m), new Set(['ahead']))?.id ?? null);
const cl = [{ kind: 'closure', lat: 35.65, lon: -83.9 }, { kind: 'closure', lat: 36.9, lon: -83.9 }, { kind: 'gravel', lat: 35.65, lon: -83.9 },
  { kind: 'closure', lat: 35.61, lon: -83.95 }];
out.closures = H.closuresFor(cl, [{ lat: 35.6, lon: -84.0 }, { lat: 35.7, lon: -83.8 }]);
out.noPoints = H.closuresFor(cl, []);
const mi = (m) => `${(m / 1609.344).toFixed(1)} mi`, now = Date.parse('2026-10-29T03:50:00Z');
out.plate = H.plate({ kind: 'gravel', m: 640, created_at: '2026-10-29 01:50:00', confirms: 2 }, mi, now);
out.plateFresh = H.plate({ kind: 'police', m: 300, created_at: '2026-10-29T03:49:40Z', confirms: 0 }, mi, now);
out.plateBare = H.plate({ kind: 'mystery' }, mi, now);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_calls_the_nearest_one_ahead_going_your_way(out):
    n = out["next"]
    assert n["id"] == "ahead" and n["m"] == 200 and n["text"] == "Debris reported ahead"   # not behind, oncoming, off to the side or too far
    assert out["afterSaid"] is None                                                        # each one once
    assert out["noHeading"] is None                                                        # no heading: nothing is "ahead"


def test_asks_once_after_passing(out):
    assert out["passed"] == [None, None, None, None, None, "ahead", None]   # within 60 m at 190/210/250, 80 m behind at 290
    assert out["mine"] == [None, None, None]                                # never about your own report


def test_closures_for_routing(out):
    # inside the trip's box (widened 15 km), closures only, nearest the middle first; one 140 km away left out
    assert out["closures"] == [{"lat": 35.65, "lon": -83.9}, {"lat": 35.61, "lon": -83.95}]
    assert out["noPoints"] == []


def test_hazard_plate_text(out):
    # docs/design/REVIEW.md 4.3: what it is, how far, how old, how many confirmed; never who reported it
    assert out["plate"] == {"title": "Gravel", "detail": "in 0.4 mi · reported 2 h ago · 2 confirmed"}
    assert out["plateFresh"] == {"title": "Police", "detail": "in 0.2 mi · reported just now"}
    assert out["plateBare"] == {"title": "Hazard", "detail": ""}                        # unknown parts left out
