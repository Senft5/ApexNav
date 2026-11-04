"""Shared helpers for the route-context providers (web/route_ctx/ctx_util.js): states and time zones of the region, local
time, spans, nearest samples, cells and the cache."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const root = process.argv[1];
const U = require(root + '/web/route_ctx/ctx_util.js'), T = require(root + '/tests/fixtures/route_ctx/corridor.js');
const places = { Cincinnati: [39.10, -84.51], Covington: [39.08, -84.51], Louisville: [38.25, -85.76], NewAlbany: [38.29, -85.82], Lexington: [38.04, -84.50],
  Pikeville: [37.48, -82.52], Huntington: [38.42, -82.44], Charleston: [38.35, -81.63], Roanoke: [37.27, -79.94], Knoxville: [35.96, -83.92],
  Asheville: [35.60, -82.55], Bristol: [36.59, -82.19], Nashville: [36.16, -86.78], Indianapolis: [39.77, -86.16], Columbus: [39.96, -83.00],
  Morgantown: [39.63, -79.96], Charlotte: [35.23, -80.84], Pittsburgh: [40.44, -80.00], Atlanta: [33.75, -84.39] };
const st = Object.fromEntries(Object.entries(places).map(([k, [a, o]]) => [k, U.stateAt(a, o)]));
const zones = Object.fromEntries(['Cincinnati', 'Louisville', 'Nashville', 'Knoxville', 'Indianapolis'].map((k) => [k, U.zoneAt(...places[k])]));
const lt = [U.localTime(Date.UTC(2026, 10, 3, 12), 39.1, -84.5), U.localTime(Date.UTC(2026, 6, 4, 12), 39.1, -84.5), U.localTime(Date.UTC(2026, 10, 8, 15), 36.16, -86.78)];
const d = Float64Array.from({ length: 20 }, (_, i) => i * 25);
const spans = U.spansWhere(d, (i) => (i >= 2 && i <= 4) || (i >= 6 && i <= 7) || i === 15, 'x', { valueAt: (i) => i, label: 'L', joinM: 50, minM: 20 });
const c = T.corridor('c', [[39.10, -84.51], [39.10, -84.49]], { departAt: 0 });
const near = U.nearestSample(c, 39.1003, -84.50, 50), far = U.nearestSample(c, 39.11, -84.50, 50), within = U.samplesWithin(c, 39.10, -84.50, 60).length;
const s = T.memoryStorage();
U.cachePut(s, 'k', { a: 1 }, 1000);
const cache = [U.cacheGet(s, 'k', 500, 1200), U.cacheGet(s, 'k', 100, 1200) === undefined];
console.log(JSON.stringify({ st, zones, lt, spans, near: near && [near.i, Math.round(near.dM)], far, within,
  cells: U.cellsAlong([c], 0.05, 0, 1), box: U.cellBox('782_-1691', 0.05).map((v) => +v.toFixed(3)), cache,
  grade: Array.from(U.gradeOf(Float64Array.from([0, 25, 50, 75, 100]), Float32Array.from([100, 99, 98, 97, 96])), (v) => +v.toFixed(3)), gradeNone: Array.from(U.gradeOf(Float64Array.from([0, 25]), null), (v) => (Number.isNaN(v) ? null : v)) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_states_of_the_region(out):
    s = out["st"]
    assert s == {"Cincinnati": "OH", "Covington": "KY", "Louisville": "KY", "NewAlbany": "IN", "Lexington": "KY", "Pikeville": "KY",
                 "Huntington": "WV", "Charleston": "WV", "Roanoke": "VA", "Knoxville": "TN", "Asheville": "NC", "Bristol": "TN",
                 "Nashville": "TN", "Indianapolis": "IN", "Columbus": "OH", "Morgantown": "WV", "Charlotte": "NC", "Pittsburgh": None, "Atlanta": None}


def test_zones_and_local_time(out):
    assert out["zones"] == {"Cincinnati": "America/New_York", "Louisville": "America/New_York", "Nashville": "America/Chicago",
                            "Knoxville": "America/New_York", "Indianapolis": "America/New_York"}
    nov, jul, sun = out["lt"]
    assert (nov["hour"], nov["dow"], nov["m"], nov["d"]) == (7, 2, 11, 3)       # 12:00 UTC = 7 am EST, a Tuesday
    assert jul["hour"] == 8                                                     # EDT in July
    assert (sun["dow"], sun["hour"]) == (0, 9)                                  # Nashville: Central time


def test_spans(out):
    assert out["spans"] == [{"fromM": 50, "toM": 175, "kind": "x", "value": 7, "label": "L"}]   # joined across one gap; 15 too short


def test_nearest_and_cells_and_cache(out):
    assert out["near"][1] < 50 and out["far"] is None and out["within"] >= 4
    assert out["cells"] == ["782_-1691", "782_-1690"] or set(out["cells"]) >= {"782_-1691"}
    assert out["box"] == [39.1, -84.55, 39.15, -84.5]
    assert out["cache"] == [{"a": 1}, True]
    assert out["grade"] == [-0.04] * 5 and out["gradeNone"] == [None, None]
