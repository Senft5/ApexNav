"""Destination picks (2026-11-04, the owner's work-to-home trip): corners between houses don't buy a detour, Flow and Dull
obey the corner gate, a pick that looks worse on the card's own numbers says why, and a Fun pick that is the quickest
says the trip has no road worth more time. Synthetic roads at public coordinates; the live captures that reproduce
the case pass close to the owner's addresses, so they stay out of the repo (CALL_SHEET)."""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = Path(__file__).resolve().parents[1]

RUNNER = r"""
const root = process.argv[1];
const Core = require(root + '/web/apex_core.js'); globalThis.ApexCore = Core;
globalThis.ApexSun = require(root + '/web/sun.js');
const F = require(root + '/web/fun_route.js'); globalThis.ApexFunRoute = F;
require(root + '/web/route_ctx/registry.js');
const E = require(root + '/web/route_engine.js');
const R = require(root + '/web/graph_router.js');
const lat0 = 39.2, lon0 = -84.6, mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const ll = (pts) => pts.map(([x, y]) => [lon0 + x * mLon, lat0 + y * mLat]);
const straight = (len) => ll(Array.from({ length: len / 10 + 1 }, (_, i) => [i * 10, 0]));
const wiggly = (len) => ll(Array.from({ length: len / 5 + 1 }, (_, i) => [i * 5, 60 * Math.sin(2 * Math.PI * i * 5 / 400)]));
const DEPART = Date.parse('2026-11-04T12:00:00-05:00');
let seq = 0;
function cand(coords, timeS, chans = {}, extra = {}) {
  const route = { coords, turns: [], times: [], names: new Map(), timeS };
  const c = { id: 'c' + (seq++), route, timeS, ...(extra.c || {}) };
  c.t = F.geometry(coords, Core); c.turnsM = []; c.fun = F.score(c.t, []);
  c.corridor = E.corridorFor(c, c.id, { departAt: DEPART });
  const n = c.corridor.distM.length, ch = {};
  for (const [k, v] of Object.entries(chans)) ch[k] = Float32Array.from({ length: n }, (_, i) => (typeof v === 'function' ? v(i, c.corridor.distM[i]) : v));
  c.ctx = { channels: ch, spans: [], points: [] };
  return c;
}
const rank = (cs, o = {}) => E.rank(cs, { level: 'fun', ...o, fresh: true });
const out = {};
// an open back road, the same road lined with houses (a house every 20 m, a driveway every 80 m: quality still ~0.6,
// as the tiles score such a road), and a highway
const back = { speed_limit_kph: 72, road_class: 4, road_use: 0, density: 2, signals_per_km: 0, access_per_km: 8, surface: 0, sidewalk: 0, bldg_per_km: 8, addr_per_km: 4 };
const lined = { ...back, density: 4, access_per_km: 12, bldg_per_km: 60, addr_per_km: 45 };
const hwy = { speed_limit_kph: 105, road_class: 0, road_use: 0, density: 4, signals_per_km: 0, access_per_km: 0, surface: 0, lanes: 2 };
{
  const a = cand(wiggly(8000), 900, back), b = cand(wiggly(8000), 900, lined);
  E.evaluate(a, {}); E.evaluate(b, {});
  out.lined = { qBack: a.ev.quality, qLined: b.ev.quality, goodBack: a.ev.funGated.good, goodLined: b.ev.funGated.good, funBack: a.ev.funGated.fun, funLined: b.ev.funGated.fun,
    builtKmBack: +a.ev.builtKm.toFixed(2), builtKmLined: +b.ev.builtKm.toFixed(2), km: +a.ev.km.toFixed(2) };
  // +3 min: the open back road is worth it at Fun and Long way, the lined one isn't
  const pick = (ch, lv) => { const h = cand(straight(10000), 600, hwy), w = cand(wiggly(9000), 780, ch); return rank([h, w], { level: lv })[0].id === w.id; };
  out.detour = { back: ['quick', 'fun', 'max'].map((lv) => pick(back, lv)), lined: ['quick', 'fun', 'max'].map((lv) => pick(lined, lv)) };
  out.keep = [E.builtKeep(null), E.builtKeep(0.3), E.builtKeep(E.W.BUILT_LO), E.builtKeep(0.6), E.builtKeep(E.W.BUILT_HI), E.builtKeep(1)];
  out.agree = [F.builtAgree([0.95]), F.builtAgree([0.95, 0.2, 0]), F.builtAgree([0.95, 0.6, NaN]), F.builtAgree([NaN, 0.5])];
  // the router reads the tiles' road channels as the engine reads the same channels: the same agreeing evidence
  const chans = { density: [2, 4.3, 8, 3], sidewalk: [0, 0, 1, NaN], business_per_km: [0, 0, 12, 0], bldg_per_km: [46, 47, 56, 13], addr_per_km: [21, 30, 33, 5] };
  const cls = [4, 4, 6, 6];
  const v = { roadCh: Object.fromEntries(Object.entries(chans).map(([k, a]) => [k, Float32Array.from(a)])), cls: Uint8Array.from(cls) };
  const at = R.builtAgreeOf(v);
  out.routerAgree = cls.map((_, e) => +at(e).toFixed(4));
  out.engineAgree = cls.map((_, e) => { const ctx = { channels: { ...Object.fromEntries(Object.entries(chans).map(([k, a]) => [k, Float32Array.of(a[e])])), road_class: Float32Array.of(cls[e]) } }; return +E.builtEvidence(ctx, true)(0).toFixed(4); });
}
// Flow and Dull obey the gate: a wiggle the gate counts at 5 % adds almost nothing, where it used to keep half the score
{
  const t = F.geometry(wiggly(6000), Core);
  const full = F.score(t, [], null, () => 1), low = F.score(t, [], null, () => 0.05), none = F.score(t, []);
  out.gatedScore = { full: full.fun, low: low.fun, lowFlow: low.flow, ungated: none.fun };
}
// a pick that looks worse on the card (slower, fewer corners) than another option: the card says why
{
  const shown = (timeS, corners) => ({ timeS, t: { events: Array.from({ length: corners }, () => ({ type: 'corner' })) } });
  out.dominates = [F.dominates(shown(2040, 30), shown(2100, 28)), F.dominates(shown(2040, 28), shown(2100, 28)), F.dominates(shown(2100, 30), shown(2040, 28)),
    F.dominates(shown(2010, 28), shown(2100, 28)), F.dominates(shown(2040, 28), shown(2040, 28))];
  // two routes to the same place: the pick into a low sun for 1.6 minutes, the other for 8 (the owner's case, Long way)
  const a = cand(wiggly(9000), 2100, back, { c: { glare: { minutes: 1.6 } } }), b = cand(wiggly(9000).concat(ll([[9000, 0], [9005, 0]])), 2040, back, { c: { glare: { minutes: 8 } } });
  const r = rank([a, b], { level: 'max' });
  const best = r[0], other = r[1];
  out.over = { bestIsSlower: best.timeS > other.timeS, text: E.whyOver(best, other) && E.whyOver(best, other).text, none: E.whyOver(best, best) };
  // the other's extra corners are on a street lined with houses
  const p = cand(wiggly(6000), 700, back), q = cand(wiggly(6000).concat(wiggly(1500).map(([x, y]) => [x + 6000 * mLon, y])), 690, { ...back, bldg_per_km: (i, m) => (m > 6000 ? 80 : 8), addr_per_km: (i, m) => (m > 6000 ? 60 : 4) });
  const r2 = rank([p, q], { level: 'fun' });
  out.overCorners = { order: r2.map((c) => c.id === p.id ? 'p' : 'q'), text: r2[0].id === p.id ? (E.whyOver(r2[0], r2[1]) || {}).text : null };
}
// a Fun pick that is the quickest: the trip has no road worth more time, said plainly
{
  const h = cand(straight(10000), 600, hwy), s = cand(wiggly(9000), 780, { ...lined, density: 9, access_per_km: 30, bldg_per_km: 90 });
  const r = rank([h, s], { level: 'fun' });
  out.quickest = { pick: r[0].id === h.id, fun: E.whyQuickest(r[0], r.find((c) => c.id === h.id), 'fun'), quick: E.whyQuickest(r[0], r[0], 'quick'),
    other: E.whyQuickest(r[1], r[0], 'fun') };
  const b = cand(wiggly(9000), 600, back);
  out.quickestGood = E.whyQuickest(b, b, 'max');
}
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    res = subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, timeout=120, env={**os.environ, "TZ": "America/New_York"})
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_corners_between_houses_count_less(r):
    x = r["lined"]
    assert x["qLined"] >= 55, "the lined street still scores as decent road (the case: the tiles' 0.6)"
    assert x["goodBack"] >= 15 and x["goodLined"] <= 0.4 * x["goodBack"], x
    assert x["funLined"] < 0.5 * x["funBack"], x
    assert x["builtKmBack"] == 0 and x["builtKmLined"] >= 0.95 * x["km"], x


def test_a_detour_buys_open_road_not_a_street_of_houses(r):
    assert r["detour"]["back"] == [False, True, True], "+3 min for an open back road: Fun and Long way take it"
    assert r["detour"]["lined"] == [False, False, False], "the same corners between houses: never worth 3 minutes"


def test_built_cut_shape_and_router_parity(r):
    k = r["keep"]
    assert k[0] == k[1] == k[2] == 1, "open country or unknown: the corner keeps its weight"
    assert 1 > k[3] > k[4] and k[4] == k[5] == 0, "a street lined with houses: its corners count nothing"
    assert r["agree"] == [None, 0.2, 0.6, None], "two signals must agree: one map layer's outbuildings aren't a town"
    assert r["routerAgree"] == r["engineAgree"], (r["routerAgree"], r["engineAgree"])
    assert r["routerAgree"][0] < 0.45 and r["routerAgree"][2] == 1, "a rural road with barns vs a street of houses"


def test_flow_and_dull_obey_the_gate(r):
    g = r["gatedScore"]
    assert g["full"] == g["ungated"], "a full gate is the map-only score"
    assert g["lowFlow"] <= 10 and g["low"] <= 0.1 * g["full"], g


def test_dominance_on_the_cards_numbers(r):
    assert r["dominates"] == [True, True, False, True, False], r["dominates"]


def test_a_pick_that_looks_worse_says_why(r):
    o = r["over"]
    assert o["bestIsSlower"], "the route with less low sun wins though slower"
    assert o["text"] and o["text"].startswith("Over the 34 min route:") and "less low sun" in o["text"], o["text"]
    assert o["none"] is None
    c = r["overCorners"]
    assert c["order"][0] == "p", c
    assert c["text"] and "extra corners are on side streets or between houses" in c["text"], c


def test_no_great_roads_said_plainly(r):
    q = r["quickest"]
    assert q["pick"], "Fun keeps the highway over a street of houses"
    assert q["fun"]["text"] == "No great roads on this trip: Quick is the way"
    assert q["quick"] is None and q["other"] is None
    assert r["quickestGood"]["text"] == "The quickest way is the best road here too"


def test_the_card_glue():
    """cockpit.js optionOnto: the pick's why line carries the over-line when another option on the card dominates it, and
    the no-great-roads line when a Fun or Long way pick is the quickest; ownRefine names a route the wider search found."""
    src = (ROOT / "web" / "cockpit.js").read_text()
    body = src[src.index("function optionOnto(t, c, o)"):][:3200]
    assert "x.t !== c.t && FunRoute.dominates(x, c)" in body and "ApexRouteEngine.whyOver(c, rival)" in body, body
    assert "o.picks && o.picks[o.level]" in body, "the level cards: your level's pick is the one that explains itself"
    assert "ApexRouteEngine.whyQuickest(c, o.quickest, o.level)" in body
    assert re.search(r"why: \[\(engineWhy && engineWhy\.text\) \|\| \(quickLine && quickLine\.text\)", body)
    assert "added.has(best.t) ? 'Found a better way'" in src

