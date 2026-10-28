"""Road pages (web/road_page.js, IDEAS Q-13): archetype, axes, confidence and climb for a stage; unknown stays unknown."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const Core = require(process.argv[1] + '/web/apex_core.js'), P = require(process.argv[1] + '/web/road_page.js');
// switchbacks: a climb of tight alternating hairpins
const lat = [], lon = [];
let x = 0, y = 0, h = Math.PI / 2;
const step = (n, turn) => { for (let i = 0; i < n; i++) { h += turn; x += 5 * Math.cos(h); y += 5 * Math.sin(h); lat.push(35 + y / 110540); lon.push(-83 + x / (111320 * Math.cos(35 * Math.PI / 180))); } };
step(20, 0);
for (let k = 0; k < 8; k++) { step(10, (k % 2 ? 1 : -1) * Math.PI / 10); step(16, 0); }
step(20, 0);
const s = { lat, lon, name: 'Test Pass', junctionsPerKm: 0.4 };
const rs = Core.resamplePolyline(lat, lon, 5);
const elev = rs.lat.map((_, i) => 600 + i * 0.6);
const d = P.describe(Core, s, { elev, measured: { coverage: 0.7, avgPasses: 3 }, surf: 82 });
const bare = P.describe(Core, { lat, lon }, {});
console.log(JSON.stringify({ d, bare, head: P.headline(d), rows: P.rows(bare) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_a_switchback_climb(out):
    d = out["d"]
    assert d["archetype"] == "Switchbacks" and d["hairpins"] >= 4
    assert d["confidence"] == "L2" and d["surf"] == 82 and d["clear"] == 90
    assert d["climb"] > 100 and d["drop"] == 0
    assert out["head"].startswith("Switchbacks · ") and "climbing" in out["head"]
    assert 0 <= d["tech"] <= 100 and 0 <= d["flow"] <= 100


def test_unknown_stays_unknown(out):
    b = out["bare"]
    assert b["confidence"] == "L0" and b["surf"] is None and b["clear"] is None and b["climb"] is None
    rows = dict(out["rows"])
    assert rows["SURF"] == "--" and rows["CLEAR"] == "--" and rows["Confidence"].startswith("L0")


CHAR_RUNNER = r"""
const Core = require(process.argv[1] + '/web/apex_core.js'), P = require(process.argv[1] + '/web/road_page.js');
// 3 km straight, then alternating bends (esses) for about 1.4 km, then 3 km straight
const lat = [], lon = []; let x = 0, y = 0, h = Math.PI / 2;
const step = (n, turn) => { for (let i = 0; i < n; i++) { h += turn; x += 5 * Math.cos(h); y += 5 * Math.sin(h); lat.push(35 + y / 110540); lon.push(-83 + x / 91190); } };
step(600, 0); for (let k = 0; k < 14; k++) step(20, (k % 2 ? 1 : -1) * 0.06); step(600, 0);
const rs = Core.resamplePolyline(lat, lon, 5), { kappa } = Core.computeCurvature(rs.lat, rs.lon);
const t = { kappa: Array.from(kappa), sightM: Array.from(Core.sightDistanceM(rs.lat, rs.lon)) };
const ch = P.character(Core, t);
console.log(JSON.stringify({ ch, line: P.characterLine(ch), none: P.characterLine([{ archetype: 'Fast open', startM: 0, endM: 9000 }]) }));
"""


def test_route_character():
    out = json.loads(subprocess.run([NODE, "-e", CHAR_RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    arches = [c["archetype"] for c in out["ch"]]
    assert len(arches) >= 3 and arches[0] == arches[-1] and arches[1] != arches[0], arches
    mid = out["ch"][1]
    assert 2500 <= mid["startM"] <= 3100 and 1000 <= mid["endM"] - mid["startM"] <= 2200
    assert out["line"].startswith(f"{mid['archetype']} ") and (" at 3." in out["line"] or " at 2." in out["line"]), out["line"]
    assert out["none"] == "", "plain road: nothing to say"
