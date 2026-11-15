"""A corner's own result on the drive page (web/driver_profile.js cornerResult; Nate 2026-11-15, drive review round 1: the
rows read the call words, not how the corner went). Clean out of 100 from the corner's measured skills, and what cost it
most in a few words; a corner with too little measured says nothing, never a guess."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
WEB = Path(__file__).resolve().parents[1] / "web"

RUNNER = r"""
const P = require(process.argv[1] + '/driver_profile.js');
const all = (v) => ({ squeeze: v, brake: v, arc: v, entry: v, line: v, exit: v });
console.log(JSON.stringify({
  clean: P.cornerResult(all(0.9)),
  late: P.cornerResult({ ...all(0.9), brake: 0.3 }),
  coast: P.cornerResult({ ...all(0.8), exit: 0.5 }),
  noBrakes: P.cornerResult({ ...all(0.8), squeeze: null, brake: null }),
  noArc: P.cornerResult({ squeeze: 0.9, brake: 0.9, arc: null, entry: 0.9, line: 0.9, exit: 0.9 }),
  two: P.cornerResult({ squeeze: null, brake: null, arc: 0.9, entry: 0.9, line: null, exit: null }),
  none: P.cornerResult(null),
  words: P.MISS,
}));
"""


@pytest.fixture(scope="module")
def r():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, str(WEB)], capture_output=True, text=True, check=True).stdout)


def test_a_clean_corner_says_clean(r):
    assert r["clean"] == {"level": 90, "worst": None, "say": "clean"}


def test_what_cost_it_most_is_named(r):
    assert r["late"]["say"] == "still braking past the middle" and r["late"]["worst"] == "brake" and r["late"]["level"] == 80
    assert r["coast"]["say"] == "coasted before the gas" and r["coast"]["level"] == 75


def test_judged_on_what_was_measured_only(r):
    assert r["noBrakes"] == {"level": 80, "worst": None, "say": "clean"}, "no braking: judged on the four it has"
    assert r["noArc"] is None and r["two"] is None and r["none"] is None


def test_the_words_are_short_and_plain(r):
    assert set(r["words"]) == {"squeeze", "brake", "arc", "entry", "line", "exit"}
    assert all(len(w.split()) <= 6 and "g" not in w.split() for w in r["words"].values())
