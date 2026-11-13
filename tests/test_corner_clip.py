"""Corner clips (web/corner_clip.js, big bet 5): which corners a lined-up video holds, the window cut for each, and what a
frame of the clip says. Never a frame the video does not have."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const C = require(process.argv[1] + '/web/corner_clip.js');
const n = 300, d = { speed_mps: Array(n).fill(15), lat_g: Array.from({ length: n }, (_, i) => Math.sin(i / 3) * 0.4), lon_g: Array(n).fill(-0.1), g_known: null,
  events: [{ type: 'corner', call: 'Right 3', start_m: 480, end_m: 520 }, { type: 'corner', call: 'Left 4', start_m: 30, end_m: 60 }, { type: 'straight', start_m: 0, end_m: 10 }] };
const T = d.speed_mps.map((_, i) => i * 5 / 15);
const corners = C.cornersOf(d), w = C.clipWindow(T, corners[0], 0, 7.2);
const fmt = (v) => `${Math.round(v * 2.23694)} mph`;
console.log(JSON.stringify({ corners, w, list: C.clippable(d, T, 0, 7.2), later: C.clippable(d, T, 30, 7.2), shifted: C.clippable(d, T, 26, 12),
  tr: C.traceOf(d, T, w), f: C.frameAt(d, T, w, 3, 0, fmt), unknown: C.frameAt({ ...d, g_known: Array(n).fill(false) }, T, w, 3, 0, fmt), none: C.clipWindow(T, corners[0], 0, 0) }));
"""


@pytest.fixture(scope="module")
def r():
    p = subprocess.run([NODE, "-e", RUNNER, os.getcwd()], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_corner_calls_in_road_order(r):
    assert r["corners"] == [{"start": 6, "end": 12, "call": "Left 4"}, {"start": 96, "end": 104, "call": "Right 3"}]


def test_the_window_has_a_lead_and_a_tail_and_stays_in_the_video(r):
    w = r["w"]
    assert w["t0"] == 0 and w["t1"] == pytest.approx(4 + 2.5) and w["vt0"] == 0 and w["vt1"] == pytest.approx(6.5)
    assert r["none"] is None


def test_only_corners_the_video_holds_are_offered(r):
    assert [x["label"] for x in r["list"]] == ["Corner 1 · Left 4"]
    assert r["later"] == []                               # slid past the first call, the second is still after the video
    assert [x["label"] for x in r["shifted"]] == ["Corner 2 · Right 3"] and r["shifted"][0]["w"]["vt0"] == pytest.approx(32 - 4 - 26)


def test_a_frame_says_speed_g_and_how_far_through(r):
    f = r["f"]
    assert f["speed"] == "34 mph" and f["lonG"] == -0.1 and f["latG"] is not None and f["at"] == pytest.approx(3 / 6.5, abs=0.01)
    assert r["unknown"]["latG"] is None and r["unknown"]["lonG"] is None   # g the phone did not measure stays unknown
    assert len(r["tr"]["lat"]) == len(r["tr"]["t"]) > 10
