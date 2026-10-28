"""web/format.js: 12-hour times everywhere (owner 2026-10-26)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

SCRIPT = r"""
const F = require('./web/format.js');
console.log(JSON.stringify({
  clock: [[0, 5], [9, 0], [12, 0], [17, 3], [23, 59], [null, 1]].map(([h, m]) => F.clock12(h, m)),
  dateTime: ['2026-10-26T17:03', '2026-10-26T00:15:09', '2026-10-26', '', 'nonsense'].map(F.dateTime),
  names: ['Drive 10/26/2026 17:03', 'Drive 10/26/2026 09:41', 'Dry Ridge', 'Drive 10/26/2026 5:03 PM', 'web_20261027_080000', 'web_20261027_1703', 'my web_20261027_080000'].map(F.driveName),
}));
"""


def test_twelve_hour_formatting():
    root = Path(__file__).resolve().parents[1]
    p = subprocess.run([NODE, "-e", SCRIPT], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout)
    assert r["clock"] == ["12:05 AM", "9:00 AM", "12:00 PM", "5:03 PM", "11:59 PM", "--"]
    assert r["dateTime"] == ["2026-10-26 5:03 PM", "2026-10-26 12:15 AM", "2026-10-26", "--", "--"]
    assert r["names"] == ["Drive 10/26/2026 5:03 PM", "Drive 10/26/2026 9:41 AM", "Dry Ridge", "Drive 10/26/2026 5:03 PM", "Drive 10/27/2026 8:00 AM", "web_20261027_1703", "my web_20261027_080000"]
