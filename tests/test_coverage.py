"""Coverage map (web/coverage.js, IDEAS Q-14): a small box around the view, thicker lines with more passes, [lon, lat] for the map."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/coverage.js');
const cache = new Map();
const first = C.add(cache, { ways: [{ way: 1, line: [[35.5, -83.5], [35.51, -83.5]], passes: [2, 0] }, { way: 2, line: [[35.6, -83.4], [35.6, -83.39]], passes: [3, 6] }] });
const again = C.add(cache, { ways: [{ way: 1, line: [[35.5, -83.5], [35.51, -83.5]], passes: [2, 0] }] });
const more = C.add(cache, { ways: [{ way: 1, line: [[35.5, -83.5], [35.51, -83.5]], passes: [3, 0] }] });
console.log(JSON.stringify({
  far: C.boxFor({ s: 30, w: -90, n: 40, e: -80, zoom: 6 }),
  big: C.boxFor({ s: 35, w: -84, n: 36, e: -83, zoom: 9.5 }),
  small: C.boxFor({ s: 35.5, w: -83.6, n: 35.6, e: -83.5, zoom: 12 }),
  inside: [C.inside([35.52, -83.58, 35.58, -83.52], [[35.5, -83.6, 35.6, -83.5]]), C.inside([35.4, -83.6, 35.6, -83.5], [[35.5, -83.6, 35.6, -83.5]])],
  first, again, more, gj: C.geojson(cache),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_box_is_small_and_only_when_zoomed_in(out):
    assert out["far"] is None
    s, w, n, e = out["big"]
    assert n - s < 0.5 and e - w < 0.5 and abs((s + n) / 2 - 35.5) < 1e-3 and abs((w + e) / 2 + 83.5) < 1e-3
    assert out["small"] == [35.5, -83.6, 35.6, -83.5]
    assert out["inside"] == [True, False]


def test_lines_for_the_map(out):
    assert out["first"] is True and out["again"] is False and out["more"] is True
    f = out["gj"]["features"]
    assert [x["properties"]["t"] for x in f] == [1, 2]
    assert f[0]["geometry"]["coordinates"][0] == [-83.5, 35.5]
