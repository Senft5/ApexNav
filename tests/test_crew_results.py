"""A crew drive's results sheet as text (web/crew_events.js resultsText, IDEAS S-25): the overall, then each stage as
SS1, SS2…, each Score, and a time with its gap only where the driver shares times; nothing when nobody shared a Score."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const E = require(process.argv[1] + '/web/crew_events.js');
const e = { title: 'Dawn run', crew_name: 'Ridge Runners' };
const two = { stages: [{ id: 's1', name: 'Skyway', rows: [{ handle: 'sam', score: 811, place: 1, time_s: 190, gap_s: 6 }, { handle: 'cara', score: 811, place: 1, time_s: 184, gap_s: 0 }] },
  { id: 's2', name: 'River Road', rows: [{ handle: 'cara', score: 802, place: 1, time_s: 3725, gap_s: 0 }] }],
  overall: [{ handle: 'cara', stages: 2, score: 807, full: true, place: 1, time_s: 3909, gap_s: 0 }, { handle: 'sam', stages: 1, score: 811, full: false, place: 2, time_s: null, gap_s: null }] };
const one = { stages: [{ ...two.stages[0], rows: two.stages[0].rows.map((r) => ({ ...r, time_s: null, gap_s: null })) }], overall: [{ handle: 'sam', stages: 1, score: 811, full: true, place: 1 }, { handle: 'cara', stages: 1, score: 811, full: true, place: 1 }] };
console.log(JSON.stringify({ two: E.resultsText(e, two), one: E.resultsText({}, one), none: E.resultsText(e, { stages: [], overall: [] }), bad: E.resultsText(e, null) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_overall_then_stages(out):
    assert out["two"].split("\n") == [
        "Dawn run · Ridge Runners — results (Vetta Score)", "",
        "Overall", "1. @cara 807 (all 2 stages) \u00b7 1:05:09", "2. @sam 811 (1 of 2 stages)", "",
        "SS1 Skyway", "1. @sam 811 \u00b7 3:10 (+6 s)", "1. @cara 811 \u00b7 3:04", "",
        "SS2 River Road", "1. @cara 802 \u00b7 1:02:05", "",
        "Vetta Score: how cleanly the corners were driven. Times only from drivers who share them with the crew.",
    ]


def test_one_stage_needs_no_stage_count(out):
    lines = out["one"].split("\n")
    assert lines[0] == "Crew drive — results (Vetta Score)"
    assert lines[3:5] == ["1. @sam 811", "1. @cara 811"]


def test_nothing_shared_is_nothing(out):
    assert out["none"] == "" and out["bad"] == ""



def test_a_time_with_no_shared_time_is_absent(out):
    assert out["one"].split("\n")[3:5] == ["1. @sam 811", "1. @cara 811"]
