"""The Worker's OSM relay (backend/src/osm_relay.ts) asks Overpass the phone's own query for a tile and keeps the tags the
phone reads (web/route_ctx/osm_overpass.js): the two must not drift, or the phone would parse a different answer from the
relay than from Overpass."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
(async () => {
  const root = process.argv[1];
  const O = require(root + '/web/route_ctx/osm_overpass.js');
  const T = await import(root + '/backend/src/osm_relay.ts');
  const TR = await import(root + '/backend/src/trace_relay.ts'), RE = require(root + '/web/route_ctx/router_edges.js');
  const tiles = ['785_-1693', '-12_37'];
  console.log(JSON.stringify({
    query: tiles.every((t) => O.query([t]) === T.query([t])),
    keep: [...O.KEEP].sort().join() === [...T.KEEP].sort().join(),
    tile: O.TILE === T.TILE, attrs: RE.ATTRS.join() === TR.ATTRS.join(),
    shape: (() => { const pts = [[39.1, -84.5], [39.12, -84.52], [39.125, -84.55]]; const d = TR.decode6(RE.encode6(pts.map(([la, lo]) => [lo, la]))); return JSON.stringify(d) === JSON.stringify(pts) && !!TR.stageLine(RE.encode6(pts.map(([la, lo]) => [lo, la]))); })(), mirrors: O.SERVERS.every((s) => T.MIRRORS.includes(s)),
    // the relay's answer parses on the phone exactly as the raw answer does
    parse: (() => { const raw = require(root + '/tests/fixtures/route_ctx/dry_ridge.json').overpass; const a = O.parse(raw), b = O.parse(T.compact(raw));
      const flat = (p) => JSON.stringify([[...p.nodes], [...p.ways], [...p.rels]]); return flat(a) === flat(b); })(),
  }));
})();
"""


def test_relay_matches_the_phone():
    res = subprocess.run([NODE, "--experimental-strip-types", "--no-warnings", "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    out = json.loads(res.stdout)
    assert out == {"query": True, "keep": True, "tile": True, "attrs": True, "shape": True, "mirrors": True, "parse": True}, out
