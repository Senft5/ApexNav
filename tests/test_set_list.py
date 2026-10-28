"""Set list (IDEAS R-12): with the same stages the order that finishes on the most technical one wins, and three max-TECH
stages back to back cost a quarter of their value (fatigue is a safety issue)."""
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
const st = (name, tight, lat0) => ({ name, km: 10, tight, score: 30, lat: [lat0, lat0 + 0.05], lon: [-84, -84] });
const flowing = st('flowing', 5, 35), tech = st('tech', 30, 35.2), tech2 = st('tech2', 30, 35.4), tech3 = st('tech3', 28, 35.6);
const L = (...ss) => ss.map(s => ({ s, fwd: true }));
// loop: every connector 2 km, so both orders of the same two stages cost the same
const n = 2, cost = Array.from({ length: 1 + 2 * n }, () => Array(2 * n + 1).fill(2));
const loop = F.loopPlansFromMatrix([flowing, tech], cost, 26, 3).filter(p => p.legs.length === 2)[0];
// A to B: both orders cost the same time
const ab = Array.from({ length: 1 + 2 * n }, () => Array(2 * n + 1).fill(300));
const abPlan = F.plansFromMatrix([tech, flowing], ab, 2300, 'fun', 3, 2).filter(p => p.legs.length === 2)[0];
console.log(JSON.stringify({
  one: F.setList(L(tech)), finish: F.setList(L(flowing, tech)), start: F.setList(L(tech, flowing)), same: F.setList(L(tech, tech2)),
  three: F.setList(L(tech, tech2, tech3)), rested: F.setList(L(tech, flowing, tech2, tech3)),
  loop: loop && loop.legs.map(l => l.s.name), ab: abPlan && abPlan.legs.map(l => l.s.name),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_finish_high(out):
    assert out["one"] == 0 and out["start"] == 0 and out["same"] == 0
    assert out["finish"] == pytest.approx(0.04 * 60)


def test_three_max_tech_in_a_row_cost(out):
    assert out["three"] == pytest.approx(-0.25 * 90)
    # a rest in between: only two in a row at the end, and the hardest isn't last (28 < 30), so nothing either way
    assert out["rested"] == 0


def test_plans_take_the_order_that_finishes_high(out):
    assert out["loop"] == ["flowing", "tech"]
    assert out["ab"] == ["flowing", "tech"]
