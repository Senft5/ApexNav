"""The map under a Feed post's line (web/post_map.js): viewFor() is the MapLibre camera that lays the real map exactly
under drive_posts.lineSvg's fit of the same points, so the road drawn and the road on the map are one."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const D = require(process.argv[1] + '/web/drive_posts.js'), M = require(process.argv[1] + '/web/post_map.js');
const W = 340, H = 170, PAD = 18;
// where Web Mercator at camera v puts [lat, lon] in a W×H box
const px = (v, lat, lon) => {
  const ws = 512 * 2 ** v.zoom, X = (lo) => (lo + 180) / 360 * ws;
  const Y = (la) => (1 - Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360)) / Math.PI) / 2 * ws;
  return [W / 2 + X(lon) - X(v.center[0]), H / 2 + Y(lat) - Y(v.center[1])];
};
const worst = (pts) => {
  const v = M.viewFor(pts, W, H, PAD), d = D.lineSvg(pts, W, H, PAD);
  const xy = d.match(/-?[\d.]+ -?[\d.]+/g).map((q) => q.split(' ').map(Number));
  return Math.max(...pts.map((p, i) => { const [x, y] = px(v, p[0], p[1]); return Math.hypot(x - xy[i][0], y - xy[i][1]); }));
};
const river = Array.from({ length: 120 }, (_, i) => [39.10 + i * 0.0006, -84.62 + Math.sin(i / 9) * 0.01 + i * 0.0003]);   // ~8 km, Ohio
const wide = Array.from({ length: 200 }, (_, i) => [35.3 + Math.sin(i / 30) * 0.05, -84.1 + i * 0.002]);                     // ~36 km east, Tennessee
const north = Array.from({ length: 100 }, (_, i) => [60.1 + i * 0.002, 10.5 + Math.cos(i / 10) * 0.02]);                       // 22 km north, Norway
console.log(JSON.stringify({
  river: worst(river), wide: worst(wide), north: worst(north),
  none: [M.viewFor([], W, H), M.viewFor([[39, -84]], W, H), M.viewFor(river, 0, H)],
  spot: M.viewFor([[39, -84], [39, -84]], W, H, PAD).zoom,
}));
"""


def run():
    out = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_map_lies_under_the_line():
    r = run()
    # within a pixel of the drawn line everywhere, at a feed card's size, from Ohio to Norway
    assert r["river"] < 1.0, r
    assert r["wide"] < 1.0, r
    assert r["north"] < 1.0, r


def test_no_line_no_map():
    r = run()
    assert r["none"] == [None, None, None]
    assert r["spot"] == 16          # one spot: a street view, not the whole world zoomed past the tiles
