"""Off-route detection (web/reroute.js): jitter never reroutes, a real turn-off reroutes once, wrong way, backoff."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const { RerouteMonitor } = require(process.argv[1]);
const out = {};
// Feed 1 Hz fixes; returns the times (s) that asked for a reroute, plus the back-on times.
const drive = (m, fixes, onRequest) => {
  const req = [], back = [], offAt = [];
  for (const f of fixes) {
    const r = m.update({ accuracyM: 8, speedMps: 15, ...f, t: f.t * 1000 });
    if (r.request) { req.push(f.t); if (onRequest) onRequest(m, f.t); }
    if (r.backOn) back.push(f.t);
    if (r.off && !offAt.length) offAt.push(f.t, r.reason);
  }
  return { req, back, offAt };
};
const seq = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

// 1. jitter at a corner: single-second spikes to 55 m, and a long 50 m stretch with 30 m accuracy (threshold 60 m)
out.jitter = drive(new RerouteMonitor(), seq(60, (t) => ({ t, distToRouteM: t % 4 === 0 ? 55 : 12, progressM: 15 * t })));
out.poorFix = drive(new RerouteMonitor(), seq(30, (t) => ({ t, distToRouteM: 50, accuracyM: 30, progressM: 15 * t })));
// 2. a real turn-off at t = 10: distance grows 12 m/s and the driver never comes back
out.turnOff = drive(new RerouteMonitor(), seq(60, (t) => ({ t, distToRouteM: t < 10 ? 5 : 12 * (t - 9), progressM: 15 * Math.min(t, 10) })));
// 3. a 4 s excursion past 40 m (wide pull-off) then back: never off route
out.rejoin = drive(new RerouteMonitor(), seq(30, (t) => ({ t, distToRouteM: t >= 10 && t < 14 ? 60 : 8, progressM: 15 * t })));
// 4. stopped (parked off the road, GPS drifting at 80 m): never off route
out.parked = drive(new RerouteMonitor(), seq(30, (t) => ({ t, distToRouteM: 80, speedMps: 0.5, progressM: 0 })));
// 5. wrong way: forward to 600 m, then a U-turn and back down the route at 15 m/s
out.wrongWay = drive(new RerouteMonitor(), seq(80, (t) => ({ t, distToRouteM: 5, progressM: t <= 40 ? 15 * t : 600 - 15 * (t - 40) })));
// 6. back on route: off at 100 m, then rejoins under 25 m
out.backOn = drive(new RerouteMonitor(), seq(40, (t) => ({ t, distToRouteM: t >= 5 && t < 25 ? 100 : 10, progressM: 15 * t })));
// 7. backoff: every request fails at once; the driver stays off route for 6 minutes
out.backoff = drive(new RerouteMonitor(), seq(400, (t) => ({ t, distToRouteM: t < 5 ? 5 : 200, progressM: 0 })), (m, t) => m.requestFailed(t * 1000));
// 8. cooldown: a reroute succeeds at once, but the new route is wrong too: the next request waits 20 s from the first
out.cooldown = drive(new RerouteMonitor(), seq(60, (t) => ({ t, distToRouteM: t < 5 ? 5 : 200, progressM: 0 })), (m) => m.routeChanged());
// 9. no GPS for 10 s while far does not count as 5 s off route
out.tunnel = drive(new RerouteMonitor(), seq(20, (t) => (t % 3 === 0 ? { t, distToRouteM: 90, progressM: 0 } : { t, distToRouteM: null })));
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    path = os.path.abspath("web/reroute.js")
    out = subprocess.run([NODE, "-e", RUNNER, path], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_gps_jitter_never_reroutes(r):
    assert r["jitter"]["req"] == [] and r["jitter"]["offAt"] == []
    assert r["poorFix"]["req"] == [], "50 m off with 30 m accuracy is inside the 2x accuracy band"


def test_real_turn_off_reroutes_once(r):
    # first fix past 40 m is t = 13 (48 m); 5 s in a row -> off and one request at t = 18
    assert r["turnOff"]["offAt"] == [18, "distance"]
    assert r["turnOff"]["req"] == [18], "one request per episode while it is pending"


def test_rejoin_before_5s_cancels(r):
    assert r["rejoin"]["req"] == [] and r["rejoin"]["offAt"] == []


def test_parked_drift_is_not_off_route(r):
    assert r["parked"]["req"] == []


def test_wrong_way_triggers(r):
    off_t, reason = r["wrongWay"]["offAt"]
    assert reason == "wrong_way"
    # best progress 600 m at t = 40; 100 m lower is t = 47 (495 m) at 15 m/s
    assert off_t == 47 and r["wrongWay"]["req"] == [47]


def test_back_on_route(r):
    assert r["backOn"]["req"] == [10] and r["backOn"]["back"] == [25]


def test_backoff_schedule(r):
    req = r["backoff"]["req"]
    gaps = [b - a for a, b in zip(req, req[1:])]
    assert req[0] == 10
    assert gaps[:5] == [20, 40, 80, 120, 120]
    assert all(g == 120 for g in gaps[3:])


def test_cooldown_between_requests(r):
    req = r["cooldown"]["req"]
    assert req[0] == 10 and all(b - a >= 20 for a, b in zip(req, req[1:]))
    assert req[1] == 30


def test_missing_fix_breaks_the_run(r):
    assert r["tunnel"]["req"] == []
