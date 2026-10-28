"""Recce (web/recce.js, IDEAS V-09): keep a drive's notes, edit a call, and it's read on the same corner in the same direction only."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = require(process.argv[1] + '/web/recce.js');
// a road north for 2 km, 5 m apart; corners at 400 m and 1200 m
const n = 401, lat = Array.from({ length: n }, (_, i) => 35 + i * 5 / 110540), lon = Array(n).fill(-83);
const drive = { lat, lon, events: [{ type: 'corner', index: 80, call: 'Left 4', code: 'L4' }, { type: 'corner', index: 240, call: 'Right 3', code: 'R3' }, { type: 'bump', index: 100 }] };
let notes = R.keep([], drive);
const kept = notes.map((x) => x.call);
notes = R.edit(notes, notes[0], 'Left 3 tightens, care');
// later: a route over the same road, same direction, slightly offset; and one the other way
const route = { lat: lat.map((x) => x + 0.00005), lon, events: [{ type: 'corner', index: 81, call: 'Left 4 minus', code: 'L4' }, { type: 'corner', index: 241, call: 'Right 3', code: 'R3' }, { type: 'corner', index: 380, call: 'Left 2', code: 'L2' }] };
const used = R.apply(notes, route);
const rev = { lat: lat.slice().reverse(), lon, events: [{ type: 'corner', index: 320, call: 'Right 4', code: 'R4' }] };
const usedRev = R.apply(notes, rev);
// keeping again doesn't overwrite an edited call
const again = R.keep(notes, drive).map((x) => [x.call, x.edited]);
const back = R.edit(notes, notes[0], '');
console.log(JSON.stringify({ kept, used, calls: route.events.map((e) => [e.call, e.mapCall ?? null, !!e.recce]), usedRev, rev: rev.events[0].call, again, back: back[0].call, forget: R.forget(notes, route).length }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_keep_and_read(out):
    assert out["kept"] == ["Left 4", "Right 3"]
    assert out["used"] == 2
    assert out["calls"] == [["Left 3 tightens, care", "Left 4 minus", True], ["Right 3", "Right 3", True], ["Left 2", None, False]]


def test_direction_and_editing(out):
    assert out["usedRev"] == 0 and out["rev"] == "Right 4"                 # the other way round: the map's notes
    assert out["again"] == [["Left 3 tightens, care", True], ["Right 3", False]]
    assert out["back"] == "Left 3 tightens, care"                          # an empty edit keeps the call (no blank notes)
    assert out["forget"] == 0
