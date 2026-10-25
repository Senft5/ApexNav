"""Stage discovery + chaining (web/stages.js) on synthetic roads: no network, deterministic."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
globalThis.ApexCore = require(process.argv[1] + '/web/apex_core.js');
require(process.argv[1] + '/web/stages.js');
const S = globalThis.ApexStages;
const lat0 = 39.2, lon0 = -84.6, mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
// polyline in metres -> [lon, lat]
const ll = (pts) => pts.map(([x, y]) => [lon0 + x * mLon, lat0 + y * mLat]);
const straight = (x0, y0, len) => ll(Array.from({ length: len / 10 + 1 }, (_, i) => [x0 + i * 10, y0]));
// S-bends: a sine road, amplitude 60 m, wavelength 400 m (a corner every 200 m)
const wiggly = (x0, y0, len) => ll(Array.from({ length: len / 5 + 1 }, (_, i) => [x0 + i * 5, y0 + 60 * Math.sin(2 * Math.PI * i * 5 / 400)]));
// a loop that closes on itself (park/cemetery drive)
const ring = (cx, cy, r) => ll(Array.from({ length: 361 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 180) + 40 * Math.sin(i * Math.PI / 15), cy + r * Math.sin(i * Math.PI / 180)]));
const out = {};
// 1. strokes join tile-clipped pieces end to end
const w = wiggly(0, 0, 6000);
const pieces = [{ cls: 'tertiary', pts: w.slice(0, 500) }, { cls: 'tertiary', pts: w.slice(499, 900) }, { cls: 'tertiary', pts: w.slice(899) }];
const st = S.strokes(pieces);
out.strokes = st.strokes.length;
out.strokePts = st.strokes[0].pts.length;
out.wigglyPts = w.length;
// 2. a twisty road scores, a straight one does not, a closed ring is rejected
const win = (pts) => { const p = [{ cls: 'minor', pts }]; const s = S.strokes(p); return S.bestWindow(s.strokes[0], s.ends, p); };
const wg = win(wiggly(0, 0, 6000));
out.wiggly = wg && { km: wg.km, good: wg.good, score: wg.score };
out.straight = win(straight(0, 0, 6000));
out.ring = win(ring(0, 0, 900));
// 3. plans fit the target length and waypoints respect the public server's 10-location cap
const mk = (dx, dy) => { const p = [{ cls: 'tertiary', pts: wiggly(dx, dy, 5000) }]; const s = S.strokes(p); return S.bestWindow(s.strokes[0], s.ends, p); };
const stages = [mk(2000, 3000), mk(-8000, 3000), mk(-3000, -5000), mk(3000, -4000)].filter(Boolean).sort((a, b) => b.score - a.score);
const start = { lat: lat0, lon: lon0 };
const plans = S.plans(start, stages, 40, 3);
out.plans = plans.map(p => ({ legs: p.legs.length, total: p.total, wps: S.waypoints(start, p).length }));
process.stdout.write(JSON.stringify(out));
"""


def _run():
    res = subprocess.run([NODE, "-e", RUNNER, os.path.abspath(".")], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_stages_join_pieces_score_twisty_roads_and_plan_loops():
    r = _run()
    assert r["strokes"] == 1, "three clipped pieces of one road are one stroke"
    assert r["strokePts"] == r["wigglyPts"]
    assert r["wiggly"] is not None and r["wiggly"]["good"] >= 15 and r["wiggly"]["km"] >= 2.0
    assert r["straight"] is None, "a straight road is never a stage"
    assert r["ring"] is None, "a road that curls back on itself is not a stage"
    assert r["plans"], "four stages around the start make at least one 40 km plan"
    for p in r["plans"]:
        assert abs(p["total"] - 40) / 40 <= 0.45
        assert p["wps"] <= 10, "the public Valhalla server takes at most 10 locations"


HL_RUNNER = r"""
globalThis.ApexCore = require(process.argv[1] + '/web/apex_core.js');
require(process.argv[1] + '/web/stages.js');
const S = globalThis.ApexStages;
const lat0 = 39.2, lon0 = -84.6, mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const stage = (name, x0, y0, score) => ({ name, score, km: 4,
  lat: Array.from({ length: 200 }, (_, i) => lat0 + (y0 + 0) * mLat), lon: Array.from({ length: 200 }, (_, i) => lon0 + (x0 + i * 10) * mLon) });
const mk = () => [stage('A', 0, 0, 10), stage('B', 0, 5000, 8.5)];
const at = (x, y, rating, name) => ({ name, rating, lat: lat0 + y * mLat, lon: lon0 + x * mLon });
const order = (st) => st.map(s => s.name).join('');
const out = {};
out.none = order(S.applyHighlights(mk(), [], 1));
out.five = order(S.applyHighlights(mk(), [at(1000, 5100, 5, 'Overlook')], 1));          // 100 m from B's road
out.far = order(S.applyHighlights(mk(), [at(1000, 5800, 5, 'Overlook')], 1));           // 800 m away: no pull
out.low = order(S.applyHighlights(mk(), [at(1000, 5100, 2, 'Meh')], 1));                // 2 stars: never pulls
out.off = order(S.applyHighlights(mk(), [at(1000, 5100, 5, 'Overlook')], 0));           // strength 0: off
const many = Array.from({ length: 20 }, (_, i) => at(100 + i * 50, 5050, 5, 'Stop' + i));
const capped = S.applyHighlights(mk(), many, 1); out.cappedBonus = capped.find(s => s.name === 'B').bonus;
const dull = [stage('A', 0, 0, 10), stage('Z', 0, 9000, 2)];
out.dull = order(S.applyHighlights(dull, [at(1000, 9050, 5, 'Overlook')], 1));          // a viewpoint cannot rescue a dull road
out.named = S.applyHighlights(mk(), [at(1000, 5100, 5, 'Overlook')], 1).find(s => s.name === 'B').highlights;
process.stdout.write(JSON.stringify(out));
"""


def test_highlights_tip_the_choice_between_good_roads_but_never_rescue_a_dull_one():
    res = subprocess.run([NODE, "-e", HL_RUNNER, os.path.abspath(".")], capture_output=True, text=True, check=True)
    r = json.loads(res.stdout)
    assert r["none"] == "AB"
    assert r["five"] == "BA", "a 5-star highlight beside B tips it over the slightly better A"
    assert r["far"] == "AB", "a highlight 800 m away has no pull"
    assert r["low"] == "AB", "a low-rated highlight never pulls (and never pushes away)"
    assert r["off"] == "AB", "strength 0 turns it off"
    assert r["cappedBonus"] <= 6, "many highlights cannot stack without limit"
    assert r["dull"] == "AZ", "a viewpoint cannot lift a dull road above a great one"
    assert r["named"] == ["Overlook"]
