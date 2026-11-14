"""The stage briefing (web/briefing.js): as a planned drive starts, one short line of what the road holds: how far in whole
miles or kilometres, how many corners and hairpins (the marks are called when you reach them, not read out here, and the
line is said from the voice pack's clips); nothing for a short or straight route."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const B = require(process.argv[1] + '/web/briefing.js'), U = require(process.argv[1] + '/web/units.js');
U.set && U.set('imperial');
const spoken = U;
const dist = Array.from({ length: 4001 }, (_, i) => i * 5);                       // 20 km
const corner = (m, sev = 4) => ({ type: 'corner', dist_m: m, severity: sev });
const events = [...Array.from({ length: 40 }, (_, k) => corner(400 + k * 450)), corner(5000, 'HP'), corner(9000, 'HP'), { type: 'bump', dist_m: 700 }];
const marks = [{ kind: 'calming', call: 'Speed bumps', dist_m: 1000 }, { kind: 'stop', call: 'Stop sign', dist_m: 6800 },
  { kind: 'unpaved', call: 'Unpaved road', dist_m: 14500 }, { kind: 'rough', call: 'Rough road', dist_m: 16000 }];
const t = { dist, events, marks };
console.log(JSON.stringify({
  full: B.line(t, 0, spoken),
  later: B.line(t, 7000, spoken),                                                 // the stop is behind: the next two
  bare: B.line({ dist, events: events.slice(0, 40) }, 0, spoken),
  oneHp: B.line({ dist, events: [...events.slice(0, 40), corner(5000, 'HP')] }, 0, spoken),
  short: B.line({ dist: dist.slice(0, 500), events, marks }, 0, spoken),            // 2.5 km
  straight: B.line({ dist, events: events.slice(0, 4), marks }, 0, spoken),
  none: B.line(null, 0, spoken),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_briefing_reads_the_stage(out):
    assert out["full"] == "12 miles, 42 corners, 2 hairpins."
    assert out["later"].startswith("8 miles, ") and "Unpaved" not in out["later"]


def test_only_what_the_road_has(out):
    assert out["bare"] == "12 miles, 40 corners."
    assert out["oneHp"] == "12 miles, 41 corners, 1 hairpin."


def test_nothing_for_a_short_or_straight_route(out):
    assert out["short"] is None and out["straight"] is None and out["none"] is None


def test_wired_once_per_drive_and_not_in_quiet_notes():
    js = open(os.path.join(ROOT, "web", "cockpit.js")).read()
    assert "!drive.briefed && track && track === plannedRoute && window.ApexBriefing && state.notesMode !== 'quiet'" in js
    assert "briefSay = null; drive.briefed = false;" in js
