"""Enforcement cameras from OpenStreetMap (web/cameras.js): by tile, only the tiles a route passes, kept a week, the
servers raced (the owner, 2026-10-30: "why the lpr data takes so long to load"); plate readers and speed cameras."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/cameras.js');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
  key: (i) => [...m.keys()][i], get length() { return m.size; }, _m: m }; };
(async () => {
  // a diagonal route 2 degrees each way: its tiles, not its box
  const route = []; for (let i = 0; i <= 200; i++) route.push([35 + i * 0.01, -85 + i * 0.01]);
  const tiles = C.tilesNear(route), box = C.tilesInBox(35, -85, 37, -83);
  const els = [{ type: 'node', id: 1, lat: 35.1, lon: -84.9, tags: { 'surveillance:type': 'ALPR' } }, { type: 'node', id: 2, lat: 35.12, lon: -84.88, tags: { highway: 'speed_camera' } },
               { type: 'node', id: 3, lat: 35.1, lon: -84.9, tags: { amenity: 'police' } }, { type: 'way', id: 4, center: { lat: 1, lon: 1 } }];
  // three servers: the first hangs, the second fails, the third answers; the answer wins without waiting for the hang
  const calls = [];
  const fetchFn = (url, o) => { calls.push(url); if (url.includes('overpass-api')) return new Promise((_, no) => o.signal.addEventListener('abort', () => no(new Error('aborted'))));
    if (url.includes('kumi')) return Promise.resolve({ ok: false, status: 429 }); return Promise.resolve({ ok: true, json: async () => ({ elements: els }) }); };
  const store = mem(), t0 = Date.now();
  const first = await C.load(['140_-340'], { fetchFn, storage: store, now: 1000 });
  const took = Date.now() - t0;
  const again = await C.load(['140_-340'], { fetchFn: () => { throw new Error('not again'); }, storage: store, now: 2000 });
  const stale = await C.load(['140_-340'], { fetchFn: () => Promise.resolve({ ok: false, status: 500 }), storage: store, now: 1000 + 8 * 864e5 });
  const empty = await C.load([], { fetchFn, storage: mem() });
  console.log(JSON.stringify({ tiles: tiles.length, box: box.length, q: C.query(['140_-340']), first, took, again, stale, empty, calls: calls.length,
    classify: els.map(C.classify), keys: [...store._m.keys()] }));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_only_the_tiles_a_route_passes(out):
    assert out["tiles"] < out["box"] / 2, "a diagonal route asks for its tiles (28), not its whole box (81)"


def test_query_asks_for_plate_readers_and_speed_cameras(out):
    q = out["q"]
    assert '"surveillance:type"="ALPR"' in q and '"highway"="speed_camera"' in q and "out tags qt" in q
    assert out["classify"] == [{"id": 1, "lat": 35.1, "lon": -84.9, "kind": "alpr"}, {"id": 2, "lat": 35.12, "lon": -84.88, "kind": "speed"}, None, None]


def test_servers_raced_and_tiles_kept_a_week(out):
    assert [c["kind"] for c in out["first"]] == ["alpr", "speed"]
    assert out["took"] < 3000, "the answer wins without waiting for the server that hangs"
    assert out["calls"] == 3, "every server asked at once"
    assert out["again"] == out["first"], "the tile is kept: no second query"
    assert out["stale"] is None, "after a week the tile is asked for again (and offline says so with null)"
    assert out["empty"] == [] and out["keys"] == ["apex.cam.140_-340"]
