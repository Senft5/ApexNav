"""Your taste in roads (web/taste.js, IDEAS R-33): answers about which road was better teach weights per axis, a route that
suits them gets a few fun points, and nothing changes under five answers."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const Core = require(process.argv[1] + '/web/apex_core.js'), T = require(process.argv[1] + '/web/taste.js');
let st = { pairs: [] };
// a driver who always picks the flowing road over the technical one
for (let i = 0; i < 8; i++) st = T.record(st, { tech: 30, flow: 80, smooth: 60 }, { tech: 85, flow: 35, smooth: 60 });
const few = T.fit({ pairs: st.pairs.slice(0, 4) }), t = T.fit(st);
const flowy = { tech: 30, flow: 85, smooth: null }, techy = { tech: 90, flow: 30, smooth: null };
// features from a real shape: alternating bends
const lat = [], lon = []; let x = 0, y = 0, h = 0;
for (let k = 0; k < 12; k++) for (let i = 0; i < 30; i++) { h += (k % 2 ? 1 : -1) * 0.02; x += 5 * Math.cos(h); y += 5 * Math.sin(h); lat.push(35 + y / 110540); lon.push(-83 + x / 91190); }
const f = T.featuresOf(Core, { lat, lon, rough: Array(lat.length).fill(0.1) });
console.log(JSON.stringify({ few, t, line: T.describe(t), plus: T.bonus(t, flowy), minus: T.bonus(t, techy), none: T.bonus(null, flowy), f }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_learns_a_flow_lover(out):
    assert out["few"] is None, "under five answers: no taste yet"
    t = out["t"]
    assert t["flow"] > t["tech"] and abs(t["tech"] + t["flow"] + t["smooth"] - 1) < 0.02 and t["votes"] == 8
    assert out["line"].startswith("From 8 answers you lean toward flowing roads")


def test_routes_that_suit_you_gain_a_little(out):
    assert 0 < out["plus"] <= 8 and -8 <= out["minus"] < 0 and out["none"] == 0


def test_features_from_a_drive(out):
    f = out["f"]
    assert 0 <= f["tech"] <= 100 and 0 <= f["flow"] <= 100 and f["smooth"] == 93
