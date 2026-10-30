"""Dead reckoning for the car's arrow (web/car_glide.js, REVIEW_FEEL.md F-01): between 1 Hz fixes the arrow is predicted
from the last fix at its speed, along the route line when the car is on it, capped, and eased into each new fix. The native
car map's CarGlide.swift is held to it by ApexKit/Tests/Fixtures/car_glide.json."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const G = require(process.argv[1] + '/web/car_glide.js');
const K_LAT = 110540, K_LON = 111320, RAD = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * K_LON * Math.cos(a.lat * RAD), (b.lat - a.lat) * K_LAT);
// a curving road, a point every 5 m (radius ~190 m), and the true car on it
const route = []; { let lat = 35, lon = -84, h = 0; for (let i = 0; i < 400; i++) { h += 1.5; lat += 5 * Math.cos(h * RAD) / K_LAT; lon += 5 * Math.sin(h * RAD) / (K_LON * Math.cos(lat * RAD)); route.push([lat, lon]); } }
const truth = (s) => { const k = Math.floor(s / 5), f = s / 5 - k; return { lat: route[k][0] + (route[k + 1][0] - route[k][0]) * f, lon: route[k][1] + (route[k + 1][1] - route[k][1]) * f }; };
function drive({ withRoute = true, speed = true, lateS = 0 }) {
  const g = G.create(); if (withRoute) g.setRoute(route, 0);
  const lag = [], v = 22;
  for (let sec = 0; sec < 12; sec++) {
    const s0 = 40 + v * sec, p = truth(s0);
    // the fix is lateS old when it arrives (a GPS fix is never fresh)
    g.push(p.lat, p.lon, null, speed ? v : null, sec - lateS, sec);
    for (let k = 1; k < 10; k++) if (sec >= 2) { const t = sec + k / 10, q = g.pose(t); lag.push(metres(q, truth(s0 + v * (k / 10 + lateS)))); }
  }
  lag.sort((a, b) => a - b);
  return { p50: lag[lag.length >> 1], max: lag[lag.length - 1], onRoute: g.onRoute };
}
// the old glide: the arrow eased to the newest fix, about one fix behind
const old = (() => { const lag = []; for (let sec = 2; sec < 12; sec++) for (let k = 1; k < 10; k++) { const s0 = 40 + 22 * sec; lag.push(metres(truth(s0 - 22 * (1 - k / 10)), truth(s0 + 22 * k / 10))); } lag.sort((a, b) => a - b); return { p50: lag[lag.length >> 1] }; })();

// capped: never more than 1.5 s or 50 m past a fix
const cap = (() => { const g = G.create(); g.push(35, -84, 90, 30, 0, 0); const a = g.pose(2), b = g.pose(10), f = G.create(); f.push(35, -84, 0, 60, 0, 0);
  return { at2: metres({ lat: 35, lon: -84 }, a), same: a.lat === b.lat && a.lon === b.lon, moving: g.moving(10), fast: metres({ lat: 35, lon: -84 }, f.pose(1.5)) }; })();
// a new fix is eased into, never jumped to; a far one (a seek, out of a tunnel) is drawn at once; a standing car stands
const ease = (() => { const g = G.create(); g.push(35, -84, 0, 0, 0, 0); const still = g.pose(1).lat;
  g.push(35 + 4 / K_LAT, -84, 0, 0, 1, 1); const at1 = g.pose(1).lat, mid = g.pose(1.2).lat, late = g.pose(6).lat;
  g.push(36, -84, 0, 0, 7, 7); return { still, at1, mid, late, jump: g.pose(7).lat }; })();
// slowing: the arrow ahead of the new prediction eases back no faster than the car moves, so it never runs backwards
const slowing = (() => { const g = G.create(); g.setRoute(route, 0); let back = 0, prev = null;
  const fixes = [[0, 25], [1, 25], [2, 5], [3, 5]]; let s = 40;
  for (const [t, v] of fixes) { const p = truth(s); g.push(p.lat, p.lon, null, v, t, t); for (let k = 0; k < 10; k++) { const q = g.pose(t + k / 10); if (prev != null) back = Math.max(back, prev - q.s); prev = q.s; } s += v; }
  return { back }; })();
// a road that doubles back on itself: the fix snaps to the leg heading the car's way
const hairpin = (() => { const leg = []; for (let i = 0; i <= 40; i++) leg.push([35 + i * 5 / K_LAT, -84]);
  const back = leg.slice().reverse().map(([a, b]) => [a, b + 10 / (K_LON * Math.cos(35 * RAD))]);
  const g = G.create(); g.setRoute(leg.concat(back), 0);
  g.push(35 + 100 / K_LAT, -84 + 5 / (K_LON * Math.cos(35 * RAD)), 180, 15, 0, 0);   // between the legs, heading south: the return leg
  const p = g.pose(0.5); return { s: p.s, course: p.course }; })();
// off the route the car goes along its course; with no route, speed and course come from the last two fixes
const free = (() => { const g = G.create(); g.push(35, -84, null, null, 0, 0); g.push(35 + 20 / K_LAT, -84, null, null, 1, 1);
  const p = g.pose(2.5); return { ahead: (p.lat - 35) * K_LAT, course: p.course }; })();
console.log(JSON.stringify({ dr: drive({}), drLate: drive({ lateS: 0.3 }), noSpeed: drive({ speed: false }), noRoute: drive({ withRoute: false }), old, cap, ease, slowing, hairpin, free }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_arrow_is_where_the_car_is_between_fixes(out):
    # F-01: the old glide trailed the car by about half a fix (11 m p50 at 20-25 m/s in the review's car.js); the
    # target is under 5 m p50
    assert out["old"]["p50"] > 9
    assert out["dr"]["p50"] < 0.5 and out["dr"]["max"] < 1.5 and out["dr"]["onRoute"]
    assert out["drLate"]["p50"] < 1, "a fix's age is driven through"
    assert out["noSpeed"]["p50"] < 2, "speed from the distance between fixes when the shell does not say it"
    assert out["noRoute"]["p50"] < 5, "off a route the course carries it (a chord across the curve, still under 5 m)"


def test_the_prediction_is_capped(out):
    c = out["cap"]
    assert abs(c["at2"] - 45) < 0.01 and c["same"] and not c["moving"], "no further than 1.5 s past the fix"
    assert abs(c["fast"] - 50) < 0.01, "and no further than 50 m"


def test_a_new_fix_is_eased_into_and_a_far_one_drawn_at_once(out):
    e = out["ease"]
    assert e["still"] == 35, "a standing car is not predicted"
    assert abs(e["at1"] - 35) < 1e-9 and 35 < e["mid"] < 35 + 4 / 110540, "eased, not jumped"
    assert abs(e["late"] - (35 + 4 / 110540)) < 1e-9
    assert e["jump"] == 36


def test_the_arrow_never_runs_backwards_when_the_car_slows(out):
    assert out["slowing"]["back"] < 0.05


def test_a_road_that_doubles_back_snaps_to_the_leg_heading_the_cars_way(out):
    h = out["hairpin"]
    assert h["s"] > 200 and abs(((h["course"] - 180 + 540) % 360) - 180) < 5


def test_with_no_route_the_course_and_speed_come_from_the_fixes(out):
    f = out["free"]
    assert abs(f["ahead"] - 50) < 0.5 and abs(((f["course"] + 540) % 360) - 180) < 1


def test_the_native_glide_fixture_is_current():
    """ApexKit's CarGlideTests replays this fixture through CarGlide.swift (the native car map)."""
    r = subprocess.run([NODE, os.path.join(ROOT, "tools", "make_glide_fixture.js"), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_the_car_map_draws_with_it():
    html = open(os.path.join(ROOT, "web", "carmap.html"), encoding="utf-8").read()
    js = open(os.path.join(ROOT, "web", "carmap.js"), encoding="utf-8").read()
    assert html.index('src="car_glide.js"') < html.index('src="carmap.js"')
    assert "ApexCarGlide.create()" in js and "never ahead" not in js.split("F-01")[0]


LINE = r"""
const C = require(process.argv[1] + '/web/carplay.js'), fs = require('fs');
function check(t) {
  const pts = C.line(t), lat0 = t.lat[0], lon0 = t.lon[0], c = Math.cos(lat0 * Math.PI / 180), xy = (lat, lon) => [(lon - lon0) * 111320 * c, (lat - lat0) * 110540];
  const P = pts.map(([a, b]) => xy(a, b));
  let worst = 0;
  for (let i = 0; i < t.lat.length; i++) {
    const [px, py] = xy(t.lat[i], t.lon[i]);
    let best = Infinity;
    for (let j = 0; j < P.length - 1; j++) {
      const [ax, ay] = P[j], [bx, by] = P[j + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, u = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
      best = Math.min(best, Math.hypot(ax + u * vx - px, ay + u * vy - py));
    }
    worst = Math.max(worst, best);
  }
  return { n: pts.length, of: t.lat.length, worst };
}
// the owner's own road (57 km, a row every 5 m), and a 55 km road that never stops bending
const text = fs.readFileSync(process.argv[1] + '/web/data/dry_ridge.js', 'utf8'), d = JSON.parse(text.slice(text.indexOf('push(') + 5, text.lastIndexOf(')')));
const real = { lat: d.rows.map((r) => r[d.fields.indexOf('lat')]), lon: d.rows.map((r) => r[d.fields.indexOf('lon')]) };
const t = { lat: [], lon: [] }; { let lat = 35.3, lon = -83.8, h = 0; for (let i = 0; i < 11000; i++) { h += 14 * Math.sin(i / 23) * Math.sin(i / 157); const b = h * Math.PI / 180; lat += 5 * Math.cos(b) / 110540; lon += 5 * Math.sin(b) / (111320 * Math.cos(lat * Math.PI / 180)); t.lat.push(lat); t.lon.push(lon); } }
console.log(JSON.stringify({ real: check(real), twisty: check(t), max: C.MAX_POINTS }));
"""


def test_the_cars_route_line_follows_the_road():
    """The arrow is dead reckoned along the car's route line, so the line keeps to the road: within 2.5 m of every point of
    the owner's 57 km Dry Ridge drive (it was every nth point, 400 in all: one every 140 m, a chord across every hairpin);
    a road too twisty for 2000 points at that keeps within twice it."""
    out = json.loads(subprocess.run([NODE, "-e", LINE, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["max"] == 2000 and out["real"]["n"] <= 2000 and out["twisty"]["n"] <= 2000, out
    assert out["real"]["worst"] <= 2.6, out
    assert out["twisty"]["worst"] <= 5.1, out
