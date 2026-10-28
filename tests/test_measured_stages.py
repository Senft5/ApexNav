"""Measured road feel and confirmed hazards in stage discovery (web/measured_stages.js, IDEAS R-04): a stage the crowd found
broken drops below a slightly worse-scored smooth one, banking helps a little, a confirmed hazard costs points, a closure
removes the stage, and an unmeasured stage keeps its map score exactly."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const M = require(process.argv[1] + '/web/measured_stages.js');
const M_LAT = 110540;
// three parallel 2 km stages running north, 1 km apart; 5 m spacing
const stage = (lon, score, name) => ({ name, score, lat: Array.from({ length: 400 }, (_, i) => 35 + i * 5 / M_LAT), lon: Array(400).fill(lon) });
const A = stage(-83.00, 10, 'rough'), B = stage(-82.989, 9, 'smooth'), C = stage(-82.978, 8, 'nobody');
const line = (lon, from = 0, to = 2000) => [[35 + from / M_LAT, lon], [35 + to / M_LAT, lon]];
const ways = [
  { way: 1, line: line(-83.00 + 0.00005), passes: [2, 0], rough: [0.45, null], banked: [0, null], offCamber: [0.1, null] },   // 4 m off the stage
  { way: 2, line: line(-82.989), passes: [3, 2], rough: [0.05, 0.06], banked: [0.4, 0.3], offCamber: [0, 0] },
  { way: 3, line: line(-82.95), passes: [5, 5], rough: [0.5, 0.5], banked: [0, 0], offCamber: [0, 0] },                      // on no stage
];
const ranked = M.rescore([A, B, C], ways, []);
const partial = M.measuredOn(stage(-83.00, 10), [{ ...ways[0], line: line(-83.00, 0, 300) }]);   // 15 % measured: not enough
const half = M.measuredOn(stage(-83.00, 10), [{ ...ways[0], line: line(-83.00, 0, 1000) }]);
const hz = (kind, confirms, clears, lon) => ({ kind, confirms, clears, lat: 35 + 1000 / M_LAT, lon: lon + 0.0001 });   // ~9 m off
const withHaz = M.rescore([A, B, C], [], [hz('gravel', 2, 0, -82.989), hz('pothole', 1, 0, -82.978), hz('closure', 1, 0, -83.00), hz('debris', 3, 3, -82.989)]);
console.log(JSON.stringify({
  order: ranked.map((s) => s.name), A: ranked.find((s) => s.name === 'rough'), B: ranked.find((s) => s.name === 'smooth'),
  C: ranked.find((s) => s.name === 'nobody'), sameC: ranked.find((s) => s.name === 'nobody') === C, partial, half,
  haz: withHaz.map((s) => [s.name, s.score, s.hazards || null]), noData: M.rescore([A, B], null, null).map((s) => s.score),
  boxes: M.boxesFor({ lat: 35, lon: -83 }, 14), big: M.boxesFor({ lat: 35, lon: -83 }, 120),
}));
"""


def run():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_measurements_reorder_stages():
    r = run()
    assert r["order"] == ["smooth", "nobody", "rough"]                     # broken pavement falls below a decent unmeasured road
    assert r["A"]["measured"]["share"] == 1 and r["A"]["measured"]["rough"] == pytest.approx(0.45)
    assert r["A"]["score"] == pytest.approx(10 - 5 - 0.33, abs=0.01)     # half its score for broken pavement, a bit for off-camber
    assert r["B"]["score"] > 9 and r["B"]["measuredAdj"] == pytest.approx(2 * (0.08 - 0.055) / 0.03 + 1, abs=0.01)
    assert r["sameC"] and "measured" not in r["C"]                         # unmeasured: untouched, never guessed
    assert r["partial"] is None and r["half"]["share"] == pytest.approx(0.5, abs=0.02)


def test_hazards_and_missing_data():
    r = run()
    names = [h[0] for h in r["haz"]]
    assert "rough" not in names                                            # a closure on it: out
    smooth = next(h for h in r["haz"] if h[0] == "smooth")
    assert smooth[1] == 9 - 3 and smooth[2] == ["gravel"]                 # confirmed gravel; outvoted debris doesn't count
    nobody = next(h for h in r["haz"] if h[0] == "nobody")
    assert nobody[1] == 8 and nobody[2] is None                            # one unconfirmed pothole report: nothing
    assert r["noData"] == [10, 9]


def test_boxes():
    r = run()
    assert len(r["boxes"]) == 1 and r["big"] is None
    s, w, n, e = r["boxes"][0]
    assert n - s <= 0.5 and e - w <= 0.5
