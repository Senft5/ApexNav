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


PICKS = r"""
const T = require(process.argv[1] + '/web/taste.js');
const flowy = { tech: 30, flow: 80, smooth: null }, techy = { tech: 85, flow: 35, smooth: null };
let st = { pairs: [] };
const same = T.recordPick(st, flowy, { ...flowy });                        // two roads alike: nothing learned
const steps = [];
for (let i = 0; i < 10; i++) { st = T.recordPick(st, flowy, techy); steps.push(T.fit(st)); }
let mixed = { pairs: [] };
for (let i = 0; i < 3; i++) mixed = T.record(mixed, flowy, techy);
for (let i = 0; i < 4; i++) mixed = T.recordPick(mixed, flowy, techy);
console.log(JSON.stringify({ same: same === st || same.pairs.length === 0, nine: steps[8], ten: steps[9], mixed: T.fit(mixed), line: T.describe(T.fit(mixed)),
  lean: T.leanOf(flowy, techy), noLean: T.leanOf(flowy, { tech: 31, flow: 79, smooth: null }), picks: st.picks, old: T.fit({ pairs: Array(5).fill([0.5, -0.5, 0]) }) }));
"""


def test_routes_you_choose_teach_your_taste_at_half_an_answer():
    """A route you start over the one Vetta put first counts half an answer: ten picks (or answers and picks adding to
    five) make a taste; two roads alike teach nothing; the line says where the taste came from; old answers still fit."""
    r = json.loads(subprocess.run([NODE, "-e", PICKS, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["same"]
    assert r["nine"] is None and r["ten"] is not None
    assert r["ten"]["flow"] > r["ten"]["tech"] and r["ten"]["picks"] == 10 and r["ten"]["votes"] == 0
    assert r["mixed"] is not None and r["mixed"]["votes"] == 3 and r["mixed"]["picks"] == 4
    assert r["line"].startswith("From 3 answers and 4 routes you chose you lean toward flowing roads")
    assert r["lean"] == "flowing" and r["noLean"] is None
    assert r["picks"] == 10
    assert r["old"]["votes"] == 5 and r["old"]["picks"] == 0
