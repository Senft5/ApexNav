"""The GPS accuracy disc round the idle arrow (web/gps_halo.js): as wide on the map as the fix's accuracy, none when the
accuracy is unknown or the disc would stay under the arrow."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
ROOT = Path(__file__).resolve().parents[1]

RUNNER = r"""
const H = require(process.argv[1] + '/web/gps_halo.js');
console.log(JSON.stringify({
  mpp: [H.metresPerPx(0, 0), H.metresPerPx(60, 0), H.metresPerPx(39.1, 16)],
  r: [H.radiusPx(65, 39.1, 16), H.radiusPx(65, 39.1, 17), H.radiusPx(5, 39.1, 16), H.radiusPx(1e6, 39.1, 20)],
  none: [H.radiusPx(null, 39.1, 16), H.radiusPx(NaN, 39.1, 16), H.radiusPx(-3, 39.1, 16), H.radiusPx(50, 90, 16), H.radiusPx(50, 39.1, undefined)],
}));
"""


@pytest.fixture(scope="module")
def out():
    if not NODE:
        pytest.skip("node not installed")
    return json.loads(subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, check=True).stdout)


def test_metres_per_pixel(out):
    eq, sixty, cincy = out["mpp"]
    assert abs(eq - 78271.517) < 0.01                    # the 512 px world at zoom 0
    assert abs(sixty - eq / 2) < 0.01                    # half as many at 60 degrees
    assert 0.9 < cincy < 1.0                             # about a metre a pixel at street zoom in Cincinnati


def test_radius_follows_accuracy_and_zoom(out):
    r16, r17, small, huge = out["r"]
    assert 65 < r16 < 75 and abs(r17 - 2 * r16) <= 1      # twice as wide a zoom in
    assert small == 0                                     # 5 m stays under the arrow: no disc
    assert huge == 1600                                   # capped


def test_unknown_draws_nothing(out):
    assert out["none"] == [0, 0, 0, 0, 0]
