"""The context grid provider (web/route_ctx/context_grid.js) on the real Cincinnati bundles (web/data/ctx/v1, built by
tools/ctx_etl from NLCD, the BTS noise map, NASA Black Marble, the 2020 Census, ACS, OpenAddresses, HPMS, FARS, FEMA
NFHL, USDA CDL and NPS data).

Known places: downtown (Fountain Square), Dry Ridge Rd (the owner's drive, web/data/dry_ridge.js: I-275 out, the back
road, I-275 home), a residential local street in Anderson Township, and the William Howard Taft NHS. Plus the
aggregations on synthetic bundles (crash density, line matching, sampling) where the answer is known exactly.
"""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.argv[1], G = require(ROOT + '/web/route_ctx/context_grid.js');
const WEB = ROOT + '/web/';
const fetched = [];
const fetchFn = async (url) => {
  fetched.push(url);
  const p = WEB + url;
  if (!fs.existsSync(p)) return { ok: false, status: 404 };
  const b = fs.readFileSync(p);
  return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length), json: async () => JSON.parse(b.toString()) };
};
const corridor = (id, pts) => {
  const lat = Float64Array.from(pts.map((p) => p[0])), lon = Float64Array.from(pts.map((p) => p[1])), distM = new Float64Array(pts.length);
  for (let k = 1; k < pts.length; k++) distM[k] = distM[k - 1] + Math.hypot((lon[k] - lon[k - 1]) * 111320 * Math.cos(lat[k] * Math.PI / 180), (lat[k] - lat[k - 1]) * 111320);
  return { id, lat, lon, distM };
};
// a short straight line through a point, 25 m steps, along a bearing (degrees)
const line = (lat, lon, bearing, n = 9) => { const out = []; for (let k = -(n >> 1); k <= n >> 1; k++) { const d = k * 25, b = bearing * Math.PI / 180;
  out.push([lat + d * Math.cos(b) / 111320, lon + d * Math.sin(b) / (111320 * Math.cos(lat * Math.PI / 180))]); } return out; };
const stats = (a, k0 = 0, k1 = a.length) => { const v = Array.from(a.slice(k0, k1)).filter(Number.isFinite); return v.length ? { mean: v.reduce((s, x) => s + x, 0) / v.length, min: Math.min(...v), max: Math.max(...v), known: v.length / (k1 - k0), big: v.filter((x) => x > 40000).length / v.length } : { known: 0 }; };
const at = (r, k) => Object.fromEntries(Object.entries(r.channels).map(([n, a]) => [n, Number.isFinite(a[k]) ? +a[k].toFixed(3) : null]));

(async () => {
  const out = {};
  // the owner's Dry Ridge Rd drive, resampled to 25 m
  global.window = {}; vm.runInThisContext(fs.readFileSync(WEB + 'data/dry_ridge.js', 'utf8'));
  const d = window.APEX_DRIVES[0], fi = (k) => d.fields.indexOf(k), pts = []; let next = 0;
  for (const r of d.rows) { const m = r[fi('distance_m')]; if (Number.isFinite(r[fi('lat')]) && m >= next) { pts.push([r[fi('lat')], r[fi('lon')]]); next = m + 25; } }
  const drive = corridor('dry', pts);
  const cs = [drive, corridor('downtown', line(39.1016, -84.5125, 0)), corridor('anderson', line(39.0780, -84.3500, 90)),
    corridor('taft', line(39.1197, -84.5089, 0)), corridor('nashville', line(36.1627, -86.7816, 0))];
  const t0 = Date.now();
  const res = await G.fetch(cs, { fetchFn });
  out.ms = Date.now() - t0;
  out.fetched = fetched.slice();
  out.status = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, [v.status, v.note || null]]));
  const R = res.dry, km = (a, b) => [Math.round(a * 1000 / 25), Math.round(b * 1000 / 25)];
  out.drive = { n: drive.lat.length, back: {}, highway: {}, points: R.points.length, crashSum: R.points.reduce((s, p) => s + 1, 0), spans: R.spans };
  for (const [name, a] of Object.entries(R.channels)) { out.drive.back[name] = stats(a, ...km(25.5, 31.5)); out.drive.highway[name] = stats(a, ...km(1, 20)); }
  out.drive.crashFinite = stats(R.channels.crash_density).known;
  out.downtown = at(res.downtown, 4); out.anderson = at(res.anderson, 4); out.taft = at(res.taft, 4); out.taftSpans = res.taft.spans;
  out.nashville = { status: res.nashville.status, anyFinite: Object.values(res.nashville.channels).some((a) => Array.from(a).some(Number.isFinite)) };
  // a second plan: bundles come from memory, no refetch
  fetched.length = 0; await G.fetch([corridor('again', line(39.1016, -84.5125, 0))], { fetchFn }); out.refetched = fetched.slice();

  // ---- synthetic: the crash density along a straight 4 km road, one crash 10 m off it, one 60 m off it (not counted)
  const mk = (header, arrays) => G.parse(encode(header, arrays));
  function encode(header, arrays) {
    const parts = [], meta = {}; let off = 0;
    for (const [name, [dt, vals]] of Object.entries(arrays)) { const T = { u8: Uint8Array, u16: Uint16Array, u32: Uint32Array }[dt], a = T.from(vals), b = new Uint8Array(a.buffer);
      const pad = (4 - b.length % 4) % 4; parts.push(b, new Uint8Array(pad)); meta[name] = [dt, off, a.length]; off += b.length + pad; }
    const h = new TextEncoder().encode(JSON.stringify({ ...header, arrays: meta })), pad = (4 - (8 + h.length) % 4) % 4;
    const all = new Uint8Array(8 + h.length + pad + off); all.set(new TextEncoder().encode('VCG1')); new DataView(all.buffer).setUint32(4, h.length, true); all.set(h, 8);
    let o = 8 + h.length + pad; for (const p of parts) { all.set(p, o); o += p.length; } return all;
  }
  const lat0 = 39.05, lon0 = -84.70, [BX, BY] = G.project(lat0, lon0, 8).map(Math.floor);
  const toU = (la, lo) => { const [x, y] = G.project(la, lo, 8); return [Math.round((x - BX) * 65535), Math.round((y - BY) * 65535)]; };
  const road = []; for (let k = 0; k <= 160; k++) road.push([lat0, lon0 + k * 25 / (111320 * Math.cos(lat0 * Math.PI / 180))]);
  const crashAt = (k, offM) => toU(lat0 + offM / 111320, road[k][1]);
  const c1 = crashAt(80, 10), c2 = crashAt(20, 60);
  const [tx, ty] = G.project(lat0, lon0, 12).map(Math.floor), cov = [];
  for (let j = ty - 2; j <= ty + 2; j++) for (let i = tx - 2; i <= tx + 4; i++) if (Math.floor(i / 16) === BX && Math.floor(j / 16) === BY) cov.push([i % 16, j % 16]);
  // two road spans: the east-west road (AADT 900) and a north-south one crossing it (AADT 30000)
  const a = toU(lat0, lon0 - 0.01), b = toU(lat0, lon0 + 0.06), c = toU(lat0 - 0.01, road[60][1]), e = toU(lat0 + 0.01, road[60][1]);
  const zz = (v) => (v << 1) ^ (v >> 31);
  const syn = mk({ v: 1, x: BX, y: BY, coverage: cov, channels: {},
    points: { count: 2, years: [2020, 2024], x: 'px', y: 'py', year: 'yr', fatals: 'ft', hour: 'hr' },
    lines: { count: 2, n: 'ln', x0: 'lx', y0: 'ly', dx: 'ldx', dy: 'ldy', attrs: { aadt: { array: 'la', nodata: 4294967295 }, fclass: { array: 'lf', nodata: 255 }, lanes: { array: 'll', nodata: 255 } } } },
    { px: ['u16', [c1[0], c2[0]]], py: ['u16', [c1[1], c2[1]]], yr: ['u16', [2022, 2021]], ft: ['u8', [2, 1]], hr: ['u8', [23, 255]],
      ln: ['u16', [2, 2]], lx: ['u16', [a[0], c[0]]], ly: ['u16', [a[1], c[1]]], ldx: ['u16', [zz(b[0] - a[0]), zz(e[0] - c[0])]], ldy: ['u16', [zz(b[1] - a[1]), zz(e[1] - c[1])]],
      la: ['u32', [900, 30000]], lf: ['u8', [5, 3]], ll: ['u8', [2, 4]] });
  const bm = new Map([[`${BX}/${BY}`, syn]]), rc = corridor('syn', road);
  const cr = G.crashes(bm, rc.lat, rc.lon, rc.distM);
  out.syn = { at80: cr.density[80], at10: cr.density[10], at130: cr.density[130], at20: cr.density[20], points: cr.points };
  const sc = G.sampleCorridor(bm, rc);
  out.syn.aadt = [sc.channels.aadt[20], sc.channels.aadt[60], sc.channels.aadt[100]];
  // the crossing road is matched only by a corridor that drives along it
  const ns = corridor('ns', line(lat0, road[60][1], 0, 21));
  out.syn.nsAadt = G.sampleCorridor(bm, ns).channels.aadt[10];
  out.syn.offRoad = G.matchLine(bm, lat0 + 30 / 111320, road[20][1], Math.PI / 2);
  // sampling: bilinear inside known cells, the cell under the point when a neighbour is unknown
  const n = 32, cz = 17, [gx, gy] = G.project(lat0, lon0, cz).map(Math.floor), ti = Math.floor(gx / n), tj = Math.floor(gy / n);
  const vals = new Array(n * n).fill(10); vals[(gy - tj * n) * n + (gx - ti * n)] = 30; vals[(gy - tj * n) * n + (gx - ti * n) + 1] = 255;
  const rb = mk({ v: 1, x: BX, y: BY, coverage: cov, channels: { canopy_pct: { n, scale: 1, offset: 0, nodata: 255, tiles: [[ti % 16, tj % 16]], array: 'cp' },
    housing_density: { n, scale: Math.log1p(20000) / 254, offset: 'log1p', nodata: 255, tiles: [[ti % 16, tj % 16]], array: 'hd' } } },
    { cp: ['u8', vals], hd: ['u8', new Array(n * n).fill(127)] });
  const rm = new Map([[`${BX}/${BY}`, rb]]), cxl = (gx + 0.5) / 2 ** cz * 360 - 180, cyl = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** cz))) * 180 / Math.PI;
  out.sample = { centre: G.sample(rm, 'canopy_pct', cyl(gy + 0.5), cxl), edge: G.sample(rm, 'canopy_pct', cyl(gy + 0.25), (gx + 0.25) / 2 ** cz * 360 - 180),
    nearUnknown: G.sample(rm, 'canopy_pct', cyl(gy + 0.5), (gx + 0.9) / 2 ** cz * 360 - 180), unknownCell: G.sample(rm, 'canopy_pct', cyl(gy + 0.5), (gx + 1.5) / 2 ** cz * 360 - 180),
    outside: G.sample(rm, 'canopy_pct', lat0 + 1, lon0), logMid: G.sample(rm, 'housing_density', cyl(gy + 0.5), cxl) };
  out.cropGroup = [1, 5, 37, 141, 124, 111, 176, 0].map(G.cropGroup);
  out.offline = await G.urlsNear(39.1, -84.5, 25, { fetchFn });
  // in a page: the provider registers with the route engine (or queues until registry.js loads)
  const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(WEB + 'route_ctx/context_grid.js', 'utf8'), ctx);
  const p = ctx.window.ApexRouteCtx.pending[0];
  out.registered = { id: p.id, version: p.version, channels: p.channels, needs: p.needs, budgetMs: p.budgetMs, fetch: typeof p.fetch };
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_loads_only_the_bundles_the_corridors_touch(out):
    bundles = [u for u in out["fetched"] if u.endswith(".vcg")]
    assert out["fetched"][:2] == ["data/ctx/v1/index.json", "/api/ctx/v1/index.json"], "the shipped set, then the Worker's"
    assert sorted(bundles) == ["data/ctx/v1/8/67/97.vcg", "data/ctx/v1/8/68/97.vcg"], "Nashville is not in the index: no request"
    assert out["refetched"] == [], "a second plan reads the bundles from memory"
    assert out["status"]["downtown"][0] == "ok" and out["status"]["dry"][0] == "ok"
    assert out["status"]["nashville"][0] == "unavailable" and not out["nashville"]["anyFinite"], "outside: unknown, never 0"


def test_downtown_reads_as_a_city(out):
    d = out["downtown"]
    assert d["impervious_pct"] > 70 and d["canopy_pct"] < 10 and d["night_lights"] > 0.95
    assert d["housing_density"] > 300 and d["address_density"] > 1000 and d["median_year_built"] < 1950
    assert d["park_visits"] == 0 and d["flood_zone"] == 0


def test_dry_ridge_reads_as_a_back_road(out):
    b, h = out["drive"]["back"], out["drive"]["highway"]
    assert b["canopy_pct"]["mean"] > 30 and b["impervious_pct"]["mean"] < 12 and b["night_lights"]["mean"] < 0.5
    assert b["address_density"]["mean"] < 150 and b["housing_density"]["mean"] < 100
    assert 1000 < b["aadt"]["min"] and b["aadt"]["max"] < 3000, "Dry Ridge Rd carries 1,478-2,030 vehicles a day (HPMS)"
    assert b["hpms_fclass"]["min"] >= 5, "a collector, not an arterial"
    # the same drive's I-275 legs
    assert h["hpms_fclass"]["max"] == 1 and h["aadt"]["known"] > 0.85 and h["aadt"]["big"] > 0.9, \
        "I-275 carries 45,000-79,000 a day; the few lower samples are its interchanges"
    assert h["iri"]["known"] > 0.8 and 25 < h["iri"]["mean"] < 150 and h["hpms_speed_limit"]["min"] >= 65
    assert h["noise_db"]["mean"] > b["noise_db"]["mean"] + 15


def test_a_subdivision_sits_between(out):
    a, d = out["anderson"], out["downtown"]
    assert 200 < a["housing_density"] < 1500 and 20 < a["impervious_pct"] < d["impervious_pct"]
    assert a["canopy_pct"] > d["canopy_pct"] + 15 and a["hpms_fclass"] == 7 and a["aadt"] is None, "local streets carry no count"


def test_crash_density_is_fatal_crashes_per_km_per_year(out):
    s = out["syn"]
    # one crash 10 m off the road at sample 80: counted over the 2 km window (81 samples, 2.025 km) over 5 years
    assert s["at80"] == pytest.approx(1 / 2.025 / 5, rel=1e-3) and s["at10"] == 0 and s["at130"] == 0
    assert s["at20"] == 0, "the crash 60 m off the road isn't on it"
    assert s["points"] == [{"atM": pytest.approx(2000, abs=1), "kind": "fatal_crash", "value": 2, "label": "2022", "hour": 23}]
    assert out["drive"]["points"] > 0 and out["drive"]["crashFinite"] == 1


def test_road_spans_match_by_distance_and_heading(out):
    s = out["syn"]
    assert s["aadt"] == [900, 900, 900], "driving east, the crossing north-south road (30,000) is never taken"
    assert s["nsAadt"] == 30000 and s["offRoad"] is None


def test_sampling(out):
    s = out["sample"]
    assert s["centre"] == pytest.approx(30) and 10 < s["edge"] < 30
    assert s["nearUnknown"] == 30, "a neighbour unknown: the cell under the point, not a blend with nothing"
    assert s["unknownCell"] is None and s["outside"] is None
    assert s["logMid"] == pytest.approx(140.8, rel=0.01), "log scale: raw 127 of 254 is sqrt(20,001) - 1"


def test_parks_and_crops(out):
    assert out["taft"]["park_visits"] == 18121
    span = out["taftSpans"][0]
    assert span["kind"] == "nps_unit" and span["label"] == "William Howard Taft National Historic Site" and span["year"] == 2025
    assert len(span["monthly"]) == 12 and sum(span["monthly"]) == span["value"]
    assert out["cropGroup"] == ["crops", "crops", "hay", "forest", "developed", "water", "pasture", "other"]


def test_offline_areas_keep_the_bundles(out):
    assert sorted(out["offline"]) == ["data/ctx/v1/8/67/97.vcg", "data/ctx/v1/8/68/97.vcg"], "only bundles that exist"


def test_registers_to_the_contract(out):
    r = out["registered"]
    assert r["id"] == "context_grid" and r["fetch"] == "function" and r["needs"] == {"network": False}
    for ch in ["night_lights", "impervious_pct", "canopy_pct", "noise_db", "housing_density", "address_density", "aadt", "iri",
               "hpms_speed_limit", "hpms_lanes", "crash_density", "flood_zone", "cropland_class", "mobile_coverage", "park_visits"]:
        assert ch in r["channels"]


def test_every_channel_is_documented_in_the_header():
    src = open(os.path.join(ROOT, "web", "route_ctx", "context_grid.js")).read()
    head = src.split("(function (root)")[0]
    for ch in ["night_lights", "impervious_pct", "canopy_pct", "noise_db", "housing_density", "population_density", "address_density",
               "median_year_built", "flood_zone", "cropland_class", "park_visits", "mobile_coverage", "aadt", "iri", "hpms_speed_limit",
               "hpms_lanes", "hpms_fclass", "crash_density"]:
        assert f"//   {ch} " in head, f"{ch} has no line in the provider's header"
    assert "Fatal crashes per km per year" in head


def test_offline_areas_save_the_bundles_with_the_map():
    src = open(os.path.join(ROOT, "web", "offline_tiles.js")).read()
    assert "ApexContextGrid.urlsNear(lat, lon, p.radiusKm)" in src, "Save area keeps the route context with the map tiles"
    grid = open(os.path.join(ROOT, "web", "route_ctx", "context_grid.js")).read()
    assert "root.ApexOfflineTiles.get(url)" in grid, "and the provider reads them back offline"


def test_an_hpms_limit_that_is_no_limit_reads_as_unknown():
    """Bundles built before 2026-11-09 hold a state's "not reported" code clamped to 254 mph. The reader gives unknown for
    anything outside 5-85 mph, and no span of the shipped bundles reads as a limit outside it (281 of them hold 254)."""
    js = r"""
const path = require('path'), fs = require('fs'), zlib = require('zlib'), ROOT = process.argv[1];
globalThis.ApexCore = require(path.join(ROOT, 'web/apex_core.js'));
const G = require(path.join(ROOT, 'web/route_ctx/context_grid.js'));
const fake = { header: { lines: { attrs: { speed_limit: { array: 'a', nodata: 255 }, lanes: { array: 'l', nodata: 255 } } } }, arrays: { a: [254, 3, 55, 255, 90, 85, 5, 0], l: [254, 2, 255, 1, 1, 1, 1, 1] } };
const out = { unit: fake.arrays.a.map((_, s) => G.lineValue({ s, bundle: fake }, 'speed_limit')), lanes: [0, 1, 2].map((s) => G.lineValue({ s, bundle: fake }, 'lanes')), raw254: 0, bad: 0, known: 0 };
const dir = path.join(ROOT, 'web/data/ctx/v1'), ix = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
for (const key of Object.keys(ix.bundles)) {
  let b = fs.readFileSync(path.join(dir, '8', key + '.vcg')); if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b);
  const g = G.parse(new Uint8Array(b.buffer, b.byteOffset, b.length)), A = g.header.lines && g.header.lines.attrs.speed_limit;
  if (!A) continue;
  const arr = g.arrays[A.array];
  for (let s = 0; s < arr.length; s++) { if (arr[s] === 254) out.raw254++; const v = G.lineValue({ s, bundle: g }, 'speed_limit'); if (Number.isFinite(v)) { out.known++; if (v < 5 || v > 85) out.bad++; } }
}
console.log(JSON.stringify(out));
"""
    r = subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout)
    assert o["unit"] == [None, None, 55, None, None, 85, 5, None], o["unit"]      # NaN is null in JSON
    assert o["lanes"] == [254, 2, None], "only the limit is range-checked"
    assert o["known"] > 10000 and o["bad"] == 0, o
