"""Your year on the road (web/year_review.js, IDEAS D-24): only this year's drives with a known date; totals, months,
roads driven twice or more, best score and longest drive; no year, no summary; never speed or time."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const Y = require(process.argv[1] + '/web/year_review.js');
const MI = 1609.344, d = (name, date, mi, score, corners, extra = {}) => ({ name, date, dist: [0, mi * MI], ds: { score }, corners: Array(corners).fill({}), ...extra });
const drives = [
  d('Tail of the Dragon', '2026-04-02T10:00', 11, 702, 40), d('Tail of the Dragon', '2026-06-12T09:00', 11.2, 744, 41),
  d('Cherohala Skyway', '2026-06-20T08:00', 43.4, null, 60), d('Drive 4', '2026-09-01T08:00', 5, 610, 8),
  d('Old import', '2026-01-01T00:00:00Z', 900, 999, 500, { dateKnown: false }), d('Last year', '2025-11-01T10:00', 50, 900, 50),
];
const s = Y.summary(drives, 2026);
console.log(JSON.stringify({ s, lines: Y.lines(s), none: Y.summary(drives, 2024), unscored: Y.summary([d('X', '2026-01-02T10:00', 3, null, 2)], 2026) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_year_summary(out):
    s = out["s"]
    assert s["drives"] == 4 and s["miles"] == 71 and s["corners"] == 149 and s["months"] == 3
    assert s["topRoads"] == [{"name": "Tail of the Dragon", "times": 2}]
    assert s["best"] == {"name": "Tail of the Dragon", "score": 744, "date": "2026-06-12"}
    assert s["longest"] == {"name": "Cherohala Skyway", "miles": 43.4}


def test_lines_and_unknowns(out):
    assert out["lines"][0] == "71 mi in 4 drives · 149 corners · 3 months on the road"
    assert out["none"] is None
    assert out["unscored"]["best"] is None
    text = " ".join(out["lines"]).lower()
    assert "mph" not in text and "speed" not in text and "fastest" not in text
