"""Battery per hour of driving (web/battery_budget.js, IDEAS P-01): from start and end levels; a charging, short or unknown
drive says nothing; drives combine weighted by time."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const B = require(process.argv[1] + '/web/battery_budget.js');
let s = null;
for (let m = 0; m <= 40; m++) s = B.feed(s, 0.9 - m * 0.003, false, m * 60000);         // 12 % in 40 min
const drive = B.summary(s);
let c = B.feed(null, 0.5, false, 0); c = B.feed(c, 0.55, true, 30 * 60000);
let short = B.feed(null, 0.8, false, 0); short = B.feed(short, 0.79, false, 5 * 60000);
let none = B.feed(null, null, false, 0); none = B.feed(none, -1, false, 60 * 60000);
console.log(JSON.stringify({ drive, charged: B.summary(c), short: B.summary(short), none: B.summary(none),
  overall: B.overall([{ battery: drive }, { battery: { usedPct: 10, minutes: 20, perHour: 30 } }, {}]) }));
"""


def test_battery():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["drive"] == {"usedPct": 12.0, "minutes": 40, "perHour": 18.0}
    assert out["charged"] is None and out["short"] is None and out["none"] is None
    assert out["overall"] == {"perHour": 22.0, "drives": 2, "minutes": 60}
