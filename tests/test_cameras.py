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
  const first = await C.load(['140_-340'], { fetchFn, storage: store, now: 1000, region: null });
  const took = Date.now() - t0;
  const again = await C.load(['140_-340'], { fetchFn: () => { throw new Error('not again'); }, storage: store, now: 2000, region: null });
  const stale = await C.load(['140_-340'], { fetchFn: () => Promise.resolve({ ok: false, status: 500 }), storage: store, now: 1000 + 8 * 864e5, region: null });
  const empty = await C.load([], { fetchFn, storage: mem() });
  // our region file: 156_-339 covered with two cameras, 156_-338 covered with none, 140_-340 not covered (Overpass)
  const doc = { version: 1, tiles: ['156_-339', '156_-338'], cams: [[39.1, -84.7, 'a'], [39.2, -84.6, 's'], [35.1, -84.9, 'a'], [39.1, 'x', 'a'], [39.1, -84.7, 'q']] };
  const asked = [];
  const regionFetch = (url, o) => { asked.push(url.includes('region.json') ? 'region' : 'overpass');
    return url.includes('region.json') ? Promise.resolve({ ok: true, json: async () => doc }) : Promise.resolve({ ok: true, json: async () => ({ elements: els }) }); };
  const store2 = mem();
  const inside = await C.load(['156_-339', '156_-338'], { fetchFn: regionFetch, storage: store2, now: 1000, region: 'https://w/api/cameras/v1/region.json' });
  const insideAsked = asked.splice(0);
  const mixed = await C.load(['156_-339', '140_-340'], { fetchFn: regionFetch, storage: mem(), now: 1000, region: 'https://w/api/cameras/v1/region.json' });
  const mixedAsked = asked.splice(0);
  const down = await C.load(['156_-339'], { fetchFn: (url) => url.includes('region.json') ? Promise.resolve({ ok: false, status: 502 }) : Promise.resolve({ ok: true, json: async () => ({ elements: [] }) }),
    storage: mem(), now: 1000, region: 'https://w/api/cameras/v1/region.json' });
  const both = await C.load(['156_-339'], { fetchFn: () => Promise.resolve({ ok: false, status: 504 }), storage: mem(), now: 1000, region: 'https://w/api/cameras/v1/region.json' });
  console.log(JSON.stringify({ tiles: tiles.length, box: box.length, q: C.query(['140_-340']), first, took, again, stale, empty, calls: calls.length,
    classify: els.map(C.classify), keys: [...store._m.keys()],
    inside, insideAsked, kept2: [...store2._m.keys()].sort(), mixed, mixedAsked, down, both, servers: C.SERVERS.length }));
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
    assert out["calls"] == 4, "every server asked at once"
    assert out["again"] == out["first"], "the tile is kept: no second query"
    assert out["stale"] is None, "after a week the tile is asked for again (and offline says so with null)"
    assert out["empty"] == [] and out["keys"] == ["apex.cam.140_-340"]


def test_our_region_list_answers_its_tiles_without_overpass(out):
    """Nate (2026-11-12): "the camera server always says it's down". Inside our region the phone reads our own list."""
    assert [(c["lat"], c["lon"], c["kind"]) for c in out["inside"]] == [(39.1, -84.7, "alpr"), (39.2, -84.6, "speed")]
    assert out["insideAsked"] == ["region"], "no Overpass query for tiles our list covers"
    assert out["kept2"] == ["apex.cam.156_-338", "apex.cam.156_-339"], "a covered tile with no camera is kept as known-empty"


def test_tiles_outside_our_list_still_go_to_overpass(out):
    assert out["mixedAsked"][0] == "region" and "overpass" in out["mixedAsked"]
    assert sorted(c["kind"] for c in out["mixed"]) == ["alpr", "alpr", "speed", "speed"]
    assert out["servers"] == 4


def test_our_list_down_falls_back_to_overpass_and_both_down_is_unknown(out):
    assert out["down"] == [], "our list down: Overpass answers (none there)"
    assert out["both"] is None, "nothing answered: unknown (the note says offline), never an empty map"
