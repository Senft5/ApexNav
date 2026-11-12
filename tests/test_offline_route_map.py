"""The map kept along a saved route (IDEAS F-03): web/offline_tiles.js tilesAlong / planAlong."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const T = require(process.argv[1] + '/web/offline_tiles.js');
const out = {};
const line = (km) => { const lat = [], lon = []; for (let i = 0; i <= km * 10; i++) { lat.push(35.5 + i * 100 / 110540); lon.push(-83.9); } return { lat, lon }; };
const r30 = line(30), r600 = line(3000);
const z14 = T.tilesAlong(r30.lat, r30.lon, 1.5, 14, 14);
out.unique = new Set(z14.map((t) => t.join('/'))).size === z14.length;
out.z14 = z14.length;
out.disc = T.tilesFor(35.5 + 15 / 110.54, -83.9, 15, 14, 14).length;   // a disc round the same 30 km is far bigger
out.p30 = (({ bufferKm, zmax, map, dem }) => ({ bufferKm, zmax, n: map.length + dem.length }))(T.planAlong(r30.lat, r30.lon));
const p600 = T.planAlong(r600.lat, r600.lon);
out.p600 = p600 && { bufferKm: p600.bufferKm, zmax: p600.zmax, n: p600.map.length + p600.dem.length };
out.none = [T.planAlong([], []), T.planAlong(null, null)];
out.max = T.MAX_TILES;
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    res = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_corridor_tiles_once_each_and_far_fewer_than_a_disc(out):
    assert out["unique"]
    assert 0 < out["z14"] < out["disc"] / 4


def test_plan_along_a_short_route_keeps_every_zoom(out):
    assert out["p30"]["zmax"] == 14 and out["p30"]["bufferKm"] == 1.5 and out["p30"]["n"] <= out["max"]


def test_plan_along_a_long_route_narrows_then_drops_the_closest_zoom(out):
    p = out["p600"]
    assert p is not None and p["n"] <= out["max"]
    assert p["zmax"] < 14 or p["bufferKm"] < 1.5


def test_plan_along_nothing(out):
    assert out["none"] == [None, None]
