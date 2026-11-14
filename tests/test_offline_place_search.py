"""Where to? with no signal (web/place_search.js mapMatches, IDEAS F-02): towns and places from the map kept on the phone
whose name holds every word typed, nearest first, one row per name within 1 km."""
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
const near = { lat: 35.36, lon: -84.29 };
const feats = [
  { name: 'Tellico Plains', lat: 35.366, lon: -84.296, kind: 'Town' },
  { name: 'Tellico Plains', lat: 35.367, lon: -84.297, kind: 'Place' },     // the same town again (a node and a label)
  { name: 'Tellico Plains', lat: 35.9, lon: -84.29, kind: 'Village' },      // another of that name, 60 km off: its own row
  { name: 'Tellico Beach Café', lat: 35.4, lon: -84.3, kind: 'Cafe' },
  { name: 'Shell', lat: 35.362, lon: -84.292, kind: 'Fuel' },
  { name: null, lat: 35.36, lon: -84.29 }, { name: 'Tellico x', lat: NaN, lon: 1 }];
console.log(JSON.stringify({
  tellico: S.mapMatches('tellico', feats, near).map((p) => [p.label, p.kind, Math.round(p.km)]),
  words: S.mapMatches('plains TELLICO', feats, near).length, accent: S.mapMatches('beach cafe', feats, near).map((p) => p.label),
  short: S.mapMatches('t', feats, near), noNear: S.mapMatches('shell', feats, null), max: S.mapMatches('tellico', feats, near, 1).length }));
"""


def test_map_matches():
    r = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["tellico"] == [["Tellico Plains", "Town", 1], ["Tellico Beach Café", "Cafe", 5], ["Tellico Plains", "Village", 60]]
    assert r["words"] == 2 and r["accent"] == ["Tellico Beach Café"]
    assert r["short"] == [] and r["noNear"] == [] and r["max"] == 1
