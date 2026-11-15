"""Corners ahead (web/corners_ahead.js): on a planned route, after 2 km or more without a corner, the co-driver says when
the next twisty section starts, about 30 s out: "Twisty section in half a mile. 3.2 miles, 18 corners." Never at the start
of the route, never for a few scattered corners."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/corners_ahead.js'), U = require(process.argv[1] + '/web/units.js');
const spoken = (m) => U.spokenShort(m);
const corner = (m) => ({ type: 'corner', dist_m: m, start_m: m - 40 });
const run = (from, n, step) => Array.from({ length: n }, (_, k) => corner(from + k * step));
// corners at the start (no call: the briefing has them), 4 km of transit with two lone corners, then a section of 18
// over 5.1 km, a short gap, and 4 scattered corners after another transit (too few to be a section)
const events = [...run(300, 8, 300), corner(4000), corner(5200), ...run(8040, 18, 300), { type: 'bump', dist_m: 9000 },
  ...run(16000, 4, 400)];
const list = C.sections(events);
const said = new Set();
console.log(JSON.stringify({
  list,
  early: C.sections(run(1500, 10, 300)),                                          // 1.5 km into the route: the briefing's
  next: C.next(list, 6000, said), past: C.next(list, 8100, said), saidNext: C.next(list, 6000, new Set([list[0] && list[0].startM])),
  dueFar: C.due(list[0], 8000 - 900, 25), dueNow: C.due(list[0], 8000 - 700, 25), dueClose: C.due(list[0], 8000 - 150, 25),
  dueSlow: C.due(list[0], 8000 - 350, 8), dueStopped: C.due(list[0], 8000 - 350, 2),
  text: C.text(list[0], 8000 - 800, spoken),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_section_after_a_transit(out):
    assert out["list"] == [{"startM": 8000, "endM": 13140, "corners": 18}]
    assert out["early"] == []


def test_said_once_about_30_seconds_out(out):
    assert out["next"]["startM"] == 8000 and out["past"] is None and out["saidNext"] is None
    assert out["dueFar"] is False and out["dueNow"] is True and out["dueClose"] is False
    assert out["dueSlow"] is True and out["dueStopped"] is False


def test_the_line(out):
    assert out["text"] == "Twisty section ahead. 18 corners."     # short, from the voice pack's own clips


def test_wired_through_the_quiet_gate_on_the_planned_route():
    js = open(os.path.join(ROOT, "web", "cockpit.js")).read()
    assert "track === plannedRoute && window.ApexCornersAhead && state.notesMode !== 'quiet'" in js
    assert "const quiet = limitSay || briefSay || cornersSay || alongSay || brakeSay" in js and "cornersSay = null; drive.sectionsSaid = null;" in js
    assert "'corners_ahead.js'" in open(os.path.join(ROOT, "web", "lazy.js")).read()   # lazy: the 'ahead' group


FREE = r"""
const C = require(process.argv[1] + '/web/corners_ahead.js'), L = require(process.argv[1] + '/web/voice_lines.js');
const corner = (m) => ({ type: 'corner', dist_m: m, start_m: m - 40 });
const run = (from, n, step) => Array.from({ length: n }, (_, k) => corner(from + k * step));
const sec = run(800, 8, 200);                                                    // 800-2200 m of a 3 km road ahead
// the tracker: 1.5 km past a corner on one road ahead, then a new one built at the car and driven 600 m more
const tk = C.tracker(), a = { events: [corner(100)] }, b = { events: [] };
const q = [tk.update(a, 0), tk.update(a, 100), tk.update(a, 1600), tk.update(b, 0), tk.update(b, 600)];
console.log(JSON.stringify({
  quiet: C.ahead(sec, 0, 1500, 3000),                                            // 1.5 km behind + 760 m ahead: quiet enough
  short: C.ahead(sec, 0, 900, 2500),                                             // 900 + 760 < 2 km: still in the twisty bit
  lone: C.ahead([corner(200), ...sec], 0, 5000, 2500),                           // a lone corner 560 m before it breaks the quiet
  far: C.ahead([corner(200), ...run(2900, 8, 200)], 0, 0, 5000),                // the lone corner, then 2.7 km of quiet: a section
  open: C.ahead(run(800, 8, 200), 0, 3000, 2300),                                // runs on past the end of the road ahead
  few: C.ahead(run(800, 4, 200), 0, 3000, 2500), none: C.ahead(sec, 0, null, 2500),
  q, openText: C.text({ startM: 800, endM: 2200, corners: 8, open: true }), clip: L.compose('Twisty section ahead.'),
}));
"""


def test_a_twisty_section_on_a_free_drive():
    """No route: the road ahead is ~2.5 km from the car, so the quiet stretch counts what you have driven since your last
    corner. A section that runs past the end of the road ahead is said without a count (its corners aren't all known)."""
    out = json.loads(subprocess.run([NODE, "-e", FREE, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["quiet"] == {"startM": 760, "endM": 2200, "corners": 8, "open": False}
    assert out["short"] is None and out["lone"] is None and out["few"] is None and out["none"] is None
    assert out["far"]["startM"] == 2860 and out["open"]["open"] is True
    assert out["q"] == [0, 0, 1500, 1500, 2100]
    assert out["openText"] == "Twisty section ahead." and out["clip"]
    js = open(os.path.join(ROOT, "web", "cockpit.js")).read()
    assert "track.kind === 'horizon' && window.ApexCornersAhead && ApexCornersAhead.tracker" in js
    assert "free.twisty = null; free.twistySaid = null;" in js
