"""Live ETA (web/eta.js): router time ahead, scaled by your pace so far, bounded and smoothed; unknown stays unknown."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const E = require(process.argv[1] + '/web/eta.js');
const out = {};
// 10 km the router times at 600 s: first 5 km slow (400 s), last 5 km fast (200 s)
const marks = [[5000, 400]];
out.left = [0, 2500, 5000, 7500, 10000, 12000].map(m => E.routerLeft(m, 10000, 600, marks));
out.linear = E.routerLeft(2500, 10000, 600, []);
out.badMarks = E.routerLeft(2500, 10000, 600, [[3000, 700], [NaN, 5], [12000, 50]]);   // more seconds than the route, NaN, past the end: ignored
out.unknown = [E.routerLeft(100, 10000, null), E.routerLeft(null, 10000, 600), E.routerLeft(100, 0, 600)];
// Drive the 10 km at a pace, 1 fix a second; returns the pace factor every 60 s.
const drive = (paceAt) => {
  const p = E.createPace(), f = [];
  let m = 0, t = 0;
  while (m < 10000 && t < 3600) {
    const left = E.routerLeft(m, 10000, 600, []);
    const k = p.update(t * 1000, left);
    if (t % 60 === 0) f.push(+k.toFixed(2));
    m += (10000 / 600) / paceAt(t); t++;
  }
  return f;
};
out.steady = drive(() => 1);
out.slow = drive(() => 1.3);
// a 90 s red light at 3 min, otherwise router pace
out.light = drive((t) => (t >= 180 && t < 270 ? 1e9 : 1));
out.crawl = drive(() => 5);   // a jam: capped
const p = E.createPace(); p.update(0, 600); p.update(200000, 300); p.reset();
out.reset = p.update(300000, 200);
out.est = E.estimate(300, 1.2, 1000);
out.estUnknown = E.estimate(null, 1, 1000);
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    res = subprocess.run([NODE, "-e", RUNNER, os.path.abspath(".")], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_router_time_ahead_follows_its_maneuver_times(r):
    assert r["left"] == [600, 400, 200, 100, 0, 0]
    assert r["linear"] == 450
    assert r["badMarks"] == 450, "marks with more time than the route, or past its end, are ignored"
    assert r["unknown"] == [None, None, None]


def test_pace_starts_at_one_and_learns_slowly(r):
    assert all(abs(f - 1) < 0.02 for f in r["steady"])
    assert r["slow"][0] == 1 and r["slow"][1] == 1, "no pace before 2 min of driving"
    assert r["slow"][-1] > 1.2 and r["slow"][-1] <= 1.3
    assert all(b >= a for a, b in zip(r["slow"], r["slow"][1:])), "smoothed: no jumps back and forth"


def test_a_red_light_or_a_jam_does_not_explode_the_estimate(r):
    assert max(r["light"]) < 1.6, r["light"]
    assert max(r["crawl"]) <= 1.8


def test_a_new_route_starts_the_pace_over_and_estimates_say_unknown(r):
    assert r["reset"] == 1
    assert r["est"] == {"leftS": 360, "arriveAt": 361000}
    assert r["estUnknown"] is None
