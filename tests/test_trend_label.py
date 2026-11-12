"""Your driving's month-by-month trend label: each month's sample size, and the month under way marked "so far"."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")


def test_trend_label_says_sample_and_incomplete_month():
    js = r"""
const P = require(process.argv[1] + '/web/driver_profile.js');
const rows = [{ month: '2026-09', level: 52, n: 40 }, { month: '2026-10', level: 55, n: 1 }, { month: '2026-11', level: 61, n: 12 }];
console.log(JSON.stringify([P.trendLabel(rows, new Date(2026, 10, 12)), P.trendLabel(rows, new Date(2026, 11, 2))]));
"""
    root = str(Path(__file__).resolve().parents[1])
    now, later = json.loads(subprocess.run([NODE, "-e", js, root], capture_output=True, text=True, check=True).stdout)
    assert now == "Sep 2026 52, 40 corners; Oct 2026 55, 1 corner; Nov 2026 so far 61, 12 corners"
    assert later == "Sep 2026 52, 40 corners; Oct 2026 55, 1 corner; Nov 2026 61, 12 corners"
