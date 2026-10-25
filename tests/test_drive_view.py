"""Drive view (web/drive_view.js): summary numbers are computed from the data, never invented."""
import json
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const Core = require(process.argv[1] + '/web/apex_core.js');
const V = require(process.argv[1] + '/web/drive_view.js');
const n = 400, speed = Array.from({ length: n }, (_, i) => 10 + (i % 50) / 5);
const d = { lat: speed.map((_, i) => 35 + i * 5 / 110540), lon: speed.map(() => -83), dist: speed.map((_, i) => i * 5), speed_mps: speed,
  lat_g: speed.map((_, i) => 0.3 * Math.sin(i / 10)), lon_g: speed.map((_, i) => (i === 100 ? -0.5 : 0.05)), elev: speed.map((_, i) => 100 + i * 0.5 - (i > 200 ? (i - 200) * 1.5 : 0)), corners: [] };
const full = V.summarize(d, Core);
const bare = V.summarize({ ...d, lat_g: null, lon_g: null, elev: null }, Core);
console.log(JSON.stringify({ full, bare }));
"""


@pytest.fixture(scope="module")
def r():
    root = str(__import__("pathlib").Path(__file__).resolve().parents[1])
    p = subprocess.run([NODE, "-e", RUNNER, root], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_summary_numbers(r):
    f = r["full"]
    assert f["km"] == pytest.approx(1.995, abs=0.01)
    assert f["top_mps"] == pytest.approx(19.8, abs=0.01)
    assert f["peak_lat_g"] == pytest.approx(0.3, abs=0.01)
    assert f["peak_brake_g"] == pytest.approx(0.5)
    assert f["climb_m"] == pytest.approx(100.0, abs=1.0)        # only climbing counts: the descent is excluded


def test_missing_channels_stay_unknown(r):
    b = r["bare"]
    assert b["peak_lat_g"] is None and b["peak_brake_g"] is None and b["climb_m"] is None
