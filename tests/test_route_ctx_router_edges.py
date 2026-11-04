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
