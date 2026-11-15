"""A stored drive put on the map's road (web/road_line.js) so its line is measured against the road's own shape (Nate,
2026-11-15: "shouldn't it be drive geometry compared to road geometry?"). Real Cincinnati graph tiles from the repo."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

JS = r"""
const R = process.argv[1], fs = require('fs');
const Core = require(R + '/web/apex_core.js'), GT = require(R + '/web/graph_tiles.js'), GR = require(R + '/web/graph_router.js');
const L = require(R + '/web/road_line.js');
const dir = R + '/web/data/graph/v1/', tile = GT.decode(fs.readFileSync(dir + '381_516.vgr'));
const near = ['380_516', '382_516', '381_515', '381_517'].filter((f) => fs.existsSync(dir + f + '.vgr')).map((f) => GT.decode(fs.readFileSync(dir + f + '.vgr')));
const v = GR.view([tile, ...near]);
// the bendiest long edge of the tile: a real road's corner
let pick = null;
for (let e = 0; e < v.to.length; e++) {
  if (v.eTile[e] !== v.eTile[0] || v.to[e] < 0 || v.len[e] < 250 || v.len[e] > 800) continue;
  const g = GR.geom(v, e); if (g.length < 12) continue;
  const turn = Math.abs(GR.turnAngle(GR.bearing(g[0], g[1], g[2], g[3]), GR.bearing(g[g.length - 4], g[g.length - 3], g[g.length - 2], g[g.length - 1])));
  if (turn < 2.4 && (!pick || turn > pick.turn)) pick = { e, turn };   // radians; not a dead end's turning circle
}
const g = GR.geom(v, pick.e);
// resample it every 5 m and drive it 3 m to its right (inside a lane, as GPS might put it)
const pts = [];
for (let i = 0; i + 3 < g.length; i += 2) {
  const s = GR.distM(g[i], g[i + 1], g[i + 2], g[i + 3]);
  for (let u = 0; u < s; u += 5) pts.push([g[i] + (g[i + 2] - g[i]) * u / s, g[i + 1] + (g[i + 3] - g[i + 1]) * u / s, GR.bearing(g[i], g[i + 1], g[i + 2], g[i + 3])]);
}
const c39 = Math.cos(pts[0][0] * Math.PI / 180);
const d = { id: 'x', lat: [], lon: [] };
for (const [la, lo, b] of pts) { const r = b + Math.PI / 2; d.lat.push(la + 3 * Math.cos(r) / 110540); d.lon.push(lo + 3 * Math.sin(r) / (111320 * c39)); }
const n = d.lat.length, corners = [{ start: 14, end: n - 15 }];
const out = L.along(GR, v, d, corners);
const onRoad = [], fromDrive = [];
for (let q = 0; q < n; q++) if (out.road_lat[q] !== null) {
  onRoad.push(GR.project(v, pick.e, out.road_lat[q], out.road_lon[q]).d);
  fromDrive.push(GR.distM(out.road_lat[q], out.road_lon[q], d.lat[q], d.lon[q]));
}
// a bin in a field 200 m off the road: off the map, null
const off = { ...d, lat: d.lat.slice(), lon: d.lon.slice() }; off.lat[Math.floor(n / 2)] += 200 / 110540;
const offOut = L.along(GR, v, off, corners);
(async () => {
  const stub = { tilesIn: GT.tilesIn, load: async (i, j) => [tile, ...near].find((t) => t.tile.i === i && t.tile.j === j) || null };
  const got = await L.forDrive(d, corners, { GT: stub, GR });
  const none = await L.forDrive(d, corners, { GT: { tilesIn: GT.tilesIn, load: async () => null }, GR });
  console.log(JSON.stringify({ n, turn: pick.turn, matched: onRoad.length, maxOnRoad: Math.max(...onRoad), medFromDrive: fromDrive.sort((a, b) => a - b)[fromDrive.length >> 1],
    outside: out.road_lat.slice(0, 2), mid: offOut.road_lat[Math.floor(n / 2)], forDrive: got.road_lat.filter((x) => x !== null).length, noTiles: none === d,
    windows: L.windows(100, [{ start: 20, end: 30 }, { start: 40, end: 50 }, { start: 80, end: 90 }]) }));
})();
"""


@pytest.fixture(scope="module")
def r():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not installed")
    out = subprocess.run([node, "-e", JS, str(ROOT)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_a_drive_is_put_on_the_road_it_drove(r):
    assert r["turn"] > 0.8                             # a real bend (radians)
    assert r["matched"] == r["n"] - 4                  # every bin of the corner's window (start - 12 .. end + 12)
    assert r["maxOnRoad"] < 0.5                        # the projected points are the road itself
    assert 2.5 < r["medFromDrive"] < 3.5               # from a drive 3 m to one side


def test_off_the_map_is_unknown_never_a_guess(r):
    assert r["outside"] == [None, None]                # outside every corner's window: not matched
    assert r["mid"] is None                            # 200 m off any road


def test_the_tiles_come_from_the_tile_store(r):
    assert r["forDrive"] == r["matched"]
    assert r["noTiles"] is True                        # no tile to be had: the drive as it was, no road claimed
    assert r["windows"] == [[8, 62], [68, 99]]         # corners' windows merged where they touch
