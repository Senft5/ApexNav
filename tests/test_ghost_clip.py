"""Side by side (web/ghost_clip.js, big bet 5): one corner, two filmed passes, played from the same point of the road, with
the gap from the corner overlay counting from 0.0 at the clip's start."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const G = require(process.argv[1] + '/web/ghost_clip.js');
const Ta = Array.from({ length: 200 }, (_, i) => i * 5 / 15), Tb = Array.from({ length: 200 }, (_, i) => i * 5 / 20);
// this pass at 15 m/s, the best at 20 m/s; corner 60..80 on both; videos from 1 s (a) and 2 s (b) into their drives
const a = { T: Ta, start: 60, end: 80, offsetS: 1, dur: 60 }, b = { T: Tb, start: 60, end: 80, offsetS: 2, dur: 60 };
const w = G.windows(a, b);
const trace = { i0: 30, gap_s: Array.from({ length: 80 }, (_, q) => q * 0.02) };
console.log(JSON.stringify({ w, outA: G.windows({ ...a, offsetS: 21 }, b), outB: G.windows(a, { ...b, dur: 5 }),
  g0: G.gapAt(trace, Ta, w.a.t0, w.a.t0), g: G.gapAt(trace, Ta, w.a.t0, Ta[70]), none: G.gapAt(null, Ta, 0, 1),
  texts: [G.gapText(0.42), G.gapText(-0.18), G.gapText(0.01), G.gapText(null)], s: [G.sampleAt(Ta, 0), G.sampleAt(Ta, 1.0), G.sampleAt(Ta, -3)] }));
"""


@pytest.fixture(scope="module")
def r():
    p = subprocess.run([NODE, "-e", RUNNER, os.getcwd()], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_both_passes_start_from_their_lead_and_run_as_long_as_the_slower(r):
    w = r["w"]
    assert w["a"]["t0"] == pytest.approx(20 - 3) and w["b"]["t0"] == pytest.approx(15 - 3)
    assert w["a"]["vt0"] == pytest.approx(16) and w["b"]["vt0"] == pytest.approx(10)
    # the slower pass (a: 20 s to 26.67 s, plus its tail) sets the length: 26.67 + 2 - 17
    assert w["len"] == pytest.approx(80 * 5 / 15 + 2 - 17, abs=1e-6)
    assert w["a"]["vt1"] - w["a"]["vt0"] == pytest.approx(w["len"]) and w["b"]["vt1"] - w["b"]["vt0"] == pytest.approx(w["len"])


def test_a_corner_outside_either_video_gives_no_clip(r):
    assert r["outA"] is None and r["outB"] is None


def test_the_gap_counts_from_zero_by_position(r):
    assert r["g0"] == pytest.approx(0)
    # a at sample 70: gap_s[40] = 0.8 less the start's (sample 51 -> gap_s[21] = 0.42)
    assert r["g"] == pytest.approx(0.8 - 0.42, abs=1e-9)
    assert r["none"] is None
    assert r["texts"] == ["+0.4 s", "−0.2 s", "0.0 s", "--"]
    assert r["s"] == [0, 3, 0]
