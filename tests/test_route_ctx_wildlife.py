"""Route context `wildlife` (web/route_ctx/wildlife.js): deer hours from the sun at each sample's eta, the state's month and
the land; calibrated on the Ohio State Highway Patrol's hour-of-day shares."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const root = process.argv[1];
const W = require(root + '/web/route_ctx/wildlife.js'), C = require(root + '/tests/fixtures/route_ctx/corridor.js');
const nan = (a) => Array.from(a, (v) => (Number.isNaN(v) ? null : v));
// the OSHP shares, from the curve on an equinox-like day (sunrise 06:00, sunset 18:00)
let tot = 0, dawn = 0, dusk = 0;
for (let m = 0; m < 1440; m++) { const f = W.hourFactor(m - 360, m - 1080); tot += f; if (m >= 300 && m < 480) dawn += f; if (m >= 1080 && m < 1320) dusk += f; }
const months = (st) => Array.from({ length: 12 }, (_, i) => W.monthFactor(st, i + 1));
// a ridge road in Brown County, Ohio (rural), at dawn in November vs noon in July
const line = [[38.95, -83.95], [38.96, -83.93], [38.97, -83.90]];
const nov = C.corridor('nov', line, { departAt: Date.UTC(2026, 10, 3, 12, 0) });        // 07:00 EST, sunrise ~07:12
const jul = C.corridor('jul', line, { departAt: Date.UTC(2026, 6, 15, 17, 0) });        // 13:00 EDT
const forest = (c, f, a, u) => ({ channels: { [c.id]: { forest_frac: new Float32Array(c.lat.length).fill(f), farmland_frac: new Float32Array(c.lat.length).fill(a), urban_density: new Float32Array(c.lat.length).fill(u) } } });
const rn = W.evaluate(nov, forest(nov, 0.5, 0.5, 0)), rj = W.evaluate(jul, forest(jul, 0.5, 0.5, 0));
const town = W.evaluate(nov, forest(nov, 0.1, 0, 10)), bare = W.evaluate(nov, {});
const crossing = W.evaluate(nov, { places: { animal_crossing: [{ lat: nov.lat[10], lon: nov.lon[10] }] }, ...forest(nov, 0.5, 0.5, 0) });
const outside = W.evaluate(C.corridor('pa', [[40.5, -79.0], [40.51, -79.0]], { departAt: Date.UTC(2026, 10, 3, 12) }), {});
console.log(JSON.stringify({
  mean: tot / 1440, dawnShare: dawn / tot, duskShare: dusk / tot,
  oh: months('OH'), wv: months('WV'), meanOh: months('OH').reduce((a, b) => a + b) / 12, xx: W.monthFactor('PA', 11),
  nov: { risk: nan(rn.channels.deer_risk)[0], time: nan(rn.channels.deer_time_risk)[0], spans: rn.spans.map((s) => s.kind), status: rn.status },
  jul: { risk: nan(rj.channels.deer_risk)[0], spans: rj.spans },
  town: nan(town.channels.deer_risk)[0],
  bare: { risk: [...new Set(nan(bare.channels.deer_risk))], time: nan(bare.channels.deer_time_risk)[0], spans: bare.spans.map((s) => s.kind), note: bare.note },
  crossing: crossing.points.map((p) => p.kind),
  outside: { status: outside.status, time: [...new Set(nan(outside.channels.deer_time_risk))] },
  land: [W.landFactor(0.5, 0.5, 0), W.landFactor(1, 0, 0), W.landFactor(0, 1, 0), W.landFactor(0.5, 0.5, 10), W.landFactor(null, null, null)],
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_hour_curve_matches_the_ohio_patrol_shares(out):
    # OSHP 2017-2022: 26 % of deer crashes 05:00-07:59, 31 % 18:00-21:59
    assert abs(out["dawnShare"] - 0.26) < 0.03 and abs(out["duskShare"] - 0.31) < 0.03
    assert abs(out["mean"] / 1.06 - 1) < 0.01


def test_month_table_is_the_state_shares(out):
    oh = out["oh"]
    assert abs(out["meanOh"] - 1) < 1e-6
    assert oh[10] == pytest.approx(0.22 * 12) and oh[9] == oh[11] == pytest.approx((0.47 - 0.22) / 2 * 12)
    assert max(out["wv"]) < max(oh)                                 # WV reports a flatter fall (40 % in Q4)
    assert out["xx"] is None


def test_dawn_in_november_is_a_deer_hour_and_july_noon_is_not(out):
    assert out["nov"]["risk"] > 5 and out["nov"]["spans"] == ["deer-hour"] and out["nov"]["status"] == "ok"
    assert out["jul"]["risk"] < 1 and out["jul"]["spans"] == []
    assert out["town"] < out["nov"]["risk"] / 3


def test_without_land_use_only_the_time_risk_is_known(out):
    b = out["bare"]
    assert b["risk"] == [None] and b["time"] > 3 and b["spans"] == ["deer-hour"] and "land-use" in b["note"]
    assert out["crossing"] == ["deer-crossing"]
    assert out["outside"]["status"] == "unavailable" and out["outside"]["time"] == [None]


def test_land_factor(out):
    edge, deep, farm, town, none = out["land"]
    assert edge > deep > farm > town and none is None
