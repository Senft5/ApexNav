"""The base map's palette (web/basemap.js): a town's raised buildings take the theme's land a seventh of the way to the
road casing's ink, so a block reads on every theme and is never louder than a road."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const vm = require('node:vm'), fs = require('node:fs'), R = process.argv[1];
const w = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }; w.window = w; vm.createContext(w);
vm.runInContext(fs.readFileSync(R + '/web/themes.js', 'utf8'), w);
const B = require(R + '/web/basemap.js'), T = w.ApexThemes;
const out = {};
for (const id of ['roadbook', 'tapedeck', 'billet']) for (const mode of ['day', 'night']) {
  const P = T.get(id).map[mode];
  out[id + '.' + mode] = { land: P.land, casing: P.casing, road: P.road, b: B.buildingColour(P) };
}
out.mix = [B.mix('#000000', '#ffffff', 0.5), B.mix('#102030', '#102030', 0.3), B.mix('red', '#ffffff', 0.5)];
console.log(JSON.stringify(out));
"""


def lum(c):
    r, g, b = (int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


@pytest.fixture(scope="module")
def got():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def test_mix(got):
    assert got["mix"] == ["#808080", "#102030", "red"]


def test_buildings_sit_between_land_and_ink_on_every_theme(got):
    for k in [k for k in got if "." in k]:
        v = got[k]
        lo, hi = sorted((lum(v["land"]), lum(v["casing"])))
        b = lum(v["b"])
        assert lo <= b <= hi, k
        # a block stands off the land, but stays nearer the land than the ink
        assert abs(b - lum(v["land"])) > 0.005, k
        assert abs(b - lum(v["land"])) < abs(b - lum(v["casing"])), k
