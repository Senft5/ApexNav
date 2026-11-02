"""When to read a pace note (web/note_timing.js, IDEAS V-01): say it, react, brake to the corner's speed; reaction learned."""
import json
import os
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
    html = cockpit_source()
    assert '<script src="note_timing.js"' in html
    assert "ApexNoteTiming.leadM({ vMps, apexMps, text: call.text, reactionS: reactS })" in html
    assert "Math.min(250, vMps * 5)" not in html                     # the fixed 5 s is gone


ASIDES = r"""
const R = process.argv[1], T = require(R + '/web/note_timing.js'), L = require(R + '/web/voice_lines.js'), P = require(R + '/web/plain_notes.js');
const corner = { hairpin: { type: 'corner', dir: 'L', severity: 'HP', shape: 'hairpin', mods: [], caution: 1, apex: 7 },
                 square: { type: 'corner', dir: 'R', severity: 2, shape: 'square', mods: [], caution: 1, apex: 8 } };
const out = [];
for (const pack of Object.keys(L.PACKS)) for (const [name, e] of Object.entries(corner)) for (const v of [15, 25, 35]) {
  const token = L.asideToken([e]), text = L.packLine(pack, token), kind = L.asideKind(pack, token);
  const callText = P.plainChain([e], null, {});
  const w = T.asideWindow({ dM: 0, atM: 1000, vMps: v, apexMps: e.apex, callText, text, kind });
  const at = T.asideWindow({ dM: w.leadM, atM: 1000, vMps: v, apexMps: e.apex, callText, text, kind });
  out.push({ pack, name, v, kind, lead: w.leadM, fits: at.fits, reach: w.leadM <= T.MAX_M, own: T.leadM({ vMps: v, apexMps: e.apex, text: callText }) });
}
console.log(JSON.stringify(out));
"""


def test_every_pack_aside_fits_a_hairpin_and_a_square():
    """Panel round 2 MA-3: for every pack line at 15, 25 and 35 m/s the aside fits on a hairpin and a square (round 1's
    gate fitted none): the call starts at the aside's lead, inside the reach a call is read from."""
    rows = json.loads(subprocess.run([NODE, "-e", ASIDES, ROOT], capture_output=True, text=True, check=True).stdout)
    assert len(rows) == 3 * 2 * 3
    for r in rows:
        assert r["fits"] and r["reach"], r
        assert r["lead"] > r["own"], r                                  # earlier than the call alone


def test_the_guided_drive_plays_its_asides():
    """MA-3 Done: replaying the guided drive's corners, each pack says at least two asides, at most one per 45 s, every
    one ending before the braking point and at least 4 s from the corner; advice is in its corner's call ("…long. Brake
    before it, not in it."), and no aside follows a call that names the next corner."""
    from tests.guided_drive import replay
    for mode in ("auto", "full"):
        for pack in ("marguerite", "kit", "hale"):
            log = replay(mode, pack)
            asides = [x for x in log if x["kind"] == "aside"]
            assert len(asides) >= 2, (mode, pack, asides)
            for a, b in zip(asides, asides[1:]):
                assert b["t"] - a["t"] >= 45, (pack, a, b)
            for a in asides:
                assert a["endsBeforeEntryM"] >= a["brakeM"], a           # never in the braking zone
                assert a["endsBeforeEntryM"] >= 4 * a["v"] - 1e-6, a     # done 4 s out
                assert a["startsBeforeEntryS"] >= 4, a
                call = next(x for x in log if x["kind"] == "call" and x["corner"] == a["corner"])
                assert " then " not in call["text"], call
                if a["aside"] == "advice":
                    assert call["text"].endswith(a["text"]), call         # one utterance
                else:
                    assert a["text"] not in call["text"], call


def test_the_page_says_advice_in_the_call():
    html = cockpit_source()
    assert "const aside = voiced && !startCall ? packAside(call, e, ev, d, vMps, apexMps, reactS) : null;" in html
    assert "chainedCall(e, ev, spirited || first, careRun.at(noteM(e), track.id), { vMps, advice })" in html
    assert "aside: aside ? { ...aside, bare: call.bare } : null" in html
    # a call that waited past the advice's last start says the call alone
    assert "queueCursor() > advice.dueByM) item = { ...item, text: advice.bare || item.text, aside: null };" in html
