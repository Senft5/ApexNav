"""The routes' time callouts on the map (web/route_callouts.js): each route the plan offers gets a tag where it runs apart
from the others, with its time and corners; a route that never leaves another gets none, and unknown numbers stay '--'."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
ROOT = Path(__file__).resolve().parents[1]

RUNNER = r"""
const C = require(process.argv[1] + '/web/route_callouts.js');
// two routes from A to B: one straight east, one bowing ~1 km north in the middle; a third that is the first again
const n = 60, A = [-84.6, 39.1], B = [-84.5, 39.1];
const straight = Array.from({ length: n }, (_, i) => [A[0] + (B[0] - A[0]) * i / (n - 1), 39.1]);
const bow = Array.from({ length: n }, (_, i) => [A[0] + (B[0] - A[0]) * i / (n - 1), 39.1 + 0.01 * Math.sin(Math.PI * i / (n - 1))]);
const spots = C.anchors([straight, bow]);
const dup = C.anchors([straight, bow, straight.slice()]);
const tags = C.tags([{ route: { coords: straight }, timeS: 420, corners: 5 }, { route: { coords: bow }, timeS: 3900, corners: 1 }], 0);
const unknown = C.tags([{ route: { coords: straight } }, { route: { coords: bow }, timeS: NaN, corners: null }], 1);
console.log(JSON.stringify({ spots, dup, tags, unknown,
  one: C.tags([{ route: { coords: straight }, timeS: 60 }], 0), none: C.tags(null, 0), bad: C.anchors([[], [[1, 2]], [[NaN, 1], [2, 'x']]]),
  apart: spots[1] ? C.metres(spots[1], [spots[1][0], 39.1]) : null }));
"""


@pytest.fixture(scope="module")
def out():
    if not NODE:
        pytest.skip("node not installed")
    return json.loads(subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, check=True).stdout)


def test_tag_sits_where_the_route_runs_apart(out):
    # the bowed route's tag is at its far point from the straight one (the middle, ~1.1 km north)
    assert out["spots"][1] is not None
    assert abs(out["spots"][1][0] - (-84.55)) < 0.01
    assert out["apart"] > 1000
    # the straight route is apart from the bow everywhere but its ends; its tag stays in its middle part
    assert -84.58 <= out["spots"][0][0] <= -84.52


def test_a_route_that_never_leaves_another_gets_no_tag(out):
    assert out["dup"][0] is None and out["dup"][2] is None
    assert out["dup"][1] is not None


def test_tags_carry_time_corners_and_the_pick(out):
    a, b = out["tags"]
    assert (a["time"], a["corners"], a["on"]) == ("7 min", "5 corners", True)
    assert (b["time"], b["corners"], b["on"]) == ("1:05 h", "1 corner", False)
    assert a["label"] == "This route: 7 min, 5 corners"
    assert b["label"] == "Take this route: 1:05 h, 1 corner"


def test_unknown_stays_unknown(out):
    for g in out["unknown"]:
        assert g["time"] == "--" and g["corners"] == "--"
    assert out["unknown"][1]["on"] is True
    assert out["unknown"][0]["label"] == "Take this route: time unknown, corners unknown"


def test_one_route_or_nothing_has_no_tags(out):
    assert out["one"] == [] and out["none"] == []
    assert out["bad"] == [None, None, None]
