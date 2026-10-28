"""Flyby (web/flyby.js, IDEAS S-20): friends on this drive's stages the same day; other days, other stages, no date: nothing."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const F = require(process.argv[1] + '/web/flyby.js');
const act = [
  { handle: 'cara', canon_id: 'S1', stage: 'Esses', driver_score: 640, driven_on: '2026-10-20' },
  { handle: 'bob', canon_id: 'S1', stage: 'Esses', driver_score: 812, driven_on: '2026-10-20' },
  { handle: 'bob', canon_id: 'S1', stage: 'Esses', driver_score: 700, driven_on: '2026-10-20' },
  { handle: 'dan', canon_id: 'S1', stage: 'Esses', driver_score: 900, driven_on: '2026-10-19' },
  { handle: 'eve', canon_id: 'S9', stage: 'Elsewhere', driver_score: 500, driven_on: '2026-10-20' },
  { handle: 'fay', canon_id: 'S2', stage: 'Dry Ridge', driver_score: null, driven_on: '2026-10-20' },
  { handle: null, canon_id: 'S2', stage: 'Dry Ridge', driver_score: 1, driven_on: '2026-10-20' },
];
const g = F.flyby(act, '2026-10-20', ['S1', 'S2']);
console.log(JSON.stringify({ g, lines: F.lines(g), noDay: F.flyby(act, null, ['S1']), bad: F.flyby(act, '2026-10', ['S1']), none: F.flyby(act, '2026-10-20', []) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_same_day_same_stage(out):
    assert out["lines"] == ["Esses: @bob 812, @cara 640", "Dry Ridge: @fay"]


def test_nothing_without_a_day_or_a_stage(out):
    assert out["noDay"] == [] and out["bad"] == [] and out["none"] == []
