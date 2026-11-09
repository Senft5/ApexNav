"""Dev mode (the owner, 2026-11-09: "a dev mode in the app that shows all routing parameters and other debug info for only
me and my codev to mess with"). The overrides' plumbing: web/fun_route.js tuneOnto, graph_router.js withTune (req.tune
on plan and quickest, also through the worker's host) and route_engine.js setTune / rank opts.tune. With no tune nothing
changes (the rest of the suite runs unchanged on these files); a tune changes the pick for its plan only and puts every
default back. The gate and the panel: e2e/smoke.js "dev mode" flows; the page wiring: below."""
import json
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not installed")


def run(src):
    r = subprocess.run([NODE, "-e", src, ROOT], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def read(name):
    with open(os.path.join(WEB, name), encoding="utf-8") as fh:
        return fh.read()


@needs_node
def test_router_tune_changes_the_pick_and_nothing_without_one():
    r = subprocess.run([NODE, os.path.join(ROOT, "tests", "graph_router_cases.js"), "tune"], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    r = json.loads(r.stdout)
    assert r["base"] == ["Mill Road"], r                                  # Fun's pick as test_each_level_spends_its_budget… has it
    assert r["same"] == [True, True, True, True], r                       # null, {}, empty maps, no real knob: the same plan exactly
    assert r["strict"] == ["Main Street"] and r["strictRole"] == "quickest", r   # BUY_MIN 50: no extra time buys enough
    assert r["far"][0] == "Ridge Road" and r["farLimitS"] > r["baseLimitS"], r    # Long way's budget and price at Fun
    assert r["after"] and r["kSame"] and r["levelsSame"] and not r["polluted"], r  # every default back, no prototype touched
    assert r["quickSame"], r
    assert (r["hostBase"], r["hostStrict"], r["hostAfter"]) == (["Mill Road"], ["Main Street"], ["Mill Road"]), r


ENGINE = r"""
const root = process.argv[1];
const Core = require(root + '/web/apex_core.js'); globalThis.ApexCore = Core;
globalThis.ApexSun = require(root + '/web/sun.js');
const F = require(root + '/web/fun_route.js'); globalThis.ApexFunRoute = F;
require(root + '/web/route_ctx/registry.js');
const E = require(root + '/web/route_engine.js');
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
const order = (o = {}) => E.rank(pool(), { level: 'fun', fresh: true, ...o }).map((c) => c.id);
const W0 = JSON.stringify(E.W), L0 = JSON.stringify(F.LEVELS), H0 = JSON.stringify(F.HWY);
const base = order();
const same = [null, {}, { engine: {} }, { engine: { NOPE: 1, QUALITY: 'x', '__proto__.p': 2 }, levels: { 'fun.label': 3 } }].map((t) => JSON.stringify(order({ tune: t })) === JSON.stringify(base));
const values = (o = {}) => E.rank(pool(), { level: 'fun', fresh: true, ...o }).map((c) => +c.value.toFixed(6));
const v0 = values();
const opt = order({ tune: { levels: { 'fun.perMin': 80 } } });
const between = { w: JSON.stringify(E.W) === W0, l: JSON.stringify(F.LEVELS) === L0 };
// the app's way: set once (applyDevFlags / the panel's Re-plan), every ranking after uses it, null puts the code's back
const n = E.setTune({ levels: { 'fun.perMin': 80 }, engine: { POOR_PER_KM: 12 }, hwy: { ABSURD: 3 } });
const set = { n, order: order(), perMin: F.LEVELS.fun.perMin, poor: E.W.POOR_PER_KM, absurd: F.HWY.ABSURD };
const reset = E.setTune(null);
const restored = JSON.stringify(E.W) === W0 && JSON.stringify(F.LEVELS) === L0 && JSON.stringify(F.HWY) === H0;
const defaults = E.tuneDefaults();
process.stdout.write(JSON.stringify({ base, same, opt, between, set, reset, restored, valuesSame: JSON.stringify(values()) === JSON.stringify(v0),
  defaults: { poor: defaults.engine.POOR_PER_KM, budget: defaults.levels['fun.budget'], absurd: defaults.hwy.ABSURD, n: Object.keys(defaults.engine).length } }));
"""


@needs_node
def test_engine_tune_changes_the_ranking_and_reset_restores_the_code():
    r = run(ENGINE)
    assert r["base"] == ["twisty", "quick"], r                           # the corners are worth 2 min at Fun
    assert r["same"] == [True, True, True, True], r
    assert r["opt"] == ["quick", "twisty"], r                            # 80 points a minute: the quickest wins
    assert r["between"] == {"w": True, "l": True}, r                    # a per-call tune is put back
    s = r["set"]
    assert s["n"] == 3 and s["order"] == ["quick", "twisty"] and (s["perMin"], s["poor"], s["absurd"]) == (80, 12, 3), s
    assert r["reset"] == 0 and r["restored"] and r["valuesSame"], r
    assert r["defaults"] == {"poor": 10, "budget": 0.35, "absurd": 2, "n": r["defaults"]["n"]} and r["defaults"]["n"] > 20, r


def test_dev_mode_is_gated_on_the_servers_developer_flag_and_lazy():
    js = read("cockpit.js")
    # the gate is the satellite layer's (applyDevFlags: a fresh /api/me with developer true); storage alone never opens it
    assert re.search(r"function devSettings\(\) \{\s*if \(!devAccess\) return null;", js)
    # the planner reads it through window.apexDebug.dev, whose every answer comes from devSettings / devAccess
    assert "window.apexDebug.dev = Object.freeze({ allowed: () => devAccess, on: devOn, settings: devSettings, tune: devTune, tuneReq: devTuneReq," in js
    assert "const ownOn = () => { const d = window.apexDebug && window.apexDebug.dev ? window.apexDebug.dev.settings() : null;" in js
    # the overrides go to the worker only when set, from a developer's phone
    assert js.count("...(dev ? dev.tuneReq() : {})") == 2 and "function devTuneReq() { const t = devTune(); return t ? { tune: t } : {}; }" in js
    assert "ApexRouteEngine.setTune(devTune())" in js
    # the panel's code is never on the launch path: lazy.js 'dev', loaded only for a developer
    lazy = read("lazy.js")
    assert "dev: ['dev_panel.js']" in lazy
    assert 'src="dev_panel.js"' not in read("index.html")
    assert "ApexLazy.load('dev')" in js and js.count("ApexLazy.load('dev')") == 1
    i = js.index("ApexLazy.load('dev')")
    assert "devAccess" in js[js.rfind("function", 0, i):i]
    # its row in the Garage's settings is empty (hidden) until a developer is known
    html = read("index.html")
    assert re.search(r'<section data-panel="garage" data-setting="dev" data-title="Developer" data-empty-hides>\s*<div id="garageDevBody"[^>]*data-fill></div>', html)


def test_dev_panel_lists_the_requested_knobs():
    src = read("dev_panel.js")
    for k in ("A_MAX.fun", "A_FIRST.fun", "BUY.fun", "BUY.max", "BUY_MIN", "SPREAD.fun.0", "ROAD.poor", "ROAD.good", "ROAD.w", "HWY_ABSURD",
              "POOR_PER_KM", "GOOD_PER_KM", "BUSINESS_PER_KM", "fun.budget", "max.budget", "fun.perMin"):
        assert f"'{k}'" in src, k
    for what in ("Re-plan", "Reset", "Copy debug JSON", "Force own router", "Force Valhalla", "Offline simulation", "Candidate lines"):
        assert what in src, what
