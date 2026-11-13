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


def test_saving_an_area_keeps_its_graph_tiles():
    """Own routing offline (docs/OWN_ROUTING.md): Save area also keeps the area's road-network tiles
    (web/graph_tiles.js prefetchArea, IndexedDB), and the page loads the tile reader for it."""
    src = open(os.path.join(ROOT, "web", "offline_tiles.js")).read()
    assert "root.ApexGraphTiles.prefetchArea({ s: lat - dLat, w: lon - dLon, n: lat + dLat, e: lon + dLon })" in src
    assert '<script src="graph_tiles.js" defer></script>' in open(os.path.join(ROOT, "web", "index.html")).read()


RECENT = r"""
const O = require(process.argv[1] + '/web/offline_tiles.js');
const day = 86400000, now = 100 * day;
const recs = Array.from({ length: O.RECENT_MAX + 3 }, (_, i) => ({ url: 't' + i, at: i, recent: true, areas: [] }));
recs.push({ url: 'area', at: -5, recent: true, areas: ['a1'] }, { url: 'style', at: -9 });
console.log(JSON.stringify({ drop: O.overflow(recs), under: O.overflow(recs.slice(0, 10)),
  fresh: O.servable({ recent: true, at: now - 2 * day }, now), old: O.servable({ recent: true, at: now - (O.RECENT_DAYS + 1) * day }, now),
  oldArea: O.servable({ recent: false, areas: ['a1'], at: 0 }, now), oldStyle: O.servable({ at: 0 }, now), none: O.servable(null, now) }));
"""


def test_recent_tiles_are_kept_capped_and_refreshed():
    """Native speed: the tiles last seen are kept so a launch draws the map from the phone. The oldest go beyond RECENT_MAX,
    never one a saved area holds or the style; a recent one is fetched again after RECENT_DAYS (served only when offline)."""
    out = json.loads(subprocess.run([NODE, "-e", RECENT, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["drop"] == ["t0", "t1", "t2"] and out["under"] == []
    assert out["fresh"] and not out["old"] and out["oldArea"] and out["oldStyle"] and not out["none"]
