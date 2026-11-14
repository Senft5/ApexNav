"""The road's surface on a drive (web/road_surface.js): the worst of the weather and ODOT's sensors near you, kept on the
record; passes compare like with like; unknown is never dry."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const S = require(process.argv[1] + '/web/road_surface.js');
const ev = [{ kind: 'wet', src: 'ODOT sensor', lat: 40.05, lon: -83.0 }, { kind: 'ice', src: 'ODOT sensor', lat: 40.5, lon: -83.0 },
  { kind: 'ice', src: 'INDOT', lat: 40.0, lon: -83.0 }, { kind: 'crash', src: 'ODOT', lat: 40.0, lon: -83.0 }];
const log = S.createLog(); const seen = [log.value(), log.see(null), log.see('dry'), log.see('wet'), log.see('dry'), log.see('ice'), log.see('wet')];
console.log(JSON.stringify({
  worse: [S.worse(null, null), S.worse('dry', null), S.worse(null, 'wet'), S.worse('wet', 'dry'), S.worse('wet', 'ice'), S.worse('snow', 'dry')],
  near: S.sensorAt(ev, 40.0, -83.0), far: S.sensorAt(ev, 41.5, -83.0), bad: S.sensorAt(null, 40, -83), seen,
  alike: [S.alike('dry', null), S.alike(null, null), S.alike('wet', 'wet'), S.alike('wet', 'dry'), S.alike('wet', null), S.alike('ice', 'wet')],
  label: [S.label('dry'), S.label('wet'), S.label('ice'), S.label(null), S.label('mud')], of: [S.of({ surface: 'wet' }), S.of({}), S.of(null)] }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_worst_of_the_drive(out):
    assert out["worse"] == [None, "dry", "wet", "wet", "ice", "dry"]
    assert out["seen"] == [None, None, "dry", "wet", "wet", "ice", "ice"]


def test_sensors_near_you_only(out):
    # the wet sensor 5.5 km away counts; the icy one 55 km away doesn't; an INDOT ice event is a report, not a sensor
    assert out["near"] == "wet" and out["far"] is None and out["bad"] is None


def test_like_with_like(out):
    assert out["alike"] == [True, True, True, False, False, False]
    assert out["label"] == ["", "Wet road", "Icy road", "", ""] and out["of"] == ["wet", None, None]
