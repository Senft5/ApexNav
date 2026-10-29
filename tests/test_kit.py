"""Kit, Tapedeck's dot-matrix fox (web/instruments.js, docs/design/REVIEW.md 4.1): every frame on the 16 x 14 grid (REVIEW2.md
U-38), and the pose follows the drive (lean into the corner, harder in a hard one, sit up for a crest, curl up stopped,
blink at a hazard; an ear flick when idle)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const I = require(process.argv[1] + '/web/instruments.js');
const poses = [{ speedMph: 40, latG: 0.3 }, { speedMph: 40, latG: -0.3 }, { speedMph: 40, latG: 0.05 }, { speedMph: 0, latG: 0.3 },
  { speedMph: 40, crestAhead: true, latG: 0.3 }, { speedMph: 0, blink: true }, { speedMph: null, latG: null },
  { speedMph: 40, latG: 0.6 }, { speedMph: 40, latG: -0.6 }].map((d) => I.kitPose(d, 1000));
const idle = [I.kitPose({ speedMph: 40, latG: 0 }, 5100), I.kitPose({ speedMph: 40, latG: 0 }, 5300)];
console.log(JSON.stringify({ frames: I.KIT, poses, idle, still: I.kitPose({ speedMph: 40, latG: 0 }) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_every_frame_fits_the_grid(out):
    for name, rows in out["frames"].items():
        assert len(rows) == 14 and all(len(r) == 16 and set(r) <= set(".Xbwo") for r in rows), name


def test_leaning_never_clips_him(out):
    f, dots = out["frames"], lambda rows: sum(len(r.replace(".", "")) for r in rows)
    for name in ("left", "right", "hardLeft", "hardRight", "blink"):
        assert dots(f[name]) == dots(f["up"]), name


def test_leans_go_the_way_of_the_corner(out):
    f = out["frames"]
    # into a left corner the ears go left of upright, into a right corner right of it
    assert f["hardLeft"][0].index("X") < f["left"][0].index("X") < f["up"][0].index("X") < f["right"][0].index("X") < f["hardRight"][0].index("X")


def test_pose_follows_the_drive(out):
    assert out["poses"] == ["left", "right", "up", "curl", "crest", "blink", "up", "hardLeft", "hardRight"]


def test_two_idle_frames(out):
    # an ear flick for a quarter second every five; with no clock (reduced motion) he holds still
    assert out["idle"][:2] == ["idle", "up"] and out["still"] == "up"
    assert out["frames"]["idle"] != out["frames"]["up"]
