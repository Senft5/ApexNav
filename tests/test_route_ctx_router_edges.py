"""Router edge attributes (web/route_ctx/router_edges.js) on a REAL trace_attributes answer: Colerain Avenue by Northgate,
Cincinnati (tests/fixtures/route_engine/trace_colerain_ave.json, valhalla1.openstreetmap.de, OSM ODbL)."""
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
const R = require(root + '/web/route_ctx/router_edges.js');
const fx = JSON.parse(require('fs').readFileSync(root + '/tests/fixtures/route_engine/trace_colerain_ave.json', 'utf8'));
function decode(str) { const o = []; let i = 0, lat = 0, lon = 0; while (i < str.length) { for (const w of [0, 1]) { let s = 0, r = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20); const d = (r & 1) ? ~(r >> 1) : (r >> 1); if (w === 0) lat += d; else lon += d; } o.push([lon / 1e6, lat / 1e6]); } return o; }
const coords = decode(fx.route.shape);
const out = {};
out.roundtrip = R.encode6(coords) === fx.route.shape;
const edges = R.parse(fx.trace_attributes);
out.n = edges.length;
out.lengthM = Math.round(edges[edges.length - 1].toM);
out.routeM = Math.round(fx.route.length_km * 1000);
out.contiguous = edges.every((e, i) => i === 0 || Math.abs(e.fromM - edges[i - 1].toM) < 1e-6);
out.posted = [...new Set(edges.map((e) => e.sl).filter((v) => v != null))];
out.estOnlyWhereMissing = edges.every((e) => (e.sl == null) === (e.est != null) || e.rc == null);
out.signals = edges.filter((e) => e.signal).length;
out.side = edges.reduce((s, e) => s + e.side, 0); out.drive = edges.reduce((s, e) => s + e.drive, 0);
out.classes = [...new Set(edges.map((e) => e.rc))].sort();
const c = C.corridor('x', coords, { timeS: fx.route.time, departAt: 0 });
const ch = R.toChannels(c, edges);
out.status = ch.status;
out.lens = Object.values(ch.channels).every((v) => v.length === c.distM.length);
const k = (name) => Array.from(ch.channels[name]);
const finite = (a) => a.filter(Number.isFinite);
out.sigPerKmMean = finite(k('signals_per_km')).reduce((a, b) => a + b, 0) / finite(k('signals_per_km')).length;
out.accessMean = finite(k('access_per_km')).reduce((a, b) => a + b, 0) / finite(k('access_per_km')).length;
out.densityRange = [Math.min(...finite(k('density'))), Math.max(...finite(k('density')))];
out.limitKnownShare = finite(k('speed_limit_kph')).length / c.distM.length;
out.estOverlap = k('speed_limit_kph').some((v, i) => Number.isFinite(v) && Number.isFinite(k('speed_limit_est_kph')[i]));
out.signalPoints = ch.points.filter((p) => p.kind === 'signal').length;
out.empty = R.toChannels(c, null).status;
out.nothing = R.parse({ error: 'no' });
out.estimates = [R.estimateLimit(6, 0, 7), R.estimateLimit(4, 0, 1), R.estimateLimit(4, 0, 9), R.estimateLimit(0, 0, 2), R.estimateLimit(6, 4, 3)];
out.request = Object.keys(R.request(coords)).sort();
out.filter = R.request(coords).filters.attributes.length;
// the provider through a stubbed router: one call per candidate, cached, unavailable when the router fails
(async () => {
  let calls = 0;
  const ok = async (url, o) => { calls++; return { ok: true, json: async () => fx.trace_attributes }; };
  const r1 = await R.fetch([c], { fetch: ok }); const r2 = await R.fetch([C.corridor('y', coords, {})], { fetch: ok });
  out.calls = calls; out.cached = r2.y.status;
  const bad = await R.fetch([C.corridor('z', coords.slice(0, 40), {})], { fetch: async () => { throw new Error('down'); } });
  out.down = bad.z.status;
  out.tooLong = (await R.fetch([{ id: 'w', coords, totalM: 3e5, distM: c.distM }], { fetch: ok })).w.status;
  // one request per line, walk_or_snap (an exact walk 400s on lines routed through shaping points, error 443)
  const seen = [];
  await R.fetch([C.corridor('m', coords.slice(0, 60), {})], { fetch: async (url, o) => { seen.push(JSON.parse(o.body).shape_match); return { ok: true, json: async () => fx.trace_attributes }; } });
  out.matches = seen;
  // at the deadline: the lines that answered come back, the rest are out of time (not the whole provider)
  const ctrl = new AbortController(), t0 = Date.now();
  const lines = [0, 1, 2, 3, 4, 5].map((k) => C.corridor('p' + k, coords.slice(k, 80 + k), {}));
  const slowFor = (id) => /p[45]/.test(id);
  const part = R.fetch(lines, { signal: ctrl.signal, fetch: (url, o) => new Promise((res, rej) => {
    const enc = JSON.parse(o.body).encoded_polyline, id = lines.find((l) => R.encode6(l.coords) === enc).id;
    if (!slowFor(id)) return setTimeout(() => res({ ok: true, json: async () => fx.trace_attributes }), 20);
    o.signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
  }) });
  setTimeout(() => ctrl.abort(), 200);
  const pr = await part;
  // a stage (map_snap) goes through our Worker's relay with at most 600 points; a route the driver is offered never does
  const relayed = [];
  const stageC = C.corridor('st', coords.map(([x, y]) => [x + 2e-4, y]), {}); stageC.match = 'map_snap';
  const viaRelay = await R.fetch([stageC, C.corridor('rt', coords.map(([x, y]) => [x - 2e-4, y]), {})], { apiGet: async (p) => { relayed.push(p); return fx.trace_attributes; }, fetch: ok });
  out.relay = { stage: viaRelay.st.status, route: viaRelay.rt.status, asked: relayed.length, path: relayed[0] && relayed[0].startsWith('/api/ctx/trace?shape='),
    points: relayed[0] ? R.encode6([]).length + decodeURIComponent(relayed[0].split('shape=')[1]).length > 0 : false };
  out.partial = Object.fromEntries(Object.entries(pr).map(([k, v]) => [k, v.status])); out.partialMs = Date.now() - t0;
  process.stdout.write(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def r():
    res = subprocess.run([NODE, "-e", RUNNER, os.path.abspath(".")], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_parses_the_real_answer(r):
    assert r["roundtrip"], "polyline6 encode is the router's own"
    assert r["n"] > 20 and r["contiguous"]
    assert abs(r["lengthM"] - r["routeM"]) <= 5, "edge lengths add up to the route"
    assert r["posted"] and all(30 <= v <= 120 for v in r["posted"])
    assert r["estOnlyWhereMissing"], "an estimate never stands beside a posted limit"
    assert r["signals"] >= 3, "Colerain Avenue by Northgate has signals"
    assert r["drive"] >= 5, "and driveways into the shops"
    assert r["nothing"] is None and r["empty"] == "unavailable"


def test_channels_on_the_corridor(r):
    assert r["status"] == "ok" and r["lens"]
    assert r["sigPerKmMean"] > 1, r["sigPerKmMean"]
    assert r["accessMean"] > 5, r["accessMean"]
    assert r["densityRange"][1] >= 6, "an urban arterial"
    assert not r["estOverlap"]
    assert r["signalPoints"] == r["signals"]


def test_estimates_and_request(r):
    assert r["estimates"] == [40, 72, 56, 105, 16], "residential 25 mph; rural tertiary 45; suburban tertiary 35; motorway 65; a driveway 10"
    assert r["request"] == ["costing", "encoded_polyline", "filters", "shape_match"] and r["filter"] >= 15


def test_provider_caches_and_degrades(r):
    assert r["calls"] == 1 and r["cached"] == "ok", "the same candidate twice is one request"
    assert r["down"] == "unavailable" and r["tooLong"] == "unavailable"


def test_walk_or_snap_and_partial_at_the_deadline(r):
    """Stage plans are routed through shaping points: an exact edge walk answers 400 (error 443) on them, so every line
    asks walk_or_snap (one request, the server falls back to map matching). At the deadline the lines that answered
    count; only the slow ones are out of time."""
    assert r["matches"] == ["walk_or_snap"]
    assert r["partial"] == {"p0": "ok", "p1": "ok", "p2": "ok", "p3": "ok", "p4": "unavailable", "p5": "unavailable"}
    assert r["partialMs"] < 400


def test_stages_through_the_relay(r):
    """A stage's line (cut from the map tiles, never the driver's route) asks our Worker's relay, which keeps its edges per
    shape for the next plan nearby; the driver's own routes still go to the public router from the phone."""
    x = r["relay"]
    assert x["stage"] == "ok" and x["route"] == "ok" and x["asked"] == 1 and x["path"], x
