"""Dashcam overlay (web/dashcam.js, IDEAS D-11): the drive's sample at the video's moment, with the offset; the next call."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const D = require(process.argv[1] + '/web/dashcam.js');
const n = 200, d = { name: 'Test', speed_mps: Array(n).fill(10), lat_g: Array.from({ length: n }, (_, i) => i / 400), lon_g: Array(n).fill(-0.1),
  events: [{ type: 'corner', dist_m: 600, call: 'Left 4' }, { type: 'hazard', dist_m: 300, call: 'Bump' }] };
const T = Array.from({ length: n }, (_, i) => i * 0.5);    // 5 m at 10 m/s
console.log(JSON.stringify({ i: [D.indexAt(T, 0), D.indexAt(T, 10.2), D.indexAt(T, 100), D.indexAt(T, -1)],
  at: D.overlayAt(d, T, 50, 5), before: D.overlayAt(d, T, 0, -10), far: D.overlayAt(d, T, 10, 0) }));
"""


def test_overlay_follows_the_drive():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["i"] == [0, 21, -1, -1]
    a = out["at"]                                   # 55 s into the drive: sample 110, 550 m, the corner at 600 m is 50 m ahead
    assert a["speed"] == "22 mph" and abs(a["latG"] - 110 / 400) < 1e-9 and a["lonG"] == -0.1 and a["note"] == "Left 4 · 50 m"
    assert out["before"] is None, "before the drive starts: nothing drawn"
    assert out["far"]["note"] is None, "no call more than 200 m out; hazards aren't corner calls"
