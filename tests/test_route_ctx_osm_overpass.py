"""Route context from OpenStreetMap via Overpass (web/route_ctx/osm_overpass.js): signals, stops that apply, crossings,
calming, signs, guard rails, limits, lanes, divided roads, access, routes and byways, fuel, side roads and driveways at
shared nodes. REAL Overpass answers (2026-11-03) to the provider's own query for three Cincinnati-area routes
(tests/fixtures/route_ctx/*.json `overpass`, cut by tools/route_ctx_fixtures.js), plus small synthetic cases for the
rules. One query per plan, kept per tile a week, never blocks; unknown stays NaN."""
import json
import re
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1], fs = require('fs');
const O = require(R + '/web/route_ctx/osm_overpass.js');
const { corridor } = require(R + '/tools/route_ctx_fixtures.js');
const FX = R + '/tests/fixtures/route_ctx/';
const mean = (a) => { let s = 0, k = 0; for (const v of a) if (Number.isFinite(v)) { s += v; k++; } return k ? s / k : null; };
const nan = (a) => { let k = 0; for (const v of a) if (!Number.isFinite(v)) k++; return k; };
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
  key: (i) => [...m.keys()][i], get length() { return m.size; }, _m: m }; };
const kinds = (pts) => { const o = {}; for (const p of pts) o[p.kind] = (o[p.kind] || 0) + 1; return o; };
(async () => {
  const out = { routes: {} };
  for (const name of ['dry_ridge', 'colerain', 'indian_creek']) {
    const fx = JSON.parse(fs.readFileSync(FX + name + '.json', 'utf8'));
    const c = corridor(fx.route); c.id = name;
    const r = O.aggregate(c, O.parse(fx.overpass), new Uint8Array(c.lat.length).fill(1));
    out.routes[name] = { n: c.lat.length, status: r.status, mean: Object.fromEntries(Object.entries(r.channels).map(([k, v]) => [k, mean(v)])),
      nan: Object.fromEntries(Object.entries(r.channels).map(([k, v]) => [k, nan(v)])), kinds: kinds(r.points), points: r.points, spans: r.spans };
  }
  // the plan path: one query, kept; the second plan reads the cache; after a week it asks again
  const fx = JSON.parse(fs.readFileSync(FX + 'dry_ridge.json', 'utf8'));
  const c = corridor(fx.route); c.id = 'dr';
  const store = mem(), bodies = [];
  const answer = (url, o) => { bodies.push(decodeURIComponent(String(o.body).slice(5))); return Promise.resolve({ ok: true, json: async () => fx.overpass }); };
  const first = await O.provider.fetch([c], { fetchFn: answer, storage: store, now: 1000 });
  const again = await O.provider.fetch([c], { fetchFn: () => { throw new Error('not again'); }, storage: store, now: 2000 });
  O._reset();
  const stale = await O.provider.fetch([c], { fetchFn: () => Promise.resolve({ ok: false, status: 504 }), storage: store, now: 1000 + 8 * 864e5 });
  out.cache = { firstStatus: first.dr.status, againStatus: again.dr.status, queries: new Set(bodies).size, raced: bodies.length, servers: O.SERVERS.length,
    same: JSON.stringify([...first.dr.channels.side_roads_per_km]) === JSON.stringify([...again.dr.channels.side_roads_per_km]),
    staleStatus: stale.dr.status, staleAllNaN: Object.values(stale.dr.channels).every((a) => nan(a) === a.length),
    keys: [...store._m.keys()].length, bytes: [...store._m.values()].reduce((s, v) => s + v.length, 0), q: bodies[0] || '' };
  // a reversed copy of the route reuses the kept stretch (no second query)
  const rev = { id: 'rev', lat: Float64Array.from(c.lat).reverse(), lon: Float64Array.from(c.lon).reverse(), distM: c.distM };
  let asked = 0;
  const revR = await O.provider.fetch([rev], { fetchFn: (u, o) => { asked++; return answer(u, o); }, storage: store, now: 3000 });
  out.reuse = { asked, status: revR.rev.status };
  // never blocks: every server hangs; the budget answers 'unavailable', and the next plan doesn't hammer them
  O._reset();
  let calls = 0;
  const hang = (u, o) => { calls++; return new Promise((_, no) => o.signal.addEventListener('abort', () => no(new Error('aborted')))); };
  const t0 = Date.now();
  const hung = await O.provider.fetch([c], { fetchFn: hang, storage: mem(), budgetMs: 1200 });
  const took = Date.now() - t0;
  const callsAfterFirst = calls;
  await O.provider.fetch([c], { fetchFn: hang, storage: mem(), budgetMs: 1200 });
  out.hang = { took, status: hung.dr.status, callsAfterFirst, callsAfterSecond: calls };
  // off the critical path: a server that takes 2 s doesn't hold the plan (WAIT_MS), and its late answer serves the next one
  O._reset();
  const lateStore = mem(); let lateCalls = 0;
  const slow = (u, o) => { lateCalls++; return new Promise((res) => setTimeout(() => res({ ok: true, json: async () => fx.overpass }), 2000)); };
  const l0 = Date.now();
  const l1 = await O.provider.fetch([c], { fetchFn: slow, storage: lateStore, now: 5000 });
  const lateTook = Date.now() - l0;
  await new Promise((r) => setTimeout(r, 2300));
  const callsLate = lateCalls;
  const l2 = await O.provider.fetch([c], { fetchFn: slow, storage: lateStore, now: 6000 });
  out.late = { first: l1.dr.status, took: lateTook, second: l2.dr.status, calls: callsLate, callsAfter: lateCalls };
  O._reset();
  const stub = await O.provider.fetch([c], { stub: { overpass: fx.overpass }, storage: null });
  out.stub = { status: stub.dr.status, signals: stub.dr.points.filter((p) => p.kind === 'signal').length };
  const stubNone = await O.provider.fetch([c], { stub: {}, storage: null });
  out.stubNone = stubNone.dr.status;
  // the parsers
  out.speed = ['45 mph', '50', '50;40', 'none', 'signals', 'US:urban', '35mph', null].map((v) => { const k = O.speedKph(v); return Number.isFinite(k) ? Math.round(k * 10) / 10 : null; });
  out.paved = ['asphalt', 'gravel', 'chipseal', 'unhewn_cobblestone', null].map((v) => { const k = O.paved(v); return Number.isFinite(k) ? k : null; });
  out.hgv = ['designated', 'yes', 'destination', 'no', null].map((v) => { const k = O.hgvLevel(v); return Number.isFinite(k) ? k : null; });
  out.access = [{}, { access: 'private' }, { access: 'destination' }, { access: 'no', motor_vehicle: 'yes' }, { motorcar: 'agricultural' }].map(O.accessLevel);
  out.hazard = [{ traffic_sign: 'US:W11-3' }, { hazard: 'animal_crossing', animal: 'deer' }, { traffic_sign: 'US:W11-14' }, { traffic_sign: 'US:W1-2R' },
    { hazard: 'curves' }, { hazard: 'falling_rocks' }, { traffic_sign: 'US:R1-1' }].map((t) => { const h = O.hazardOf(t); return h && h.kind; });
  out.byway = [{ route: 'road', network: 'US:NSB', name: 'Ohio River Scenic Byway' }, { route: 'road', network: 'US:OH:Scenic' }, { route: 'road', network: 'US:OH', ref: '126' }, { scenic: 'yes' }].map(O.bywayLevel);
  // synthetic rules on a straight east-west road at 39 N, 1 km, samples every 25 m
  const n = 41, lat0 = 39, lon0 = -84.5, dLon = 25 / (111320 * Math.cos(39 * Math.PI / 180));
  const syn = { id: 's', lat: Float64Array.from({ length: n }, () => lat0), lon: Float64Array.from({ length: n }, (_, i) => lon0 + i * dLon), distM: Float64Array.from({ length: n }, (_, i) => i * 25) };
  const at = (i, dyM = 0) => [lat0 + dyM / 110540, lon0 + i * dLon];
  const way = (id, tags, pts, nodes) => ({ type: 'way', id, tags, nodes, geometry: pts.map(([la, lo]) => ({ lat: la, lon: lo })) });
  const node = (id, [la, lo], tags) => ({ type: 'node', id, lat: la, lon: lo, tags });
  const els = { elements: [
    way(1, { highway: 'secondary', name: 'Main', maxspeed: '45 mph', lanes: '2' }, [at(-1), at(10), at(20), at(25), at(30), at(41)], [100, 110, 120, 125, 130, 141]),
    way(2, { highway: 'residential', name: 'Side' }, [at(10), at(10, 200)], [110, 210]),                 // T at sample 10, stop for Side
    way(3, { highway: 'residential', name: 'Cross' }, [at(20, -200), at(20), at(20, 200)], [220, 120, 221]), // all-way stop at 20
    way(4, { highway: 'primary', name: 'Big' }, [at(30, -200), at(30), at(30, 200)], [230, 130, 231]),       // route is the minor road here: stop applies
    way(5, { highway: 'service', service: 'driveway' }, [at(5, 0), at(5, 40)], [105, 305]),                 // not a node of way 1: not joined
    node(110, at(10), { highway: 'stop' }), node(120, at(20), { highway: 'stop', stop: 'all' }), node(141, at(41), {}),
    node(125, at(25), { highway: 'traffic_signals' }), node(130, at(30), { highway: 'stop' }), node(999, at(27, 8), { traffic_sign: 'US:W11-3' }),
    way(6, { barrier: 'guard_rail' }, [at(32, 6), at(38, 6)]),
    { type: 'node', id: 7, lat: at(36, 500)[0], lon: at(36, 500)[1], tags: { amenity: 'fuel', brand: 'Speedway', opening_hours: '24/7' } },
  ] };
  const sr = O.aggregate(syn, O.parse(els), new Uint8Array(n).fill(1));
  out.syn = { kinds: kinds(sr.points), points: sr.points, maxspeed: mean(sr.channels.maxspeed_kph), lanes: mean(sr.channels.lanes), guard: [...sr.channels.guard_rail].map((v, i) => (v ? i : -1)).filter((i) => i >= 0),
    side: mean(sr.channels.side_roads_per_km), drive: mean(sr.channels.driveway_joins_per_km) };
  // dual carriageway: two opposite one-ways 20 m apart with the same name
  const dual = { elements: [
    way(11, { highway: 'primary', name: 'Pike', oneway: 'yes' }, [at(-1, 10), at(41, 10)], [1, 2]),
    way(12, { highway: 'primary', name: 'Pike', oneway: 'yes' }, [at(41, -10), at(-1, -10)], [3, 4]),
  ] };
  const syn2 = { ...syn, lat: Float64Array.from(syn.lat, (v) => v + 10 / 110540) };
  const dr = O.aggregate(syn2, O.parse(dual), new Uint8Array(n).fill(1));
  const one = O.aggregate(syn2, O.parse({ elements: [dual.elements[0]] }), new Uint8Array(n).fill(1));
  out.dual = { divided: mean(dr.channels.divided), single: mean(one.channels.divided), spans: dr.spans.map((s) => s.kind) };
  // unknown samples stay NaN
  const half = new Uint8Array(n); for (let i = 0; i < 20; i++) half[i] = 1;
  const hr = O.aggregate(syn, O.parse(els), half);
  out.half = { status: hr.status, nanMax: nan(hr.channels.maxspeed_kph), nanGuard: nan(hr.channels.guard_rail), pointsPast: hr.points.filter((p) => p.atM > 500).length };
  out.query = O.query(['780_-1690']);
  out.lanesOneway = (() => { const e2 = JSON.parse(JSON.stringify(els)); e2.elements[0].tags.oneway = 'yes'; e2.elements[0].tags.lanes = '3'; return mean(O.aggregate(syn, O.parse(e2), new Uint8Array(n).fill(1)).channels.lanes); })();
  out.limits = [O.metresOf('3.5'), O.metresOf("12'6\""), O.metresOf('default'), O.tonnesOf('20 st'), O.tonnesOf('10')];
  out.registered = (globalThis.ApexRouteCtx.providers || []).filter((p) => p.id === 'osm_overpass').map((p) => ({ channels: p.channels.length, budgetMs: p.budgetMs }));
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True, timeout=120).stdout)


def test_real_routes(out):
    r = out["routes"]
    for name, v in r.items():
        assert v["status"] == "ok", name
        assert v["nan"]["signals_per_km"] == 0 and v["nan"]["guard_rail"] == 0, name
    # the strip-mall arterial: signals and side roads; the creek road: none of either to speak of
    assert r["colerain"]["mean"]["signals_per_km"] > 1.5, r["colerain"]["kinds"]
    assert r["indian_creek"]["mean"]["signals_per_km"] == 0
    assert r["colerain"]["mean"]["signals_per_km"] > r["dry_ridge"]["mean"]["signals_per_km"]
    assert r["dry_ridge"]["mean"]["side_roads_per_km"] > r["indian_creek"]["mean"]["side_roads_per_km"]
    assert r["colerain"]["mean"]["lanes"] > r["dry_ridge"]["mean"]["lanes"], "Colerain Avenue is the wide one"
    # fuel within reach of the arterial, with its brand
    assert any(p["kind"] == "fuel" and p.get("label") for p in r["colerain"]["points"])
    # Dry Ridge Road carries no maxspeed tag in OSM: unknown, not invented
    assert r["dry_ridge"]["nan"]["maxspeed_kph"] == r["dry_ridge"]["n"]


def test_one_query_kept_a_week(out):
    c = out["cache"]
    assert c["firstStatus"] == "ok" and c["queries"] == 1
    assert c["againStatus"] == "ok" and c["same"], "the second plan reads the kept tiles: no query"
    assert c["staleStatus"] == "unavailable" and c["staleAllNaN"], "after a week, with no server, unknown (never stale data as fresh)"
    assert c["keys"] >= 1 and c["bytes"] < 400000
    q = c["q"]
    assert "node(w.r)" in q and "barrier=guard_rail" in q and "amenity=fuel" in q and "foreach.rels" in q
    assert not re.search(r"around:\d+,-?\d", q) and not re.search(r"\d\.\d{5}", q), "the servers get tile boxes (4 decimals), never the route's line"
    assert out["reuse"] == {"asked": 0, "status": "ok"}, "the same road driven the other way reuses the kept stretch"


def test_never_blocks_and_backs_off(out):
    h = out["hang"]
    assert h["took"] < 4000 and h["status"] == "unavailable"
    assert h["callsAfterFirst"] == 4, "every server raced once"
    assert h["callsAfterSecond"] == h["callsAfterFirst"], "after a failure the servers get a minute's rest"


def test_stub_mode(out):
    assert out["stub"]["status"] == "ok" and out["stub"]["signals"] >= 1
    assert out["stubNone"] == "unavailable"


def test_tag_parsers(out):
    assert out["speed"] == [72.4, 50.0, 50.0, None, None, None, 56.3, None]
    assert out["paved"] == [1, 0, 1, None, None]
    assert out["hgv"] == [2, 1, 0.5, 0, None]
    assert out["access"] == [0, 2, 1, 0, 2]
    assert out["hazard"] == ["animal_crossing", "animal_crossing", "buggy", "curve_sign", "curve_sign", "hazard", None]
    assert out["byway"] == [2, 1, 0, 1]


def test_stop_signs_that_apply_and_shared_node_joins(out):
    s = out["syn"]
    stops = [p for p in s["points"] if p["kind"] == "stop"]
    # Side's stop at the T (sample 10) is for Side, not us; the all-way at 20 counts; at 30 we are the minor road
    assert sorted(p["atM"] for p in stops) == [500, 750]
    assert [p["value"] for p in sorted(stops, key=lambda p: p["atM"])] == [1, 0]
    assert s["kinds"].get("signal") == 1 and s["kinds"].get("animal_crossing") == 1 and s["kinds"].get("fuel") == 1
    fuel = [p for p in s["points"] if p["kind"] == "fuel"][0]
    assert fuel["value"] == 1 and fuel["label"] == "Speedway" and 450 < fuel["offM"] < 550
    assert round(s["maxspeed"], 1) == 72.4 and s["lanes"] == 1, "lanes=2 on a two-way road: one in your direction"
    assert out["lanesOneway"] == 3
    assert [round(x, 2) if x is not None else None for x in out["limits"]] == [3.5, 3.81, None, 18.14, 10.0]
    assert s["guard"] and min(s["guard"]) >= 31 and max(s["guard"]) <= 39
    assert s["side"] > 0 and s["drive"] == 0, "a driveway drawn beside the road without a shared node isn't a join"


def test_dual_carriageway(out):
    assert out["dual"]["divided"] == 1 and "divided" in out["dual"]["spans"]
    assert out["dual"]["single"] == 0, "a lone one-way street isn't a divided road"


def test_unknown_stays_unknown(out):
    h = out["half"]
    assert h["status"] == "partial" and h["nanMax"] >= 21 and h["nanGuard"] == 21 and h["pointsPast"] == 0


def test_query_shape(out):
    q = out["query"]
    assert q.startswith("[out:json][timeout:25]") and q.count("39.0000,-84.5000,39.0500,-84.4500") == 3, "the tile's box once each for ways, POIs and fuel"
    assert out["registered"] and out["registered"][0]["channels"] == 20


def test_off_the_critical_path(out):
    """The public Overpass servers took 10-20 s or failed on every live run: the plan doesn't wait for them (WAIT_MS 0: the cache only) and the
    late answer is kept for the next plan, which asks nobody."""
    x = out["late"]
    assert x["first"] == "unavailable" and x["took"] < 300, x
    assert x["second"] == "ok" and x["callsAfter"] == x["calls"], x
