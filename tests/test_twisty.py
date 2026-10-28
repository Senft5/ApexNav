"""web/twisty.js: the Twisty roads layer draws the loop planner's stages in two strengths and does not refetch on small pans."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

SCRIPT = r"""
const T = require('./web/twisty.js');
const st = (score, jpk, lat0 = 39.24) => ({ score, junctionsPerKm: jpk, lat: [lat0, lat0 + 0.01], lon: [-84.70, -84.69] });
const cache = new Map();
const first = T.add(cache, [st(8, 1), st(3, 1, 39.30), st(1, 0, 39.31), st(9, 6, 39.32)]);
const again = T.add(cache, [st(8, 1)]);
const gj = T.geojson(cache);
const view = (lat, lon, zoom, halfDiagKm) => ({ lat, lon, zoom, halfDiagKm });
const searched = [{ lat: 39.24, lon: -84.70, radiusKm: 10 }];
console.log(JSON.stringify({
  tiers: [T.tier(st(8, 1)), T.tier(st(3, 1)), T.tier(st(1, 0)), T.tier(st(9, 6)), T.tier(null)],
  first, again, size: cache.size,
  props: gj.features.map(f => f.properties.t), coord0: gj.features[0].geometry.coordinates[0],
  zoomedOut: T.nextSearch(view(39.24, -84.70, 9, 30), []),
  fresh: T.nextSearch(view(39.24, -84.70, 12, 40), []),
  smallPan: T.nextSearch(view(39.26, -84.70, 12, 8), searched),
  farPan: T.nextSearch(view(39.40, -84.70, 12, 8), searched),
  tiny: T.nextSearch(view(39.24, -84.70, 15, 0.5), []),
}));
"""


def test_twisty_layer():
    root = Path(__file__).resolve().parents[1]
    p = subprocess.run([NODE, "-e", SCRIPT], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout)
    assert r["tiers"] == [2, 1, 0, 0, 0]       # strong, twisty, not worth it, housing estate, nothing
    assert r["first"] == 2 and r["again"] == 0 and r["size"] == 2
    assert r["props"] == [2, 1]
    assert r["coord0"] == [-84.70, 39.24]       # GeoJSON is [lon, lat]
    assert r["zoomedOut"] is None               # too far out: 64 tiles would cover a fraction of the view
    assert r["fresh"]["radiusKm"] == 10         # capped
    assert r["smallPan"] is None                # 2 km inside a 10 km search: no refetch
    assert r["farPan"] is not None
    assert r["tiny"]["radiusKm"] == 3           # floor
