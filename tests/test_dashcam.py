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


ALIGN = r"""
const D = require(process.argv[1] + '/web/dashcam.js');
const n = 200, d = { speed_mps: Array(n).fill(10), events: [{ type: 'corner', dist_m: 600, call: 'Left 4' }, { type: 'hazard', dist_m: 300, call: 'Bump' },
  { type: 'corner', dist_m: 250, call: 'Right 2' }, { type: 'corner', dist_m: 5000, call: 'Off the end' }] };
const T = Array.from({ length: n }, (_, i) => i * 0.5);
const calls = D.cornerCalls(d);
console.log(JSON.stringify({ calls, vt: D.videoTimeFor(T[calls[1].i], 40),
  next0: D.stepCall(calls, T, 0, 1), next1: D.stepCall(calls, T, 25, 1), prev: D.stepCall(calls, T, 60, -1), none: D.stepCall(calls, T, 0, -1),
  o: [D.offsetText(163), D.offsetText(-12), D.offsetText(4.5)],
  empty: D.frameDrawn(new Uint8ClampedArray(16)), drawn: D.frameDrawn(Uint8ClampedArray.from([0, 0, 0, 255])) }));
"""


def test_lining_up_on_the_corner_calls():
    """TestFlight 13 ("how do i slide to align when video doesn't preview?"): the preview steps through the corner calls in
    road order, a call's frame is its drive time less the offset, and a frame the phone could not decode is told apart."""
    out = json.loads(subprocess.run([NODE, "-e", ALIGN, ROOT], capture_output=True, text=True, check=True).stdout)
    assert [c["call"] for c in out["calls"]] == ["Right 2", "Left 4", "Off the end"], "corners only, in road order"
    assert out["calls"][0]["i"] == 50 and out["calls"][2]["i"] == 199, "a call past the end sits on the last sample"
    assert out["vt"] == 20, "Left 4 at 60 s into the drive, the video starting 40 s in: 20 s into the video"
    assert out["next0"] == 0 and out["next1"] == 1 and out["prev"] == 0 and out["none"] == -1
    assert out["o"] == ["Video starts 163 s into the drive", "Video starts 12 s before the drive", "Video starts 4.5 s into the drive"]
    assert out["empty"] is False and out["drawn"] is True


def test_the_apps_own_videos_of_the_drive_line_up_by_themselves():
    # big bet 5 (DriveCam.swift): the app's files are named for their first frame's Unix ms, the drive keeps its start t0
    script = r"""
const D = require(process.argv[1] + '/web/dashcam.js'), t0 = 1763000000000;
const list = [{ name: 'b.mov', start_ms: t0 + 600000, dur_s: 300 }, { name: 'a.mov', start_ms: t0 + 1200, dur_s: 540 },
  { name: 'before.mov', start_ms: t0 - 900000, dur_s: 60 }, { name: 'after.mov', start_ms: t0 + 2000000, dur_s: 60 },
  { name: 'open.mov', start_ms: t0 + 5000, dur_s: null }, { start_ms: t0, dur_s: 9 }];
console.log(JSON.stringify({ two: D.ownVideos(list, t0, 1200), one: D.ownVideos([list[1]], t0, 1200), none: D.ownVideos(list, undefined, 1200), bad: D.ownVideos(null, t0, 1200) }));
"""
    out = json.loads(subprocess.run([NODE, "-e", script, ROOT], capture_output=True, text=True, check=True).stdout)
    assert [v["name"] for v in out["two"]] == ["a.mov", "b.mov"]            # in the drive's order; none outside it or without a length
    assert out["two"][0]["offsetS"] == 1.2 and out["two"][1]["offsetS"] == 600
    assert [v["label"] for v in out["two"]] == ["Video 1 · 9 min", "Video 2 · 5 min"]
    assert out["one"][0]["label"] == "This drive's video · 9 min"
    assert out["none"] == [] and out["bad"] == []                           # a drive from before the clock: nothing to line up
