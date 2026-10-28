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
