"""Tune your routes (web/route_tuning.js; the owner 2026-11-09: "every parameter with a slider for premium users", and
"remember everyone has pro if they are an early user. Once we launch app store we will restrict to paid users and anyone
who had the beta"). Plain sliders build the Dev panel's tune ({ router, engine, levels, hwy }) and ride its plumbing:
graph_router.js withTune (plan, quickest, loop), route_engine.js setTune / rank opts.tune. Untouched sliders are no tune;
each slider moves its own knobs within bounds; Pro's gate (pro.js 'tuning') is open now, closed on sale without Pro.
The screen, the re-plan and the route card's note: e2e/smoke.js "route tuning"."""
import json
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")


def run(src, *args):
    r = subprocess.run([NODE, "-e", src, ROOT, *args], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def read(name):
    with open(os.path.join(WEB, name), encoding="utf-8") as fh:
        return fh.read()


LOAD = r"""
const root = process.argv[1];
const Core = require(root + '/web/apex_core.js'); globalThis.ApexCore = Core;
globalThis.ApexSun = require(root + '/web/sun.js');
const F = require(root + '/web/fun_route.js'); globalThis.ApexFunRoute = F;
require(root + '/web/route_ctx/registry.js');
const E = require(root + '/web/route_engine.js');
const R = require(root + '/web/graph_router.js');
const P = require(root + '/web/pro.js');
const T = require(root + '/web/route_tuning.js');
const mem = {}, store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const tables = () => ({ router: JSON.parse(JSON.stringify(R.K)), engine: JSON.parse(JSON.stringify(E.W)), levels: JSON.parse(JSON.stringify(F.LEVELS)), hwy: JSON.parse(JSON.stringify(F.HWY)) });
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
"""


def test_untouched_sliders_are_no_tune_and_their_defaults_are_the_codes():
    r = run(LOAD + r"""
const code = tables();
// every number a slider scales is the code's own (a retune of the code moves the slider's default with it, or fails here)
const base = Object.entries(T.BASE).flatMap(([t, m]) => Object.entries(m).map(([p, v]) => [t, p, v, get(code[t], p)])).filter(([, , v, c]) => v !== c);
// each slider at its default, set anyway: exactly the code's values (so "Standard" is today's routing to the last digit)
const atDef = T.SLIDERS.flatMap((s) => Object.entries(s.set(s.def, T.DEFAULTS)).flatMap(([t, m]) => Object.entries(m).map(([p, v]) => [s.id, t, p, v, get(code[t], p)]))).filter(([, , , v, c]) => v !== c);
const empty = T.load(store);
T.save(store, T.DEFAULTS);
process.stdout.write(JSON.stringify({ base, atDef, none: T.tune(T.DEFAULTS), noneEmpty: T.tune({}), noneNull: T.tune(null), empty, defaults: T.DEFAULTS, kept: Object.keys(mem),
  sliders: T.SLIDERS.map((s) => ({ id: s.id, group: s.group, label: s.label, hint: s.hint, min: s.min, max: s.max, step: s.step, def: s.def })) }));
""")
    assert r["base"] == [], r["base"]
    assert r["atDef"] == [], r["atDef"]
    assert r["none"] is None and r["noneEmpty"] is None and r["noneNull"] is None
    assert r["empty"] == r["defaults"] and r["kept"] == []                 # nothing stored until a slider moves
    for s in r["sliders"]:
        assert s["min"] <= s["def"] <= s["max"] and s["min"] < s["max"], s
        k = (s["def"] - s["min"]) / s["step"]
        assert abs(k - round(k)) < 1e-9, s                                  # the default is on a step
        assert s["hint"] and len(s["hint"]) <= 120 and "\n" not in s["hint"], s   # a one-line hint
        # named for drivers, never with constant names
        assert not re.search(r"[A-Z]{2,}_|_[A-Z]{2,}|\b(perMin|slackS|budget|W_|K\.)", s["label"] + " " + s["hint"]), s
    groups = {s["group"] for s in r["sliders"]}
    assert groups == {"time", "roads", "avoid", "data"}
    ids = {s["id"] for s in r["sliders"]}
    assert {"funTime", "maxTime", "quickStray", "hwyLimit", "corners", "quality", "scenery", "towns", "lights", "streets", "crowd"} <= ids


def test_each_slider_moves_its_own_knobs_within_bounds():
    r = run(LOAD + r"""
const out = {};
for (const s of T.SLIDERS) {
  const at = (v) => T.tune({ ...T.DEFAULTS, [s.id]: v });
  const lo = at(s.min), hi = at(s.max), flat = (t) => Object.entries(t || {}).flatMap(([tb, m]) => Object.entries(m).map(([p, v]) => [tb + ':' + p, v]));
  // every path is a real knob: tuneOnto (the Dev panel's) sets each one, on a copy of the code's tables
  const missing = [];
  for (const t of [lo, hi]) for (const [tb, m] of Object.entries(t || {})) { const copy = tables()[tb]; const undo = F.tuneOnto(copy, m); if (undo.length !== Object.keys(m).length) missing.push([tb, Object.keys(m)]); }
  const L = Object.fromEntries(flat(lo)), H = Object.fromEntries(flat(hi));
  out[s.id] = { lo: L, hi: H, missing, finite: [...Object.values(L), ...Object.values(H)].every((v) => Number.isFinite(v) && v >= 0),
    moved: Object.keys({ ...L, ...H }).some((k) => L[k] !== H[k]),
    clampLo: T.normalize({ [s.id]: s.min - 100 })[s.id] === s.min, clampHi: T.normalize({ [s.id]: s.max + 100 })[s.id] === s.max, junk: T.normalize({ [s.id]: 'x' })[s.id] === s.def };
}
const merged = T.merge(T.tune({ corners: 2 }), { router: { W_FUN: 0.1 }, engine: { POOR_PER_KM: 3 } });
process.stdout.write(JSON.stringify({ out, merged, mergeNone: T.merge(null, null), labels: T.labels({ corners: 2, lights: 2 }) }));
""")
    for k, s in r["out"].items():
        assert not s["missing"], (k, s["missing"])
        assert s["finite"] and s["moved"] and s["clampLo"] and s["clampHi"] and s["junk"], (k, s)
    o = r["out"]
    # each slider its own parameters, the way its words say
    assert o["funTime"]["lo"]["levels:fun.budget"] == 0.1 and o["funTime"]["hi"]["levels:fun.budget"] == 1.0
    assert o["funTime"]["hi"]["levels:fun.perMin"] < 1 < o["funTime"]["lo"]["levels:fun.perMin"]   # more time: each minute cheaper
    assert o["maxTime"]["hi"]["levels:max.budget"] == 2.0 and o["maxTime"]["hi"]["router:A_MAX.max"] > 80
    assert o["funEager"]["hi"]["router:BUY.fun"] < 0.12 < o["funEager"]["lo"]["router:BUY.fun"]
    assert o["quickStray"]["lo"] == {"levels:quick.slackS": 0} and o["quickStray"]["hi"] == {"levels:quick.slackS": 300}
    assert o["hwyLimit"]["hi"] == {"hwy:ABSURD": 4, "router:HWY_ABSURD": 4}
    assert o["corners"]["lo"]["router:W_FUN"] == 0 and o["corners"]["hi"]["engine:FUN"] == 2 and o["corners"]["hi"]["engine:GAIN"] == 1
    assert o["quality"]["hi"]["engine:QUALITY"] == 0.6 and o["quality"]["hi"]["router:ROAD.good"] == 3
    assert o["scenery"]["hi"]["engine:SCENERY"] == 40 and o["scenery"]["lo"]["router:W_SCENERY"] == 0
    assert o["towns"]["hi"]["engine:BUSINESS_PER_KM"] == 12
    assert o["lights"]["hi"] == {"router:STOP_AVOID_X": 4} and o["lights"]["lo"] == {"router:STOP_AVOID_X": 0.5}
    assert o["streets"]["hi"]["engine:POOR_PER_KM"] == 30 and o["streets"]["hi"]["router:ROAD.poor"] == 30
    assert o["crowd"]["hi"]["router:CROWD_W.loved"] == 4.5 and o["crowd"]["lo"]["router:CROWD_W.rough"] == 0
    assert o["driver"]["hi"] == {"engine:DRIVER": 18}
    # the highway rule itself is fixed (the owner): no slider reaches the no-highway switch
    assert not any("NO_HWY" in p or "noHighway" in p for s in o.values() for p in {**s["lo"], **s["hi"]})
    # a developer's numbers lay on top of the driver's sliders, path by path
    assert r["merged"]["router"]["W_FUN"] == 0.1 and r["merged"]["engine"]["FUN"] == 2 and r["merged"]["engine"]["POOR_PER_KM"] == 3
    assert r["mergeNone"] is None and r["labels"] == ["Corners", "Traffic lights and stops"]


def test_the_router_takes_the_tune_and_keeps_none_without_one():
    r = subprocess.run([NODE, os.path.join(ROOT, "tests", "graph_router_cases.js"), "routeTuning"], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    r = json.loads(r.stdout)
    assert r["base"] == ["Mill Road"] and r["neutral"] is None and r["same"] and r["back"] and r["kSame"], r
    # Fun's extra time up (and spent readily): the longer, better road, in a bigger budget
    assert r["far"][0] == "Ridge Road" and r["farLimitS"] > r["baseLimitS"], r
    # a tune reaches the search on a view whose objective was kept from an untuned plan (and leaves it untouched after)
    assert r["cacheSafe"] and r["offDiffers"], r
    # Traffic lights and stops: Quick keeps off the street of signals; its time is still the real one
    assert r["quick0"] == ["Main Street"] and r["quick4"] == ["Mill Road"] and abs(r["quick4S"] - r["millS"]) < 1e-6 and r["noSignals"], r


def test_the_engine_takes_the_tune():
    r = run(LOAD + r"""
const lat0 = 39.2, lon0 = -84.6, mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const ll = (pts) => pts.map(([x, y]) => [lon0 + x * mLon, lat0 + y * mLat]);
const straight = (len) => ll(Array.from({ length: len / 10 + 1 }, (_, i) => [i * 10, 0]));
const wiggly = (len) => ll(Array.from({ length: len / 5 + 1 }, (_, i) => [i * 5, 60 * Math.sin(2 * Math.PI * i * 5 / 400)]));
const DEPART = Date.parse('2026-11-04T12:00:00-05:00');
function cand(id, coords, timeS, q) {
  const c = { id, route: { coords, turns: [], times: [], names: new Map(), timeS }, timeS };
  c.t = F.geometry(coords, Core); c.turnsM = []; c.fun = F.score(c.t, []);
  c.corridor = E.corridorFor(c, id, { departAt: DEPART });
  const n = c.corridor.distM.length;
  c.ctx = { channels: { speed_limit_kph: Float32Array.from({ length: n }, () => q), road_class: Float32Array.from({ length: n }, () => 4) }, spans: [], points: [] };
  return c;
}
const pool = () => [cand('quick', straight(3000), 200, 72), cand('twisty', wiggly(3000), 330, 72)];
const rank = (o = {}) => E.rank(pool(), { level: 'fun', fresh: true, ...o });
const order = (o) => rank(o).map((c) => c.id), vals = (o) => rank(o).map((c) => +c.value.toFixed(9));
const W0 = JSON.stringify(E.W);
const out = { base: order(), neutral: JSON.stringify(vals({ tune: T.tune(T.DEFAULTS) })) === JSON.stringify(vals()),
  noCorners: order({ tune: T.tune({ corners: 0 }) }), lessTime: order({ tune: T.tune({ funTime: 10 }) }) };
// the app's way: set once on the page, every ranking after uses it, null puts the code's back
E.setTune(T.tune({ corners: 0 }));
out.set = order();
E.setTune(null);
out.restored = JSON.stringify(E.W) === W0 && JSON.stringify(vals()) === JSON.stringify(vals());
process.stdout.write(JSON.stringify(out));
""")
    assert r["base"] == ["twisty", "quick"] and r["neutral"], r
    assert r["noCorners"] == ["quick", "twisty"] and r["set"] == ["quick", "twisty"], r   # corners count nothing: time decides
    assert r["lessTime"][0] == "quick", r                                  # Fun at 10 %: the twisty way is past its budget
    assert r["restored"], r


def test_pro_gate_open_now_closed_on_sale_without_pro_open_with_it():
    r = run(LOAD + r"""
T.save(store, { corners: 1.5 });
const now = T.active(store, {}, P), onSaleNoPro = T.active(store, { pro: true, proOnSale: true }, P);
mem[P.ENT_KEY] = JSON.stringify({ verified: true });                    // a verified entitlement (lifetime: no expiry)
const withPro = T.active(store, { pro: true, proOnSale: true }, P);
const kept = T.load(store).corners;
process.stdout.write(JSON.stringify({ now, onSaleNoPro, withPro, kept, allowedNow: T.allowed(store, {}, P), allowedSale: T.allowed(store, { pro: true, proOnSale: true }, P) }));
""")
    assert r["now"] == {"router": {"W_FUN": 0.675}, "engine": {"FUN": 1.5, "GAIN": 0.75}}, r   # early access: everyone
    assert r["onSaleNoPro"] is None, r                                     # on sale, no Pro: the defaults
    assert r["withPro"] == r["now"] and r["kept"] == 1.5, r                # with Pro (beta and early users: lifetime)


def test_the_page_wiring():
    js, html = read("cockpit.js"), read("index.html")
    assert '<script src="route_tuning.js" defer></script>' in html
    assert re.search(r'<section data-panel="garage" data-setting="tuning" data-title="Route tuning">\s*<div id="garageTuneBody"', html)
    assert 'id="cardTuneChip"' in html
    gs = read("garage_settings.js")
    assert "'tuning'" in gs
    # the plan's tune is the driver's with a developer's on top, through the Dev panel's plumbing
    assert "const devTune = () => (window.ApexRouteTuning ? ApexRouteTuning.merge(userTune(), devOnlyTune()) : devOnlyTune());" in js
    assert "ApexRouteTuning.active(localStorage, tuningFlags())" in js
    # loops get it too; the card says a route was planned with it
    assert "avoid, ...devTuneReq() }) : Promise.resolve([]);" in js
    assert "tuned: o.tuned || null" in js and "lv.tuned = tunedNow;" in js
    src = read("route_tuning.js")
    assert "Best roads nearby are not changed" in src                       # the screen says what it affects
