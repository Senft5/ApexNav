"""The one roughness scale (web/roughness.js, tools/rough_scale.py): roamer A, 2026-11-15, found real bins never reached the
old 0.22 / 0.30 g "rough", so nothing was ever rough."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from tools import rough_scale as rs

WEB = Path(__file__).resolve().parents[1] / "web"
NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_scale_says_smooth_fair_rough_and_unknown_stays_unknown():
    js = """const R = require(process.argv[1]); const g = [null, NaN, -1, 0, 0.02, 0.034, 0.05, 0.068, 0.11, 0.2];
console.log(JSON.stringify({ level: g.map(R.level), surface: g.map(R.surface), bad: g.map(R.badness), glass: g.map(R.glass),
  scale: [R.SMOOTH_G, R.ROUGH_G, R.VERY_ROUGH_G] }))"""
    o = json.loads(subprocess.run([NODE, "-e", js, str(WEB / "roughness.js")], capture_output=True, text=True, check=True).stdout)
    assert o["level"] == [None, None, None, "smooth", "smooth", "smooth", "fair", "rough", "rough", "rough"]
    assert o["surface"][:3] == [None, None, None] and o["surface"][3:6] == [100, 100, 100] and o["surface"][8:] == [0, 0]
    assert 0 < o["surface"][6] < 100 and o["surface"][6] > o["surface"][7]
    assert o["glass"][3] == 1 and o["glass"][5] == 0 and o["bad"][5] == 0 and o["bad"][8] == 1
    s, r, vr = o["scale"]
    assert 0 < s < r < vr < 0.19, "inside what phones measure (the roughest production bin read 0.19 g)"


def test_the_scale_is_read_from_the_measured_spread():
    rng = np.random.default_rng(1)
    rows = [{"way_id": i // 20, "n": 2, "rough_mean": float(x)} for i, x in enumerate(rng.lognormal(np.log(0.04), 0.35, 4000))]
    sc = rs.percentile_scale(rows)
    assert sc["smooth"] < 0.04 < sc["rough"] < sc["very_rough"] and sc["bins"] == 4000
    with pytest.raises(ValueError):
        rs.percentile_scale(rows[:10])


def test_known_roads_move_the_rough_line_between_them_or_say_they_cannot():
    base = {"smooth": 0.034, "rough": 0.068, "very_rough": 0.11, "bins": 1}
    rows = [{"way_id": 1, "n": 3, "rough_mean": 0.02 + 0.001 * k} for k in range(10)] + \
           [{"way_id": 2, "n": 3, "rough_mean": 0.08 + 0.002 * k} for k in range(10)]
    fit = rs.fit_to_truth(rows, {"smooth": [1], "rough": [2]}, base)
    assert 0.03 < fit["rough"] < 0.08 and fit["smooth"] < fit["rough"] < fit["very_rough"] and "fitted" in fit["fit"]
    overlap = rows + [{"way_id": 2, "n": 3, "rough_mean": 0.015} for _ in range(10)]
    assert rs.fit_to_truth(overlap, {"smooth": [1], "rough": [2]}, base)["rough"] == 0.068
    assert "stands" in rs.fit_to_truth(rows, {"smooth": [9], "rough": [2]}, base)["fit"]
