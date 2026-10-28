"""Offline areas (web/offline_tiles.js, IDEAS F-02): which tiles an area needs, capped; which map requests go through the
offline protocol."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const O = require(process.argv[1] + '/web/offline_tiles.js');
const small = O.plan(35.6, -83.5, 10), big = O.plan(35.6, -83.5, 60);
const z14 = small.map.filter(([z]) => z === 14).length;
console.log(JSON.stringify({ small: { r: small.radiusKm, map: small.map.length, dem: small.dem.length, z14 }, big: { r: big.radiusKm, n: big.map.length + big.dem.length },
  tile: O.transform('https://tiles.openfreemap.org/planet/20251022/14/4300/6500.pbf', 'Tile'), style: O.transform('https://tiles.openfreemap.org/styles/liberty', 'Style'),
  sprite: O.transform('https://tiles.openfreemap.org/sprites/ofm_f384/ofm.png', 'SpriteImage') ?? null, other: O.transform('https://valhalla1.openstreetmap.de/route', 'Unknown') ?? null }));
"""


def test_area_plan_and_protocol():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    s = out["small"]
    assert s["r"] == 10 and 100 < s["z14"] < 200 and s["dem"] >= 3
    assert out["big"]["n"] <= 2500 and out["big"]["r"] < 60, "too big an area shrinks to fit"
    assert out["tile"]["url"].startswith("apexc://https://tiles.openfreemap.org/") and out["style"]["url"].startswith("apexc://")
    assert out["sprite"] is None and out["other"] is None, "only map tiles, the style, its source and fonts"
