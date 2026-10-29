"""Lane guidance (web/lanes.js, IDEAS R-29): the router's lane bits kept small, drawn per lane, and said as "use the left 2
lanes" only when it is clear; numbered exits said as the sign reads (web/directions.js)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
globalThis.ApexLanes = require(process.argv[1] + '/web/lanes.js');
const L = globalThis.ApexLanes, D = require(process.argv[1] + '/web/directions.js');
// Valhalla, I-40 at Knoxville: two through lanes, then a through/slight-right lane and a slight-right lane, both to use
const exitLanes = L.pack([{ directions: 2 }, { directions: 2 }, { directions: 34, active: 32 }, { directions: 32, active: 32 }]);
const keepLeft = L.pack([{ directions: 2, active: 2 }, { directions: 2, active: 2 }, { directions: 32 }]);
const middle = L.pack([{ directions: 8 }, { directions: 2, active: 2 }, { directions: 64 }]);
const split = L.pack([{ directions: 8, active: 8 }, { directions: 2 }, { directions: 8, active: 8 }]);
const steps = [{ m: 2000, type: 20, street: 'US 129', exit: '386B', toward: 'Airport', lanes: exitLanes }, { m: 6000, type: 24, street: 'US 129', lanes: keepLeft }];
const said = new Set();
console.log(JSON.stringify({
  packed: exitLanes, none: [L.pack(null), L.pack([{ directions: 2 }]), L.pack([{ directions: 2 }, { directions: 2 }])],
  drawn: L.lanes(exitLanes),
  hints: [L.hint(exitLanes), L.hint(keepLeft), L.hint(middle), L.hint(split)],
  phrase: [D.phrase(steps[0]), D.phrase({ type: 20, street: 'US 129' }), D.phrase({ type: 23, toward: 'Asheville' })],
  early: D.due(steps, 1300, 25, said).map(x => x.text),
  strip: D.stripNote(steps[0]),
  placed: D.placeSteps([{ lat: 1, lon: 1, type: 20, exit: '386B', toward: 'Airport', lanes: exitLanes }], () => 100)[0],
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_pack_keeps_only_useful_lane_data(out):
    assert out["packed"] == [[2, 0, 0], [2, 0, 0], [34, 32, 0], [32, 32, 0]]
    assert out["none"] == [None, None, None], "no data, one lane, or nothing marked to use: no guidance"


def test_each_lane_drawn_with_its_used_arrow(out):
    assert out["drawn"] == [{"angle": 0, "use": False, "ok": False}, {"angle": 0, "use": False, "ok": False},
                            {"angle": 45, "use": True, "ok": True}, {"angle": 45, "use": True, "ok": True}]


def test_hints_only_when_clear(out):
    assert out["hints"] == ["the right 2 lanes", "the left 2 lanes", "a middle lane", None]


def test_exits_said_as_the_sign_reads(out):
    assert out["phrase"] == ["Take exit 386B toward Airport", "Take the exit on the right onto US 129", "Keep right toward Asheville"]


def test_early_call_carries_the_lanes(out):
    assert out["early"] == ["In 0.4 miles, take exit 386B toward Airport, use the right 2 lanes"]


def test_strip_and_placing_keep_exit_and_lanes(out):
    assert out["strip"]["code"] == "Exit 386B" and out["strip"]["call"] == "US 129" and out["strip"]["lanes"] == out["packed"]
    assert out["placed"]["exit"] == "386B" and out["placed"]["toward"] == "Airport" and out["placed"]["lanes"] == out["packed"]
