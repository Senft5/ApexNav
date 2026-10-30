"""U-90: a route that uses the same road twice (an out-and-back, a loop that crosses itself, a lap driven twice).

The review drive's route doubled back along its own road; the matcher took the earlier pass, progress fell, and the
co-driver said "Back on route" 140 times in 36 s and then "Wrong way" for seven minutes with the car on the route. This
drives the page's own loop (web/reroute.js: matchRoute, then RerouteMonitor, the cursor kept only while on route) along
such routes with GPS noise and asserts what a driver must hear: nothing about the route at all.
"""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const { RerouteMonitor, matchRoute } = require(process.argv[1]);
const KY = 110540, LAT0 = 39.2, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
// A route from local metres (east, north), resampled at 5 m as the page's tracks are.
const route = (pts) => {
  const lat = [], lon = [], dist = [], E = [], N = [];
  let d = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [e0, n0] = pts[k], [e1, n1] = pts[k + 1], L = Math.hypot(e1 - e0, n1 - n0), steps = Math.max(1, Math.round(L / 5));
    for (let s = (k ? 1 : 0); s <= steps; s++) {
      const e = e0 + (e1 - e0) * s / steps, nn = n0 + (n1 - n0) * s / steps;
      if (E.length) d += Math.hypot(e - E[E.length - 1], nn - N[N.length - 1]);
      E.push(e); N.push(nn); dist.push(d); lat.push(LAT0 + nn / KY); lon.push(-84 + e / KX);
    }
  }
  return { lat, lon, dist, E, N };
};
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
// Drive the route as the page does: one fix a second at v m/s, GPS noise sigma m, the course from the road with 8 deg
// of noise. path(s) -> [east, north, headingDeg] is where the car really is after s metres.
function drive(R, path, totalS, v = 15, sigma = 4) {
  const m = new RerouteMonitor();
  let cursorM = 0, prev = 0, worstBack = 0;
  const log = { off: [], backOn: 0, reasons: [], cursor: [] };
  for (let t = 0, s = 0; s <= totalS; t++, s += v) {
    const [e, n, hd] = path(s);
    const lat = LAT0 + (n + sigma * gauss()) / KY, lon = -84 + (e + sigma * gauss()) / KX;
    const hit = matchRoute(R, lat, lon, { anchorM: cursorM, headingDeg: (hd + 8 * gauss() + 360) % 360, speedMps: v });
    const near = hit.distM < 40;
    const r = m.update({ t: t * 1000, distToRouteM: hit.distM, accuracyM: 8, speedMps: v, progressM: near ? R.dist[hit.index] : null });
    if (r.off) log.off.push(t);
    if (r.reason && !log.reasons.includes(r.reason)) log.reasons.push(r.reason);
    if (r.backOn) log.backOn++;
    if (near && !m.off) cursorM = R.dist[hit.index];
    worstBack = Math.max(worstBack, prev - cursorM); prev = cursorM;
    log.cursor.push(Math.round(cursorM));
  }
  log.worstBack = Math.round(worstBack); log.finalM = Math.round(cursorM); log.totalM = Math.round(R.dist[R.dist.length - 1]);
  return log;
}
// The car on the route itself: s metres along it.
const along = (R) => (s) => {
  let i = R.dist.findIndex((d) => d >= s); if (i < 0) i = R.dist.length - 1;
  const a = Math.max(0, i - 1), b = Math.min(R.dist.length - 1, i + 1);
  return [R.E[i], R.N[i], (Math.atan2(R.E[b] - R.E[a], R.N[b] - R.N[a]) * 180 / Math.PI + 360) % 360];
};
const out = {};
// 1. out-and-back: 2 km east, a V turnaround, 1.8 km back west along the same road (6 m over, the other lane), then
//    away south. The GPX of the review drive doubled back like this on New Biddinger Road.
const ob = route([[0, 0], [2000, 0], [2030, -3], [2000, -6], [200, -6], [200, -1500]]);
out.outAndBack = drive(ob, along(ob), ob.dist[ob.dist.length - 1] - 1);
// the same with the return leg on the very same line (a GPX that reverses itself point for point)
const rev = route([[0, 0], [2000, 0], [2015, 0], [0, 0.5], [0, -1200]]);
out.reverse = drive(rev, along(rev), rev.dist[rev.dist.length - 1] - 1);
// 2. a lap driven twice: a 1.6 km square circuit, twice round, same direction both laps
const sq = [[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]];
const lap = route([...sq, ...sq.slice(1)]);
out.laps = drive(lap, along(lap), lap.dist[lap.dist.length - 1] - 1);
// 3. a figure of eight: the route crosses itself at right angles
const eight = route([[0, 0], [600, 0], [600, 300], [300, 300], [300, -300], [0, -300], [0, 0]]);
out.eight = drive(eight, along(eight), eight.dist[eight.dist.length - 1] - 1);
// 4. still wrong way when it is: a straight 3 km road, the car turns round at 600 m and drives back down it
const straight = route([[0, 0], [3000, 0]]);
out.uturn = drive(straight, (s) => (s <= 600 ? [s, 0, 90] : [Math.max(0, 1200 - s), 0, 270]), 1100);
// 5. the monitor alone on the storm's input: progress alternating between the right pass and one 500 m back
const storm = new RerouteMonitor(); let stormOff = 0, stormBack = 0;
for (let t = 0; t < 60; t++) {
  const p = t < 20 ? 15 * t : (t % 2 ? 15 * t : 15 * t - 500);
  const r = storm.update({ t: t * 1000, distToRouteM: 3, accuracyM: 8, speedMps: 15, progressM: p });
  if (r.off) stormOff++; if (r.backOn) stormBack++;
}
out.storm = { off: stormOff, backOn: stormBack };
// 6. and once it is wrong way, one good fix among bad ones does not end it: three in a row do, once
const ww = new RerouteMonitor(); const wwBack = [];
for (let t = 0; t < 90; t++) {
  let p = t <= 40 ? 15 * t : 0;                       // 600 m, then matched far behind: wrong way after 5 s
  if (t >= 50 && t < 70 && t % 2) p = 600;            // alternate good and bad fixes: never back on
  if (t >= 75) p = 600 + 15 * (t - 75);               // then steadily good
  const r = ww.update({ t: t * 1000, distToRouteM: 3, accuracyM: 8, speedMps: 15, progressM: p });
  if (r.backOn) wwBack.push(t);
}
out.wrongWayBack = { back: wwBack, offAt: null };
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    path = os.path.abspath("web/reroute.js")
    res = subprocess.run([NODE, "-e", RUNNER, path], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


@pytest.mark.parametrize("name", ["outAndBack", "reverse", "laps", "eight"])
def test_a_route_that_uses_its_road_twice_is_followed_to_the_end(r, name):
    d = r[name]
    assert d["off"] == [] and d["backOn"] == 0, f"{name}: never off route, never 'Back on route': {d['reasons']}"
    assert d["worstBack"] <= 25, f"{name}: progress is monotonic (GPS noise aside), fell {d['worstBack']} m"
    assert d["finalM"] >= d["totalM"] - 30, f"{name}: the cursor reaches the end: {d['finalM']} of {d['totalM']}"


def test_out_and_back_progress_passes_the_turnaround(r):
    # the return leg is matched as the return leg: progress past the 2 km apex, not back on the out leg
    cur = r["outAndBack"]["cursor"]
    assert max(cur) > 3500 and cur[-1] == max(cur)


def test_a_real_u_turn_is_still_wrong_way(r):
    d = r["uturn"]
    assert d["reasons"] == ["wrong_way"]
    # best progress 600 m at s = 600 (t = 40); 100 m behind it by t = 47; held 5 s
    assert 50 <= d["off"][0] <= 54


def test_alternating_passes_never_storm(r):
    assert r["storm"] == {"off": 0, "backOn": 0}, "a regression that does not hold for 5 s is not wrong way"


def test_wrong_way_ends_on_three_good_fixes_once(r):
    assert r["wrongWayBack"]["back"] == [77], r["wrongWayBack"]
