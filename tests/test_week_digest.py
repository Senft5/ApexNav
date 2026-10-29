"""Your week (web/week_digest.js, IDEAS D-20): last 7 days, new roads, best score, one thing to work on (never pace)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const W = require(process.argv[1] + '/web/week_digest.js');
const now = Date.parse('2026-10-28T12:00:00Z'), day = 864e5, iso = (dd) => new Date(now - dd * day).toISOString();
const c = (pace, smoothness, braking, consistency) => ({ pace, smoothness, braking, consistency });
const d = (name, dd, score, comp, km = 16.09344) => ({ name, date: iso(dd), dist: [0, km * 1000], ds: { score, components: comp } });
const drives = [
  d('Dragon', 20, 700, c(0.1, 0.9, 0.9, 0.9)),
  d('Dragon', 2, 810, c(0.2, 0.8, 0.5, 0.9)), d('Cherohala', 3, 760, c(0.1, 0.7, 0.6, 0.95)),
  d('Foothills', 1, null, null), { ...d('Moonshiner', 1, 990, c(0, 0, 0, 0)), dateKnown: false },
];
const w = W.digest(drives, now);
console.log(JSON.stringify({ w, lines: W.lines(w), empty: W.digest(drives.slice(0, 1), now),
  one: W.digest([d('Solo', 1, 500, c(0, 0.1, 0.2, 0.3))], now) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_week(out):
    w = out["w"]
    assert w["drives"] == 3 and w["miles"] == 30.0 and w["newRoads"] == 2        # Cherohala and Foothills; Dragon is old
    assert w["best"] == {"name": "Dragon", "score": 810}
    assert w["focus"]["part"] == "braking" and w["focus"]["pct"] == 55            # pace is lower but never the tip
    assert out["lines"][2].startswith("One thing to work on: Brakes (55%).")


def test_unknown_stays_unknown(out):
    assert out["empty"] is None
    assert out["one"]["focus"] is None and out["one"]["best"]["score"] == 500     # one drive: no tip yet


def test_one_drive_tip():
    out = subprocess.run([NODE, "-e", "const W = require(process.argv[1] + '/web/week_digest.js');"
                          "console.log(JSON.stringify([W.tip({ braking: 0.9, smoothness: 0.4, consistency: 0.7, pace: 0.1 }), W.tip(null), W.tip({ pace: 1 })]))",
                          ROOT], capture_output=True, text=True, check=True).stdout
    first, none, pace_only = json.loads(out)
    assert first["part"] == "smoothness" and first["label"] == "Smooth"     # pace is never the thing to work on
    assert none is None and pace_only is None
