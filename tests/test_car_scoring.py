"""Scores per car (IDEAS D-19): a drive keeps the car it was driven in, and its corners are scored against that car's grip,
only ever gentler than the street default; a drive without a car scores as recorded."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
globalThis.ApexCore = require(process.argv[1] + '/web/apex_core.js');
const R = require(process.argv[1] + '/web/recording.js');
const events = [{ type: 'corner', start_m: 0, end_m: 40, index: 4, apex_mph: 40, code: 'L4', call: 'left 4', dir: 'L', severity: 4, turn_rad: 1 }, { type: 'hazard' }];
const plain = R.cornersOf({ events }), tall = R.cornersOf({ events, car: { label: 'Tacoma', mu: 0.52 } }), sporty = R.cornersOf({ events, car: { label: 'GT3', mu: 0.9 } });
console.log(JSON.stringify({ plain: plain[0].apex_mps, tall: tall[0].apex_mps, sporty: sporty[0].apex_mps, n: plain.length }));
"""


def test_corners_scored_for_the_car():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["n"] == 1
    assert out["tall"] == pytest.approx(out["plain"] * (0.52 / 0.6) ** 0.5)
    assert out["sporty"] == out["plain"], "a grippier car never raises the limit"


def test_the_drive_keeps_its_car():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert "d.car = { label: car.label, mu: Core.carGrip(car) }" in html
