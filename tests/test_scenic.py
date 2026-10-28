"""Along the route (web/scenic.js, IDEAS R-24, R-23): viewpoints, cafés and fuel within reach of the road, in road order,
one per kind per stretch (a named one kept), and the longest stretch with no fuel."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const S = require(process.argv[1] + '/web/scenic.js');
// a straight road north, 130 km, 5 m samples
const n = 26001, N = (m) => 35 + m / 110540, E = (m) => -84 + m / (111320 * Math.cos(35 * Math.PI / 180));
const t = { lat: Array.from({ length: n }, (_, i) => N(i * 5)), lon: Array(n).fill(-84), dist: Array.from({ length: n }, (_, i) => i * 5) };
const pois = [
  { kind: 'view', name: null, lat: N(10000), lon: E(200) }, { kind: 'view', name: 'Big Overlook', lat: N(10100), lon: E(-150) },   // one stop, the named one
  { kind: 'view', name: 'Far', lat: N(20000), lon: E(900) },                                                                      // too far off the road
  { kind: 'cafe', name: 'Bean', lat: N(5000), lon: E(100) }, { kind: 'fuel', name: 'Shell', lat: N(15000), lon: E(50) },
  { kind: 'fuel', name: 'BP', lat: N(110000), lon: E(30) }, { kind: 'bank', name: 'x', lat: N(1000), lon: E(0) },
];
const list = S.along(pois, t), total = t.dist[n - 1];
console.log(JSON.stringify({ list: list.map((p) => [p.kind, p.name, Math.round(p.m / 100) * 100]), gap: S.fuelGap(list, total), summary: S.summary(list, total),
  noFuelShort: S.summary(S.along(pois.filter((p) => p.kind !== 'fuel'), { ...t, lat: t.lat.slice(0, 4001), lon: t.lon.slice(0, 4001), dist: t.dist.slice(0, 4001) }), 20000),
  none: S.summary([], 10000) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_along_the_road(out):
    assert out["list"] == [["cafe", "Bean", 5000], ["view", "Big Overlook", 10100], ["fuel", "Shell", 15000], ["fuel", "BP", 110000]]


def test_fuel_gap_and_summary(out):
    assert {k: round(v, -2) for k, v in out["gap"].items()} == {"m": 95000, "fromM": 15000, "toM": 110000}   # 30 m sampling
    assert out["summary"] == "1 viewpoint · 1 café · no fuel from mi 9 to 68"
    assert out["noFuelShort"] == "1 viewpoint · 1 café"          # 20 km with no fuel isn't worth a warning
    assert out["none"] == ""
