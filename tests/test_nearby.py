"""Find nearby (web/nearby.js): Gas (an electric car's Chargers), Coffee and Food in Where to?, the nearest by name from
the map's own tiles. What a typed word asks for, the grid of spots read, and the list: nearest first, one row per place,
an unnamed place saying so (never a made-up name)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const N = require(process.argv[1] + '/web/nearby.js');
const here = { lat: 39.2, lon: -84.6 }, dLat = 1 / 110.54;   // 1 km north per dLat
const pois = [
  { cls: 'cafe', name: 'Far Beans', lat: here.lat + 5 * dLat, lon: here.lon },
  { cls: 'cafe', name: 'Near Beans', lat: here.lat + 0.5 * dLat, lon: here.lon },
  { cls: 'cafe', name: 'Near Beans', lat: here.lat + 0.5 * dLat + 0.0005, lon: here.lon },   // the same café, drawn twice
  { cls: 'cafe', name: null, lat: here.lat + 1 * dLat, lon: here.lon },
  { cls: 'cafe', name: 'Too Far', lat: here.lat + 12 * dLat, lon: here.lon },
  { cls: 'fuel', sub: null, name: 'Shell', lat: here.lat + 2 * dLat, lon: here.lon },
  { cls: 'fuel', sub: 'charging_station', name: 'Tesla Supercharger', lat: here.lat + 3 * dLat, lon: here.lon },
  { cls: 'fast_food', name: 'Skyline Chili', lat: here.lat - 1 * dLat, lon: here.lon },
  { cls: 'restaurant', name: 'Pho Real', lat: here.lat - 2 * dLat, lon: here.lon },
  { cls: 'shop', name: 'Kroger', lat: here.lat, lon: here.lon },
];
const coffee = N.list(pois, here, 'coffee', { km: 8 });
console.log(JSON.stringify({
  coffee: coffee.map((r) => [r.label, r.m]),
  gas: N.list(pois, here, 'gas').map((r) => r.label), charge: N.list(pois, here, 'charge').map((r) => r.label),
  food: N.list(pois, here, 'food').map((r) => r.label), none: N.list(pois, null, 'food'), max: N.list(pois, here, 'coffee', { max: 1 }).length,
  words: ['gas', 'Gas station', 'coffee near me', 'Cafés', 'food', 'restaurants nearby', 'gasoline alley', 'Gas'].map((q) => N.categoryOf(q, false)),
  ev: N.categoryOf('gas', true), keys: N.keys(false), evKeys: N.keys(true),
  grid3: N.gridPoints(39.2, -84.6, 3).length, grid8: N.gridPoints(39.2, -84.6, 8).length, gridBad: N.gridPoints(NaN, 0, 3).length,
  empty: N.emptyLine('food', false, 8, (m) => `${(m / 1609.344).toFixed(0)} mi`), failed: N.emptyLine('food', true),
}));
"""


def test_find_nearby():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert [c[0] for c in out["coffee"]] == ["Near Beans", "Café, no name on the map", "Far Beans"], "nearest first, one row per place"
    assert out["coffee"][0][1] == pytest.approx(500, abs=10)
    assert out["gas"] == ["Shell"] and out["charge"] == ["Tesla Supercharger"], "the tiles file chargers under fuel"
    assert out["food"] == ["Skyline Chili", "Pho Real"] and out["none"] == [] and out["max"] == 1
    assert out["words"] == ["gas", "gas", "coffee", "coffee", "food", "food", None, "gas"]
    assert out["ev"] == "charge" and out["keys"] == ["gas", "coffee", "food"] and out["evKeys"] == ["charge", "coffee", "food"]
    assert 0 < out["grid3"] < out["grid8"] <= 81 and out["gridBad"] == 0
    assert out["empty"] == "No food on the map within 5 mi." and "didn't load" in out["failed"]


def test_where_to_has_the_keys():
    html = open(os.path.join(ROOT, "web", "index.html")).read()
    assert '<script src="nearby.js" defer></script>' in html and 'id="nearbyKeys"' in html
    assert "poisAll," in open(os.path.join(ROOT, "web", "stages.js")).read()
