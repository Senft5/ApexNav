"""Route context from the map's vector tiles (web/route_ctx/osm_tiles.js): land use, buildings, businesses (not fuel or
cafes), schools, churches, streams the road follows, junctions and driveways, on three REAL Cincinnati-area routes
(OpenFreeMap tiles, 2026-11-01 planet; Valhalla route shapes; tools/route_ctx_fixtures.js cut them small):

- dry_ridge: Dry Ridge Road, Colerain Township (a suburban tertiary through houses), 5.9 km
- colerain: Colerain Avenue past Northgate (the strip-mall arterial), 3.0 km
- indian_creek: Brookville / Riggs / Indian Creek Roads, Reily Township (farm and creek country), 7.4 km

Unknown stays NaN: a sample whose tiles weren't read is never 0."""
import json
import math
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1], fs = require('fs');
globalThis.ApexCore = {};
require(R + '/web/stages.js');
const G = require(R + '/web/route_ctx/osm_common.js');
const T = require(R + '/web/route_ctx/osm_tiles.js');
const { corridor } = require(R + '/tools/route_ctx_fixtures.js');
const FX = R + '/tests/fixtures/route_ctx/';
const mean = (a) => { let s = 0, k = 0; for (const v of a) if (Number.isFinite(v)) { s += v; k++; } return k ? s / k : null; };
const nan = (a) => { let k = 0; for (const v of a) if (!Number.isFinite(v)) k++; return k; };
const summary = (r) => ({ status: r.status, note: r.note || null, mean: Object.fromEntries(Object.entries(r.channels).map(([k, v]) => [k, mean(v)])),
  nan: Object.fromEntries(Object.entries(r.channels).map(([k, v]) => [k, nan(v)])), points: r.points, spans: r.spans });
(async () => {
  const out = { routes: {} };
  for (const name of ['dry_ridge', 'colerain', 'indian_creek']) {
    const fx = JSON.parse(fs.readFileSync(FX + name + '.json', 'utf8'));
    const c = corridor(fx.route); c.id = name;
    const tiles = new Map(Object.entries(fx.tiles));
    const r = T.aggregate(c, tiles);
    out.routes[name] = { n: c.lat.length, ...summary(r), names: [...new Set(T.namesFrom(c, tiles))] };
    if (name === 'dry_ridge') {
      // one tile not read: its samples unknown, the rest still measured
      const drop = new Map(tiles); drop.delete(T.tileOf(c.lat[0], c.lon[0]).join('/'));
      const p = T.aggregate(c, drop);
      out.partial = { status: p.status, note: p.note, nanBiz: nan(p.channels.biz_per_km), nanRes: nan(p.channels.lu_residential), n: c.lat.length,
        zeroWhereUnknown: [...p.channels.bldg_per_km].some((v, i) => v === 0 && !Number.isFinite(p.channels.lu_residential[i])) };
      const none = T.aggregate(c, new Map());
      out.none = { status: none.status, allNaN: Object.values(none.channels).every((a) => nan(a) === a.length), points: none.points.length };
      // the provider end to end with the stub: same answer, registered on the contract
      const viaFetch = await T.provider.fetch([c], { stub: { tiles: {} } });
      out.stubEmpty = viaFetch[name].status;
    }
  }
  // a real tile decoded (Indian Creek Road, Reily Township): what the fixture holds came from this
  const raw = new Uint8Array(fs.readFileSync(FX + 'tile_14_4333_6234.pbf'));
  const t = T.decodeTile(raw, 4333, 6234), b = T.tileBounds(4333, 6234);
  out.decoded = { roads: t.roads.length, names: [...new Set(t.names.map((x) => x.name))].sort(), classes: [...new Set(t.roads.map((x) => x.cls))].sort(),
    buildings: t.buildings.length, polys: [...new Set(t.polys.map((p) => p.ch))].sort(), waterways: t.waterways.length,
    pointsInside: [...t.pois, ...t.places].every((p) => p.lon >= b[0] && p.lon < b[2] && p.lat > b[1] && p.lat <= b[3]) };
  // the network path: tile JSON, then tiles; a tile that never answers is cut off by the budget, never blocks
  T._cache.clear();
  const fx = JSON.parse(fs.readFileSync(FX + 'indian_creek.json', 'utf8'));
  const c = corridor(fx.route); c.id = 'ic';
  const need = T.tilesFor(c);
  const rawTiles = { '4333/6234': raw, '4332/6233': new Uint8Array(fs.readFileSync(FX + 'tile_14_4332_6233.pbf')) };
  const asked = [];
  const fetchFn = (url, o) => {
    asked.push(url);
    if (url.endsWith('/planet')) return Promise.resolve({ ok: true, json: async () => ({ tiles: ['https://tiles.example/{z}/{x}/{y}.pbf'] }) });
    const m = url.match(/14\/(\d+)\/(\d+)\.pbf$/), k = m && `${m[1]}/${m[2]}`;
    if (rawTiles[k]) return Promise.resolve({ ok: true, arrayBuffer: async () => rawTiles[k].buffer.slice(rawTiles[k].byteOffset, rawTiles[k].byteOffset + rawTiles[k].byteLength) });
    return new Promise((_, no) => o.signal && o.signal.addEventListener('abort', () => no(new Error('aborted'))));
  };
  const t0 = Date.now();
  const net = await T.provider.fetch([c], { fetchFn, budgetMs: 600 });
  out.net = { took: Date.now() - t0, status: net.ic.status, need: need.length, asked: asked.length, known: c.lat.length - nan(net.ic.channels.lu_forest), n: c.lat.length };
  const ctl = new AbortController(); T._cache.clear(); setTimeout(() => ctl.abort(), 50);
  const t1 = Date.now();
  const ab = await T.provider.fetch([c], { fetchFn: (u, o) => (u.endsWith('/planet') ? fetchFn(u, o) : new Promise(() => {})), budgetMs: 60000, signal: ctl.signal });
  out.aborted = { took: Date.now() - t1, status: ab.ic.status };
  // businesses: the mapping
  out.biz = [['shop', 'convenience'], ['shop', 'coffee'], ['cafe', 'cafe'], ['fuel', 'fuel'], ['fast_food', 'fast_food'], ['restaurant', 'restaurant'],
    ['school', 'school'], ['parking', 'parking'], ['place_of_worship', 'christian'], ['art_gallery', 'artwork'], ['office', 'company'], ['car', 'car_repair'],
    ['atm', 'atm'], ['park', 'park']].map(([c2, s]) => T.isBusiness(c2, s));
  // per-km density: a count in the middle of 1 km known road, and unknown never reads as zero
  const dist = Float64Array.from({ length: 41 }, (_, i) => i * 25), cnt = new Float32Array(41); cnt[20] = 2;
  const known = new Uint8Array(41).fill(1); for (let i = 30; i < 41; i++) known[i] = 0;
  out.perKm = [...G.perKm(cnt, dist, known, 500)].map((v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null));
  out.registered = (globalThis.ApexRouteCtx.providers || []).map((p) => ({ id: p.id, version: p.version, channels: p.channels.length, network: p.needs.network, budgetMs: p.budgetMs, fetch: typeof p.fetch }));
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True, timeout=120).stdout)


def test_every_sample_known_when_every_tile_was_read(out):
    for name, r in out["routes"].items():
        assert r["status"] == "ok", name
        for ch in ["lu_residential", "lu_retail", "lu_forest", "water_near", "creek_follow", "bldg_per_km", "addr_per_km", "biz_per_km", "access_per_km"]:
            assert r["nan"][ch] == 0, (name, ch)


def test_strip_mall_arterial_is_full_of_businesses_and_back_roads_are_not(out):
    m = {k: v["mean"] for k, v in out["routes"].items()}
    assert m["colerain"]["biz_per_km"] > 20, "Colerain Ave at Northgate: dozens of shops and restaurants a km"
    assert m["dry_ridge"]["biz_per_km"] < 3
    assert m["indian_creek"]["biz_per_km"] == 0
    assert m["colerain"]["lu_retail"] > 0.4 and m["dry_ridge"]["lu_retail"] < 0.1 and m["indian_creek"]["lu_retail"] == 0


def test_suburb_has_houses_country_has_fields_and_a_creek(out):
    m = {k: v["mean"] for k, v in out["routes"].items()}
    assert m["dry_ridge"]["bldg_per_km"] > 20 and m["dry_ridge"]["addr_per_km"] > 10, "houses along Dry Ridge Road"
    assert m["indian_creek"]["bldg_per_km"] < m["dry_ridge"]["bldg_per_km"] / 2
    assert m["indian_creek"]["lu_farmland"] > 0.05 and m["indian_creek"]["lu_forest"] > 0.1
    assert m["indian_creek"]["creek_follow"] > 0.05, "Indian Creek Road follows Indian Creek"
    assert m["colerain"]["creek_follow"] == 0
    assert m["indian_creek"]["water_near"] > m["colerain"]["water_near"]


def test_road_class_and_names_from_tiles(out):
    r = out["routes"]
    assert r["dry_ridge"]["mean"]["road_class"] == 5, "Dry Ridge Road is tertiary its whole length"
    assert r["colerain"]["mean"]["road_class"] < 4, "Colerain Avenue is primary"
    assert "Dry Ridge Road" in r["dry_ridge"]["names"] and "Colerain Avenue" in r["colerain"]["names"]
    assert {"Indian Creek Road", "Riggs Road", "Brookville Road"} <= set(r["indian_creek"]["names"])


def test_points_along_dry_ridge(out):
    pts = out["routes"]["dry_ridge"]["points"]
    school = [p for p in pts if p["kind"] == "school"]
    church = [p for p in pts if p["kind"] == "worship"]
    assert school and "Saint John the Baptist" in school[0]["label"] and 3900 < school[0]["atM"] < 4400
    assert church and abs(church[0]["atM"] - school[0]["atM"]) < 300
    assert [p["atM"] for p in pts] == sorted(p["atM"] for p in pts)
    assert any(p["kind"] == "worship" and "Pioneer Church" in p.get("label", "") for p in out["routes"]["indian_creek"]["points"])


def test_access_density_suburb_vs_country(out):
    m = {k: v["mean"] for k, v in out["routes"].items()}
    assert m["colerain"]["access_per_km"] > m["indian_creek"]["access_per_km"]
    assert m["dry_ridge"]["junctions_per_km"] > m["indian_creek"]["junctions_per_km"]


def test_unknown_stays_unknown(out):
    p = out["partial"]
    assert p["status"] == "partial" and 0 < p["nanBiz"] < p["n"] and p["nanRes"] > 0
    assert not p["zeroWhereUnknown"], "a sample without tiles is NaN, never 0"
    assert out["none"] == {"status": "unavailable", "allNaN": True, "points": 0}
    assert out["stubEmpty"] == "unavailable"


def test_real_tile_decodes(out):
    d = out["decoded"]
    assert "Indian Creek Road" in d["names"] and "tertiary" in d["classes"]
    assert d["pointsInside"], "points in a tile's buffer belong to the neighbour: counted once"
    assert "lu_farmland" in d["polys"] or "lu_forest" in d["polys"]


def test_network_never_blocks(out):
    n = out["net"]
    assert n["took"] < 3000, "a tile that never answers is cut off by the budget"
    assert n["status"] in ("partial", "unavailable") and n["asked"] >= 2
    assert out["aborted"]["took"] < 3000 and out["aborted"]["status"] == "unavailable"


def test_business_mapping_excludes_fuel_and_coffee(out):
    assert out["biz"] == [True, False, False, False, True, True, False, False, False, False, True, True, False, False]


def test_per_km_window(out):
    v = out["perKm"]
    assert v[20] == 4.0, "2 in a 500 m window = 4 per km"
    assert v[0] == 0.0 and v[29] is not None and all(x is None for x in v[30:])


def test_registered_on_the_contract(out):
    p = [x for x in out["registered"] if x["id"] == "osm_tiles"][0]
    assert p["version"] >= 1 and p["channels"] > 15 and p["network"] is True and p["budgetMs"] > 0 and p["fetch"] == "function"
