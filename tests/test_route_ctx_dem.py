"""Terrain from the DEM (web/route_ctx/dem.js) on a made-up ridge: grade sign, ridge vs valley (TPI), relief, aspect, west
descents, climb spans, the tile list, and the provider with no DEM reader. The real DEM along real roads is checked in
test_route_engine_calibration.py (the fixtures carry what dem.js computed from the real tiles)."""
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
const D = require(root + '/web/route_ctx/dem.js');
const lat0 = 39.2, lon0 = -84.7, mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const xy = (lat, lon) => [(lon - lon0) / mLon, (lat - lat0) / mLat];
// an east-west ridge 120 m high along y = 0, falling to the north and south
const elevAt = (lat, lon) => { const [x, y] = xy(lat, lon); return 200 + 120 * Math.exp(-((y / 600) ** 2)); };
const line = (pts) => pts.map(([x, y]) => [lon0 + x * mLon, lat0 + y * mLat]);
const out = {};
const along = C.corridor('ridge', line(Array.from({ length: 41 }, (_, i) => [i * 100, 0])), { departAt: 0 });
const valley = C.corridor('valley', line(Array.from({ length: 41 }, (_, i) => [i * 100, -1500])), { departAt: 0 });
const south = C.corridor('south', line(Array.from({ length: 31 }, (_, i) => [2000, 1500 - i * 100])), { departAt: 0 });   // north to south over the top
const mean = (a) => { const v = Array.from(a).filter(Number.isFinite); return v.reduce((s, x) => s + x, 0) / v.length; };
const r1 = D.channelsFrom(along, elevAt), r2 = D.channelsFrom(valley, elevAt), r3 = D.channelsFrom(south, elevAt);
out.status = [r1.status, r2.status, r3.status];
out.tpi = [mean(r1.channels.tpi_m), mean(r2.channels.tpi_m)];
out.relief = [mean(r1.channels.relief_m), mean(r2.channels.relief_m)];
out.gradeAlong = mean(r1.channels.grade_pct);
const g = Array.from(r3.channels.grade_pct), n = g.length;
out.gradeUp = g.slice(2, Math.floor(n * 0.4)).filter(Number.isFinite).every((v) => v > 0);
out.gradeDown = g.slice(Math.ceil(n * 0.6), n - 2).filter(Number.isFinite).every((v) => v < 0);
const asp = Array.from(r3.channels.aspect_rad);
out.aspectNorthSide = asp[8]; out.aspectSouthSide = asp[Math.floor(n * 0.8)];
out.spans = r3.spans.map((s) => [s.kind, s.value > 20]);
// a road heading west downhill (the south slope going down and west), and the same road driven east (uphill)
const wd = C.corridor('wd', line(Array.from({ length: 31 }, (_, i) => [3000 - i * 100, 200 - i * 40])), { departAt: 0 });   // west and south: down the south slope
const ed = C.corridor('ed', line(Array.from({ length: 31 }, (_, i) => [i * 100, -1000 + i * 40])), { departAt: 0 });        // east and north: up it
out.westDescent = [mean(D.channelsFrom(wd, elevAt).channels.west_descent), mean(D.channelsFrom(ed, elevAt).channels.west_descent)];
out.unknown = D.channelsFrom(along, () => null).status;
out.noDataPixel = D.sampler(new Map([['0/0', new Uint8Array(256 * 256 * 4)]]))(85.0, -179.99);
out.tiles = D.tilesFor(along).length;
(async () => {
  out.noReader = (await D.fetch([along], {})).ridge.status;
  globalThis.ApexStages = { demTile: async () => null };
  out.noTiles = (await D.fetch([along], {})).ridge.status;
  process.stdout.write(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def r():
    res = subprocess.run([NODE, "-e", RUNNER, os.path.abspath(".")], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_ridge_and_valley(r):
    assert r["status"] == ["ok", "ok", "ok"]
    ridge, valley = r["tpi"]
    assert ridge > 30 and valley < 0, r["tpi"]
    assert r["relief"][0] > 30, "on the ridge the ground falls away within 800 m"
    assert abs(r["gradeAlong"]) < 0.5, "along the crest it is flat"


def test_grade_aspect_and_spans(r):
    assert r["gradeUp"] and r["gradeDown"], "north to south over the top: up, then down"
    assert abs(r["aspectNorthSide"] - 0) < 0.5 or abs(r["aspectNorthSide"] - 6.283) < 0.5, "the north side falls north"
    assert abs(r["aspectSouthSide"] - 3.1416) < 0.5, "the south side falls south"
    assert ["climb", True] in r["spans"] and ["descent", True] in r["spans"]


def test_west_descent(r):
    down_west, up_east = r["westDescent"]
    assert down_west > 0.6 and up_east == 0


def test_unknown_stays_unknown(r):
    assert r["unknown"] == "unavailable"
    assert r["noDataPixel"] is None, "a no-data pixel is unknown, not 32 km below the sea"
    assert 1 <= r["tiles"] <= 6
    assert r["noReader"] == "unavailable" and r["noTiles"] == "unavailable"
