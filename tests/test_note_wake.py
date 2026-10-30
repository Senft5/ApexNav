"""Auto reads the road (REVIEW4 U-58, web/note_timing.js): the notes wake for a corner ahead that is tight or needs braking,
within two leads at the car's speed and never under 800 m; straight road stays quiet; the change is said once each way,
never within two minutes of the last, and never on a drive's first reading."""
import json
import os
import re
import shutil
import subprocess

import pytest
from tests.page_source import cockpit_source

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const T = require(process.argv[1] + '/web/note_timing.js');
const out = {};
const c = (m, severity, apexMps = null, text = 'Tight right') => ({ m, severity, apexMps, text });
// a motorway at 31 m/s (70 mph): a gentle 6 a kilometre on, a 2 thirteen miles on
const motorway = [c(1000, 6, 31), c(21000, 2, 14)];
out.motorway = T.wakeCorner(motorway, { cursorM: 0, vMps: 31 });
out.motorwayNext = T.nextWake(motorway, { cursorM: 0, vMps: 31 }).m;
// the same 2, now 700 m ahead: inside the 800 m floor
out.near = T.wakeCorner(motorway, { cursorM: 20300, vMps: 31 }).m;
// a severity 5 that needs braking from this speed (20 -> 14 m/s) wakes; at 15 m/s it does not
out.brake = !!T.wakeCorner([c(500, 5, 14)], { cursorM: 0, vMps: 20 });
out.noBrake = T.wakeCorner([c(500, 5, 14)], { cursorM: 0, vMps: 15 });
out.hairpin = !!T.wakeCorner([c(300, 'HP', 6)], { cursorM: 0, vMps: 0 });
// stopped at the start with the corner under the car (entry 3 m behind): still the road ahead; 8 m behind: passed
out.under = !!T.wakeCorner([c(-3, 3, 8)], { cursorM: 0, vMps: 0 });
out.behind = T.wakeCorner([c(-8, 3, 8)], { cursorM: 0, vMps: 0 });
// the window is two leads at speed: at 45 m/s braking to 10 m/s for a 3 it reaches past 800 m (2 x 466)
out.windowFast = T.wakeWindowM({ vMps: 45, apexMps: 10, text: 'Right three' });
out.windowSlow = T.wakeWindowM({ vMps: 10, apexMps: 8, text: 'Right three' });
out.fastWakes = !!T.wakeCorner([c(900, 3, 10, 'Right three')], { cursorM: 0, vMps: 45 });
// the spoken transitions
const W = T.createWakeVoice();
out.say = [W.update(true, 0), W.update(true, 1000), W.update(false, 60000), W.update(true, 200000), W.update(true, 210000),
  W.update(false, 250000), W.update(false, 400000), W.update(true, 400100)];
W.reset(); out.afterReset = W.update(false, 500000);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_straight_road_stays_quiet_and_knows_where_the_quiet_ends(out):
    assert out["motorway"] is None
    assert out["motorwayNext"] == 21000


def test_a_tight_corner_or_one_that_needs_braking_wakes_the_notes(out):
    assert out["near"] == 21000
    assert out["brake"] is True and out["noBrake"] is None
    assert out["hairpin"] is True


def test_the_corner_under_the_car_at_the_start_counts_until_it_is_behind(out):
    assert out["under"] is True and out["behind"] is None


def test_the_window_is_two_leads_and_never_under_800_m(out):
    assert out["windowSlow"] == 800
    assert out["windowFast"] == 932 and out["fastWakes"] is True


def test_transitions_said_once_each_way_and_never_within_two_minutes(out):
    # the first reading is silent; the change at 60 s is said; back on at 200 s (140 s later) is said; off at 250 s is
    # within two minutes of that, so silent; staying off says nothing; on again at 400.1 s is said
    assert out["say"] == [None, None, "off", "on", None, None, None, "on"]
    assert out["afterReset"] is None


def test_the_page_wakes_on_the_road_and_speaks_the_pack_lines():
    html = cockpit_source()
    notes = html[html.index("function updateNotes("):html.index("// 7. RENDER LOOP")]
    assert "ApexNoteTiming.wakeCorner(corners" in notes and "state.spiritedAt = now" in notes
    # the lines the voice packs hold (tools/voicebank.py PACK_LINES sys:stage / sys:cruise), said by their tokens
    assert "'sys:stage'" in notes and "'sys:cruise'" in notes
    bank = open(os.path.join(ROOT, "tools", "voicebank.py"), encoding="utf-8").read()
    assert '"sys:cruise": "Quiet from here. Bumps and cameras only."' in bank and '"sys:stage": "Full notes."' in bank
    assert "'Quiet from here. Bumps and cameras only.'" in notes and "'Full notes.'" in notes
    # the rerouter's words only on a planned route (U-72)
    assert re.search(r"if \(offRoute && track && track\.kind === 'route'\) return \[?offRouteText\(\)", html)
