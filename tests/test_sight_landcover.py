"""What's beside the road (web/stages.js offsetsFrom, IDEAS Q-09): open land widens the sight clearance, woods and unknown don't."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
require(process.argv[1] + '/web/stages.js');
const S = globalThis.ApexStages;
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const poly = (cls, rings) => { let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const r of rings) for (const [x, y] of r) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; return { cls, rings, box: b }; };
const polys = [poly('grass', [sq(0, 0, 10, 10), sq(4, 4, 6, 6)]), poly('farmland', [sq(8, 0, 20, 10)])];
const lat = [5, 5, 5, 5, 5], lon = [2, 5, 9, 15, 30];
console.log(JSON.stringify(S.offsetsFrom(lat, lon, polys).map((v) => (Number.isFinite(v) ? v : null))));
"""


def test_offsets_from_landcover():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    # grass; inside the grass polygon's hole (not grass); grass beats farmland where both; farmland; nothing (default)
    assert out == [12, None, 12, 6, None]
