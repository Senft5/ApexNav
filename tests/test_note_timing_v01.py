"""When to read a pace note (web/note_timing.js, IDEAS V-01): say it, react, brake to the corner's speed; reaction learned."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const T = require(process.argv[1] + '/web/note_timing.js');
const out = {};
const txt = 'Left 4 tightens';                       // 15 characters: 1.65 s to say
out.lead = [
  T.leadM({ vMps: 25, apexMps: 25, text: txt }),     // a corner, no braking: 25 x (1.65 + 1.5 think + 1.2)
  T.leadM({ vMps: 25, apexMps: 15, text: txt }),     // + (625 - 225) / 6.8
  T.leadM({ vMps: 25, apexMps: 15, text: txt, reactionS: 2.0 }),
  T.leadM({ vMps: 25, text: txt }),                  // a hazard: no thinking term, 25 x (1.65 + 1.2)
  T.leadM({ vMps: 5, text: txt }),                   // floor
  T.leadM({ vMps: 60, apexMps: 5, text: txt }),      // ceiling
  T.leadM({ vMps: null, text: txt }),
];
const L = T.createReactionLearner();
// the lead gives a corner THINK_S (1.5 s) before the driver is expected to act: the reaction counts from there
L.called(0, txt, true); L.frame(1000, -0.05); out.r1 = L.frame(1650 + 1500 + 2200, -0.2);   // braked 2.2 s after that
L.called(10000, txt, true); out.early = L.frame(11650 + 1500 + 100, -0.3);                  // already braking: ignored
L.called(20000, txt, true); out.never = L.frame(21650 + 1500 + 4500, -0.3);                 // over 4 s: ignored
L.called(25000, txt, true); out.thinking = L.frame(26650 + 1000, -0.3);   // braked in the thinking margin: early, ignored
L.called(30000, txt, false); out.noBrakeNeeded = L.frame(32000, -0.3);
out.samples = L.samples; out.react = L.reactionS;
out.clamped = T.createReactionLearner(9).reactionS;
out.needs = [T.needsBrake(25, 22), T.needsBrake(25, 24), T.needsBrake(25, null)];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_lead_distance(out):
    assert out["lead"] == [109, 168, 188, 71, 60, 600, 60]


def test_reaction_learned_from_braking(out):
    assert out["r1"] == pytest.approx(1.2 + 0.2 * (2.2 - 1.2))
    assert out["early"] is None and out["never"] is None and out["noBrakeNeeded"] is None and out["thinking"] is None
    assert out["samples"] == 1 and out["react"] == pytest.approx(1.4)
    assert out["clamped"] == 2.5


def test_needs_brake(out):
    assert out["needs"] == [True, False, False]


def test_page_uses_the_timing():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert '<script src="note_timing.js"></script>' in html
    assert "ApexNoteTiming.leadM({ vMps, apexMps, text: call.text, reactionS: reactS })" in html
    assert "Math.min(250, vMps * 5)" not in html                     # the fixed 5 s is gone
