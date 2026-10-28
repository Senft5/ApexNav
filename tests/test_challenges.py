"""This month's challenges (web/challenges.js, IDEAS S-11): new roads, smooth drives, scored corners; capped; unknown dates out."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/challenges.js');
const d = (name, date, smooth, corners, extra = {}) => ({ name, date, ds: { corners, components: smooth == null ? null : { smoothness: smooth } }, ...extra });
const drives = [
  d('Dragon', '2026-09-30T10:00:00', 0.9, 40),
  d('Dragon', '2026-10-02T10:00:00', 0.85, 50), d('Cherohala', '2026-10-03T10:00:00', 0.7, 30), d('cherohala', '2026-10-04T10:00:00', 0.95, 30),
  d('Drive 10/5/2026 8:00 AM', '2026-10-05T10:00:00', 0.81, 200), d('Foothills', '2026-10-06T10:00:00', NaN, 10),
  d('Moonshiner', '2026-10-07T10:00:00', 0.99, 5, { dateKnown: false }),
];
console.log(JSON.stringify(C.progress(drives, '2026-10')));
"""


@pytest.fixture(scope="module")
def out():
    return {r["id"]: r for r in json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)}


def test_new_roads_count_names_never_driven_before(out):
    assert out["roads"]["done"] == 2 and not out["roads"]["complete"]      # Cherohala (any case), Foothills; not Dragon, not unnamed


def test_smooth_and_corners(out):
    assert out["smooth"]["done"] == 3 and out["smooth"]["complete"]        # 0.85, 0.95, 0.81; NaN and an unknown date don't count
    assert out["corners"]["done"] == 200 and out["corners"]["complete"]   # 320 capped at the goal
