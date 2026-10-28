"""Search that knows roads (web/place_search.js, IDEAS U-19): your stages and spots by name first; undrivable map hits left out."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const S = require(process.argv[1] + '/web/place_search.js');
const stages = [{ name: 'Tail of the Dragon (US 129)', lat0: 35.47, lon0: -83.92 }, { name: 'Esses', lat0: 1, lon0: 1 }, { name: 'Broken', lat0: null, lon0: 1 }];
const spots = [{ name: 'Dragon overlook', lat: 35.5, lon: -83.9 }, { name: 'Café Crème', lat: 2, lon: 2 }];
const f = (key, value) => ({ properties: { osm_key: key, osm_value: value } });
console.log(JSON.stringify({
  dragon: S.localMatches('tail dragon', stages, spots), any: S.localMatches('DRAGON', stages, spots).map((p) => p.label),
  accent: S.localMatches('cafe creme', stages, spots).map((p) => p.label), short: S.localMatches('e', stages, spots),
  drivable: [f('highway', 'cycleway'), f('highway', 'secondary'), f('shop', 'clothes'), f('highway', 'path'), {}].map(S.drivable),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_local_names(out):
    assert out["dragon"] == [{"label": "Tail of the Dragon (US 129)", "lat": 35.47, "lon": -83.92, "kind": "Your stage"}]
    assert out["any"] == ["Tail of the Dragon (US 129)", "Dragon overlook"]
    assert out["accent"] == ["Café Crème"] and out["short"] == []


def test_drivable(out):
    assert out["drivable"] == [False, True, True, False, True]
