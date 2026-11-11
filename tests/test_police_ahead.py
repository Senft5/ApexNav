"""Avoid police reports while driving (web/hazard_reports.js onRouteAhead, docs/ROUTING.md): a live report on the route
ahead, far enough on to go round and near enough to still be there, is the one offered; one behind you, beside the road,
too close or too far on is not."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const H = require(process.argv[1] + '/web/hazard_reports.js');
// a straight road north, a point every 100 m for 40 km
const t = { lat: [], lon: [], dist: [] };
for (let i = 0; i <= 400; i++) { t.lat.push(35 + i * 100 / 110540); t.lon.push(-84); t.dist.push(i * 100); }
const on = (km, offM = 0) => ({ lat: 35 + km * 1000 / 110540, lon: -84 + offM / (111320 * Math.cos(35 * Math.PI / 180)) });
const out = {
  ahead: H.onRouteAhead(t, 2000, [on(6)]),
  nearest: H.onRouteAhead(t, 2000, [on(20), on(9, 100)]),
  behind: H.onRouteAhead(t, 2000, [on(1)]),
  beside: H.onRouteAhead(t, 2000, [on(6, 400)]),
  tooClose: H.onRouteAhead(t, 2000, [on(2.5)]),
  tooFar: H.onRouteAhead(t, 2000, [on(30)]),
  none: H.onRouteAhead(t, 2000, []),
  bad: H.onRouteAhead(null, 2000, [on(6)]),
  noAt: H.onRouteAhead(t, NaN, [on(6)]),
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_a_report_on_the_route_ahead_is_found_with_how_far(out):
    assert out["ahead"] and abs(out["ahead"]["aheadM"] - 4000) <= 5, out["ahead"]
    assert abs(out["nearest"]["aheadM"] - 7000) <= 5, out["nearest"]      # the nearer one, 100 m off the road


def test_behind_beside_too_close_or_too_far_is_not(out):
    for k in ("behind", "beside", "tooClose", "tooFar", "none", "bad", "noAt"):
        assert out[k] is None, (k, out[k])
