"""U-96: never a call from inside the corner. A corner too close to say with a beat to act is skipped (note_timing.js
lastCallM), and a call that waits in the queue past that point is dropped unsaid (speech_queue.js dueByM)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const T = require(process.argv[1] + '/web/note_timing.js'), Q = require(process.argv[1] + '/web/speech_queue.js');
const out = {};
const text = 'Open left, then 200 feet';             // 24 characters: 2.28 s to say
out.last30 = T.lastCallM({ vMps: 13.4, text });     // 30 mph: 13.4 x (2.28 + 1.0)
out.last0 = T.lastCallM({ vMps: 0, text });
out.lead30 = T.leadM({ vMps: 13.4, apexMps: 12, text });
// a call queued at 300 m with its entry at 400 m, due by 400 - lastCallM: said at 340, dropped at 360
const q = Q.createSpeechQueue(), due = 400 - out.last30;
q.push({ text, atM: 400, dueByM: due }, 0);
const a = q.take(10, 340);
q.push({ text: 'again', atM: 400, dueByM: due }, 0);
const b = q.take(10, 360);
out.queue = [a && a.text, b && b.text];
// REVIEW4 §4: "care" once per run of corners (each within 1 km of the last called), again after a gap, a new route or a reset
const run = T.createCareRun(), takes = [];
for (const [m, id] of [[100, 'r'], [400, 'r'], [900, 'r'], [2500, 'r'], [2800, 'r'], [2900, 'r2'], [3000, 'r2']]) takes.push(run.at(m, id).take());
run.reset(); takes.push(run.at(3100, 'r2').take());
out.care = takes;
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    res = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_too_late_is_a_beat_to_act_after_the_line(out):
    assert out["last30"] == pytest.approx(13.4 * (0.6 + 0.07 * 24 + 1.2), abs=0.01)
    assert out["last30"] > 45, "at 30 mph no call starts under 150 ft (the review's check)"
    assert out["last0"] == 0
    assert out["lead30"] > out["last30"], "the normal lead is well outside the too-late line"


def test_a_waiting_call_is_dropped_once_late(out):
    assert out["queue"] == ["Open left, then 200 feet", None]


def test_care_once_per_run_of_corners(out):
    assert out["care"] == [True, False, False, True, False, True, False, True]


def test_the_page_skips_a_late_corner_before_building_the_chain():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    loop = html[html.index("const lastM = e.type === 'corner'"):]
    skip = loop.index("d < lastM) { state.spoken.add(key); continue; }")
    assert skip < loop.index("let call = chainedCall(e, ev, spirited || first);"), "decided before the chain marks the next corner"
    assert "dueByM: noteM(e) - lastM" in loop
