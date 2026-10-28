"""A route's climb (web/stages.js fillProfile / climbM, IDEAS U-21): known samples joined, unknown not invented, DEM noise ignored."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
require(process.argv[1] + '/web/stages.js');
const S = globalThis.ApexStages;
const dist = [0, 50, 100, 150, 200, 250];
console.log(JSON.stringify({
  filled: S.fillProfile(dist, [{ m: 50, e: 100 }, { m: 150, e: 120 }, { m: 250, e: 110 }]),
  gaps: S.fillProfile(dist, [{ m: 0, e: 100 }, { m: 100, e: null }, { m: 200, e: null }]),
  climb: S.climbM([100, 101, 99, 102, 110, 108, 109, 130, 125, 140]),
  flat: S.climbM([100, 101, 100, 102, 101]), none: S.climbM(null),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_profile_fills_between_known_samples(out):
    assert out["filled"] == [100, 100, 110, 120, 115, 110]
    assert out["gaps"] is None                       # under half known: unknown, not a flat line


def test_climb_ignores_noise(out):
    assert out["climb"] == 45 and out["flat"] == 0 and out["none"] is None
