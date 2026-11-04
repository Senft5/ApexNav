"""The route-context registry (web/route_ctx/registry.js): corridors, the one-budget concurrent run, merging, statuses."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const root = process.argv[1];
const C = require(root + '/web/route_ctx/registry.js');
const out = {};
// a 1 km line due east at 39 N, the router's clock: 0 s at the start, 60 s at 500 m, 100 s at the end
const lat0 = 39, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const coords = Array.from({ length: 11 }, (_, i) => [-84.5 + i * 100 * mLon, lat0]);
const c = C.corridor('a', coords, { timeS: 100, marks: [[0, 0], [500, 60], [1000, 100]], departAt: 0 });
out.n = c.distM.length; out.last = c.distM[c.distM.length - 1]; out.step = c.distM[1];
out.heading = c.heading[5]; out.eta = [c.etaAt[0], c.etaAt[20], c.etaAt[40]];
const slow = C.corridor('b', coords, { timeS: 100, departAt: 0, pace: 1.5 });
out.paced = slow.etaAt[40];
const none = C.corridor('c', coords, { departAt: 0 });
out.fiftyKmh = Math.round(none.etaAt[none.etaAt.length - 1]);
out.bbox = c.bbox.map((v) => +v.toFixed(5));
out.spans = Array.from(C.fillSpans(c, [{ fromM: 100, toM: 150, value: 7 }])).slice(0, 8).map((v) => (Number.isNaN(v) ? null : v));
(async () => {
  // three providers: a quick one, one past the budget, one that throws; and two giving the same channel
  C.register({ id: 'fast', priority: 5, channels: ['x'], fetch: async (cs) => Object.fromEntries(cs.map((k) => [k.id, { status: 'ok', channels: { x: Float32Array.from(k.distM, (m) => (m < 500 ? 1 : NaN)) }, points: [{ atM: 100, kind: 'signal' }] }])) });
  C.register({ id: 'fill', priority: 9, channels: ['x'], fetch: async (cs) => Object.fromEntries(cs.map((k) => [k.id, { status: 'partial', channels: { x: Float32Array.from(k.distM, () => 2), bad: [1, 2] } }])) });
  C.register({ id: 'slow', priority: 7, channels: ['y'], budgetMs: 5000, fetch: (cs, o) => new Promise((resolve) => { const t = setTimeout(() => resolve({}), 4000); o.signal.addEventListener('abort', () => { clearTimeout(t); out.slowAborted = true; }); }) });
  C.register({ id: 'boom', channels: ['z'], fetch: async () => { throw new Error('kaput'); } });
  C.register({ id: 'keyed', channels: ['k'], needs: { network: true, key: 'ohgoKey' }, fetch: async () => { out.keyedRan = true; return {}; } });
  const updates = [];
  const t0 = Date.now();
  const r = await C.run([c], { budgetMs: 300, onUpdate: (x) => updates.push(Object.keys(x.status).filter((k) => x.status[k].status !== 'pending').length) });
  out.ms = Date.now() - t0;
  out.status = Object.fromEntries(Object.entries(r.status).map(([k, v]) => [k, v.status]));
  const x = r.byId.a.channels.x;
  out.merged = [x[0], x[30]];
  out.from = r.byId.a.from.x;
  out.badDropped = !('bad' in r.byId.a.channels);
  out.points = r.byId.a.points.map((p) => [p.kind, p.source]);
  out.updates = updates.length;
  out.complete = r.complete;
  // an aborted caller: everything stops at once
  const ac = new AbortController(); ac.abort();
  const t1 = Date.now();
  await C.run([c], { budgetMs: 3000, signal: ac.signal, only: ['slow'] });
  out.abortMs = Date.now() - t1;
  out.empty = Object.keys((await C.run([], {})).byId).length;
  const k = C.cache(50); k.set('a', 1); out.cacheHit = k.get('a'); await new Promise((r) => setTimeout(r, 80)); out.cacheExpired = k.get('a') === undefined;
  out.keySame = C.keyOf(coords) === C.keyOf(coords.map((p) => p.slice())); out.keyDiff = C.keyOf(coords) !== C.keyOf(coords.slice(1));
  process.stdout.write(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def r():
    res = subprocess.run([NODE, "-e", RUNNER, os.path.abspath(".")], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_corridor_is_25_m_samples_with_heading_and_the_routers_clock(r):
    assert r["n"] == 41 and r["step"] == 25 and abs(r["last"] - 1000) < 2
    assert abs(r["heading"] - 1.5708) < 0.01, "due east is pi/2 (0 north, clockwise)"
    assert r["eta"][0] == 0 and abs(r["eta"][1] - 60000) < 300 and abs(r["eta"][2] - 100000) < 300
    assert abs(r["paced"] - 150000) < 500, "a driver at 1.5x the router's time gets there 1.5x later"
    assert abs(r["fiftyKmh"] - 72000) < 800, "no router time: 50 km/h"
    assert r["spans"][:4] == [None, None, None, None] and r["spans"][4:7] == [7, 7, 7] and r["spans"][7] is None


def test_one_budget_merge_and_statuses(r):
    assert r["ms"] < 800, "the run ends at the budget, never waits for a slow provider"
    assert r["slowAborted"], "a provider still working at the deadline is aborted"
    assert r["status"] == {"fast": "ok", "fill": "partial", "slow": "unavailable", "boom": "unavailable", "keyed": "no-key"}
    assert "keyedRan" not in r, "a provider whose key isn't set never runs"
    assert r["merged"] == [1, 2], "the better (lower priority) source wins where it knows; the other fills its gaps"
    assert r["from"] == ["fast", "fill"] and r["badDropped"], "a channel of the wrong length is never trusted"
    assert r["points"] == [["signal", "fast"]]
    assert r["updates"] >= 2 and r["complete"]
    assert r["abortMs"] < 300 and r["empty"] == 0


def test_cache_and_keys(r):
    assert r["cacheHit"] == 1 and r["cacheExpired"]
    assert r["keySame"] and r["keyDiff"]


ORDER = r"""
const root = process.argv[1], first = process.argv[2];
const shim = () => { globalThis.ApexRouteCtx = globalThis.ApexRouteCtx || { providers: [], register(p) { this.providers.push(p); return p; } }; return globalThis.ApexRouteCtx; };
const p = (id) => ({ id, channels: ['x'], fetch: async () => ({}) });
let held;
if (first === 'shim') { held = shim(); held.register(p('early')); globalThis.ApexRouteCtx.pending = [p('queuedEarly')]; }
const C = require(root + '/web/route_ctx/registry.js');
if (first !== 'shim') { held = shim(); }
held.register(p('late'));                       // a provider that kept the shim (or the registry) reference
globalThis.ApexRouteCtx.register(p('global'));
held.providers.push(p('pushed'));               // pushed straight onto the array
(held.pending || (held.pending = [])).push(p('queued'));   // builder E's shim queues on `pending`
process.stdout.write(JSON.stringify({ ids: C.list().map((x) => x.id).sort(), same: globalThis.ApexRouteCtx === C, run: typeof held.run }));
"""


@pytest.mark.parametrize("first", ["shim", "registry"])
def test_registry_adopts_a_shim_in_either_order(first):
    """Providers built to the contract may load before registry.js and register on a shim (web/route_ctx/osm_common.js)."""
    res = subprocess.run([NODE, "-e", ORDER, os.path.abspath("."), first], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    r = json.loads(res.stdout)
    want = ["global", "late", "pushed", "queued"] + (["early", "queuedEarly"] if first == "shim" else [])
    assert r["ids"] == sorted(want), r
    assert r["same"] and r["run"] == "function"


REAL = r"""
const root = process.argv[1], first = process.argv[2];
globalThis.ApexCore = require(root + '/web/apex_core.js');
const E = ['ctx_util', 'crowd', 'driver', 'car', 'ios_context', 'crew_meet'], B = ['osm_common', 'osm_tiles', 'osm_overpass', 'road_name_age'];
const load = (names) => { for (const n of names) require(root + '/web/route_ctx/' + n + '.js'); };
if (first === 'providers') { load(E); load(B); }
const C = require(root + '/web/route_ctx/registry.js');
require(root + '/web/route_ctx/router_edges.js'); require(root + '/web/route_ctx/dem.js');
if (first !== 'providers') { load(E); load(B); }
process.stdout.write(JSON.stringify(globalThis.ApexRouteCtx.list().map((p) => p.id).sort()));
"""


@pytest.mark.parametrize("first", ["providers", "registry"])
def test_builder_b_and_e_providers_register_in_either_order(first):
    res = subprocess.run([NODE, "-e", REAL, os.path.abspath("."), first], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    assert json.loads(res.stdout) == sorted(["router", "dem", "osm_tiles", "osm_overpass", "road_name_age", "crowd", "driver", "car", "ios_context", "crew_meet"])


ALL_IDS = sorted(["router", "dem", "osm_tiles", "osm_overpass", "road_name_age", "crowd", "driver", "car", "ios_context", "crew_meet",
                  "conditions", "wildlife", "events", "hazards-live", "photos", "context_grid"])
RANDOM = r"""
const root = process.argv[1], seed = +process.argv[2];
globalThis.ApexCore = require(root + '/web/apex_core.js');
globalThis.ApexSun = require(root + '/web/sun.js');
const files = ['registry', 'router_edges', 'dem', 'osm_common', 'osm_tiles', 'osm_overpass', 'road_name_age', 'ctx_util', 'crowd', 'driver', 'car',
  'ios_context', 'crew_meet', 'conditions', 'wildlife', 'events', 'hazards_live', 'photos', 'context_grid'];
let x = seed;
const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
for (let i = files.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [files[i], files[j]] = [files[j], files[i]]; }
for (const f of files) require(root + '/web/route_ctx/' + f + '.js');
process.stdout.write(JSON.stringify({ order: files, ids: globalThis.ApexRouteCtx.list().map((p) => p.id).sort() }));
"""


@pytest.mark.parametrize("seed", [1, 7, 42, 99, 123, 2024, 31337, 65535])
def test_every_provider_registers_in_any_load_order(seed):
    """Builders B, C, D and E each queue on a shim when the registry isn't there yet; whatever the order, all are adopted."""
    res = subprocess.run([NODE, "-e", RANDOM, os.path.abspath("."), str(seed)], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    r = json.loads(res.stdout)
    assert r["ids"] == ALL_IDS, (r["order"], set(ALL_IDS) ^ set(r["ids"]))
