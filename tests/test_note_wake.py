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
    # panel round 2 MA-1: awake, it stays awake on the wider sleep rule
    assert "(isSpirited() && ApexNoteTiming.keepsAwake(corners, wakeAt))" in notes
    # LA-4: the mode is a chime, never its name: the rising one rides on the first call after a wake, the falling one leads
    # the quiet line, which says how far the quiet lasts in the pack's words (or the chime alone when that is unknown/short)
    assert "if (t === 'on') state.wakeCue = true;" in notes
    assert "ApexVoiceLines.quietLine(state.voiceId, quietSaid())" in notes and "cue: 'sleep'" in notes and "else chime('sleep');" in notes
    assert "cue = e.type === 'corner' && state.wakeCue ? 'wake' : undefined" in notes
    assert "packSays(" not in html and "'Full notes.'" not in notes and "'Quiet from here. Bumps and cameras only.'" not in notes
    # the Notes switch chimes too
    assert "if (state.notesMode !== 'auto') chime(full ? 'wake' : 'sleep');" in html
    # the pack lines stay in the banks: the opener (DA-3) says them after the road's name
    bank = open(os.path.join(ROOT, "web", "voice_lines.js"), encoding="utf-8").read()
    assert '"sys:cruise": "Quiet from here. Bumps and cameras only."' in bank and '"sys:stage": "Full notes."' in bank
    # DA-3: the opener is said once per drive, ahead of the first call, only with the road known
    assert "ApexVoiceLines.openerLine(state.voiceId, { road, awake: spirited, span })" in notes
    assert notes.index("openNotes(true);") < notes.index("say(call.text, false, call.chain")
    assert "state.openerDue = true; state.openerAt = performance.now();" in html
    # the rerouter's words only on a planned route (U-72)
    assert re.search(r"const offWords = offRoute && track && track\.kind === 'route' \? offRouteText\(\) : null;", html)


QUIET = r"""
const R = process.argv[1], T = require(R + '/web/note_timing.js'), L = require(R + '/web/voice_lines.js');
const out = {};
const c = (m, severity, apexMps = null, text = 'Tight right') => ({ m, severity, apexMps, text });
// the guided drive at 07:12: OPEN LEFT at 600 ft (183 m) on the strip, at 47 mph (21 m/s), a square left half a mile on
const atEdge = [c(183, 4, 18, 'Open left'), c(805, 2, 8, 'Careful, square left')];
out.edge = T.keepsAwake(atEdge, { cursorM: 0, vMps: 21 }).m;
// a waking corner 1.2 km on (past its 800 m wake window, inside the 1600 m sleep window) keeps it awake
out.wide = T.keepsAwake([c(1200, 2, 10)], { cursorM: 0, vMps: 20 }).m;
// at 30 m/s a minute's quiet beyond the wake point reaches 800 + 1800 m: a corner 2.4 km on still keeps it awake
out.minute = !!T.keepsAwake([c(2400, 2, 10)], { cursorM: 0, vMps: 30 });
out.sleeps = T.keepsAwake([c(3500, 2, 10), c(900, 6, 30, 'Slight left')], { cursorM: 0, vMps: 20 });
out.quietM = T.quietM([c(4019, 2, 10)], { cursorM: 0, vMps: 20 });
out.noneAhead = T.quietM([c(400, 6, 30)], { cursorM: 0, vMps: 20 });
const mi = { metric: () => false }, km = { metric: () => true };
out.spans = [700, 810, 1300, 3300, 5000].map((m) => T.quietSpan(m, mi)).concat([T.quietSpan(2600, km), T.quietSpan(null, mi)]);
out.lines = ['marguerite', 'kit', 'hale', 'device'].map((id) => L.quietLine(id, 'two miles')).concat([L.quietLine('kit', null)]);
out.openers = [L.openerLine('marguerite', { road: 'Dry Ridge Road', awake: true }), L.openerLine('kit', { road: 'Dry Ridge Road', awake: true }),
  L.openerLine('marguerite', { road: 'Dry Ridge Road', awake: false, span: 'two miles' }), L.openerLine('hale', { road: 'I-275', awake: false }),
  L.openerLine('marguerite', { road: null, awake: true }), L.openerLine('marguerite', { road: '  ', awake: true })];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def quiet():
    return json.loads(subprocess.run([NODE, "-e", QUIET, ROOT], capture_output=True, text=True, check=True).stdout)


def test_never_quiet_with_a_corner_on_the_page(quiet):
    """Panel round 2 MA-1: sleep has its own, wider window, and a corner within its lead keeps the notes up."""
    assert quiet["edge"] == 183                       # the open left on the strip keeps it awake
    assert quiet["wide"] == 1200 and quiet["minute"] is True
    assert quiet["sleeps"] is None                    # a slight left that doesn't wake, far from its lead: quiet may come


def test_the_quiet_line_says_how_far(quiet):
    assert quiet["quietM"] == 4019 - 800 and quiet["noneAhead"] is None
    # rounded down: never more quiet than there is; under half a mile, nothing to announce
    assert quiet["spans"] == [None, "half a mile", "three quarters of a mile", "two miles", "three miles", "two and a half kilometres", None]
    assert quiet["lines"] == ["Quiet for two miles.", "Nothing for two miles.", "Clear, two miles.", "Quiet for two miles.", None]


def test_the_first_words_name_the_road(quiet):
    """DA-3: "Dry Ridge Road. Full notes."; with the road unknown, no opener (unknown stays unknown)."""
    assert quiet["openers"] == ["Dry Ridge Road. Full notes.", "Dry Ridge Road. Full notes. Here we go.",
                                "Dry Ridge Road. Quiet for two miles.", "I-275. Hazards only.", None, None]


def test_the_guided_drive_never_wakes_within_a_minute_of_going_quiet():
    """MA-1 Done: in the guided drive no corner call within 45 s after a quiet line, and every quiet line carries a
    distance (the one at the end of the road, with no corner left to wake for, is the chime alone)."""
    from tests.guided_drive import replay
    for pack in ("marguerite", "kit", "hale"):
        log = replay("auto", pack)
        quiets = [x for x in log if x["kind"] == "quiet"]
        calls = [x for x in log if x["kind"] == "call"]
        assert len(quiets) >= 2, (pack, quiets)
        for q in quiets:
            after = [c for c in calls if c["t"] > q["t"]]
            if after:
                assert after[0]["t"] - q["t"] >= 60, (pack, q, after[0])
                assert q["text"] and re.search(r"(mile|kilometre)", q["text"]), q
            else:
                assert q["text"] is None, q          # the road's end: chime only
        assert not any("Full notes" in (c["text"] or "") for c in calls)
