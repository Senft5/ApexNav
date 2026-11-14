"""Clips made to be posted (launch marketing, 2026-11-14): the caption copied on share (web/corner_clip.js caption), the
switch that leaves the speed off clips and replays, vettadrive.com under the mark, and the replay's 9:16 crop
(web/flyover_video.js cropFor)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const store = {}; globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const CC = require(process.argv[1] + '/web/corner_clip.js'), V = require(process.argv[1] + '/web/flyover_video.js');
// a 2d context that keeps what was written
const ctx = () => { const said = []; return { said, fillRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
  createLinearGradient: () => ({ addColorStop() {} }), fillText: (t) => said.push(String(t)) }; };
const f = { speed: '45 mph', latG: 0.3, lonG: -0.1, at: 0.5 }, meta = { title: 'Cherohala Skyway', label: 'Corner 1 · Left 4', trace: null };
const shown = ctx(); CC.drawClip(shown, 720, 1280, null, f, meta);
const hidden = ctx(); CC.drawClip(hidden, 720, 1280, null, f, { ...meta, hideSpeed: true });
const before = [CC.speedShown(), V.speedShown()]; CC.setSpeedShown(false); const after = [CC.speedShown(), V.speedShown()];
console.log(JSON.stringify({
  full: CC.caption({ name: 'Cherohala Skyway', car: { label: '2019 Mazda MX-5' } }, 'Left 4'),
  bare: CC.caption({ name: 'Drive 11/14/2026 3:05 PM' }, ''), none: CC.caption(null, ''),
  shown: shown.said, hidden: hidden.said, before, after,
  phone: V.cropFor(1170, 2532, 720, 1280), wide: V.cropFor(1920, 1080, 720, 1280), same: V.cropFor(1280, 720, 1280, 720) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_caption_says_what_is_known_and_where_the_app_is(out):
    assert out["full"].split("\n") == ["Cherohala Skyway · Left 4", "Called by Vetta. Free on iPhone, link in bio.", "#drivingroads #backroads #mazda"]
    # a dated stand-in name, no call, no car: left out, never guessed
    assert out["bare"].split("\n") == ["Called by Vetta. Free on iPhone, link in bio.", "#drivingroads #backroads"]
    assert out["none"] == out["bare"]


def test_the_mark_leads_back_and_the_speed_can_stay_off(out):
    assert "VETTA" in out["shown"] and "vettadrive.com" in out["shown"] and "vettadrive.com" in out["hidden"]
    assert "45 mph" in out["shown"] and "45 mph" not in out["hidden"]
    assert "Corner 1 · Left 4" in out["hidden"]                      # the call stays
    assert out["before"] == [True, True] and out["after"] == [False, False]   # one switch, clips and replays alike


def test_replay_portrait_is_the_middle_of_the_map(out):
    p = out["phone"]
    assert p["sw"] == 1170 and abs(p["sh"] / p["sw"] - 16 / 9) < 0.01 and p["sy"] == (2532 - p["sh"]) // 2
    w = out["wide"]
    assert w["sh"] == 1080 and abs(w["sh"] / w["sw"] - 16 / 9) < 0.01 and w["sx"] > 0
    assert out["same"] == {"sx": 0, "sy": 0, "sw": 1280, "sh": 720}
