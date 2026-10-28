"""Corners you like in routing (web/fun_route.js score prefs, IDEAS R-19): asking for more hairpins ranks a hairpin road
above a sweeper road and fewer reverses it; asking for nothing leaves every score as it was."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const F = require(process.argv[1] + '/web/fun_route.js');
// two 10 km roads with corners every 800 m: one of hairpins and 2s, one of 5s and 6s
const road = (sevs) => ({ dist: Array.from({ length: 2001 }, (_, i) => i * 5),
  events: Array.from({ length: 12 }, (_, k) => ({ type: 'corner', severity: sevs[k % sevs.length], dist_m: 500 + k * 800, start_m: 480 + k * 800, end_m: 520 + k * 800 })) });
const tight = road(['HP', 2, 1]), fast = road([5, 6, 5]);
const f = (t, p) => F.score(t, [], p).fun;
console.log(JSON.stringify({
  none: [f(tight, null), f(fast, null)], zero: [f(tight, { tight: 0, fast: 0 }), f(fast, { tight: 0, fast: 0 })],
  moreTight: [f(tight, { tight: 1 }), f(fast, { tight: 1 })], fewerTight: [f(tight, { tight: -1 }), f(fast, { tight: -1 })],
  moreFast: [f(tight, { fast: 1 }), f(fast, { fast: 1 })], clamp: f(tight, { tight: 5 }) === f(tight, { tight: 1 }),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_nothing_asked_changes_nothing(out):
    assert out["zero"] == out["none"]


def test_preferences_move_the_ranking(out):
    assert out["moreTight"][0] > out["none"][0] and out["moreTight"][1] == out["none"][1]
    assert out["fewerTight"][0] < out["none"][0]
    assert out["moreFast"][1] > out["none"][1] and out["moreFast"][0] == out["none"][0]
    assert out["moreTight"][0] - out["moreTight"][1] > out["none"][0] - out["none"][1]
    assert out["clamp"]
