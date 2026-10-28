"""Driving side (web/driving_side.js, IDEAS U-22): left in the countries that drive on the left, right elsewhere, and a choice
in Settings overrides it."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PLACES = {
    "London": (51.507, -0.128, "left"), "Snowdonia": (53.07, -3.9, "left"), "Dublin": (53.35, -6.26, "left"),
    "Tokyo": (35.68, 139.69, "left"), "Sydney": (-33.87, 151.21, "left"), "Queenstown": (-45.03, 168.66, "left"),
    "Mumbai": (19.08, 72.88, "left"), "Cape Town": (-33.92, 18.42, "left"), "Nairobi": (-1.29, 36.82, "left"),
    "Bangkok": (13.76, 100.5, "left"), "Hong Kong": (22.32, 114.17, "left"), "Kingston": (17.97, -76.79, "left"),
    "Calais": (50.95, 1.86, "right"), "Boulogne": (50.73, 1.61, "right"), "Paris": (48.86, 2.35, "right"),
    "Knoxville": (35.96, -83.92, "right"), "Miami": (25.76, -80.19, "right"), "Stelvio": (46.53, 10.45, "right"),
    "Shenzhen": (22.6, 114.06, "right"), "Toronto": (43.65, -79.38, "right"), "Big Sur": (36.27, -121.81, "right"),
}

RUNNER = r"""
const S = require(process.argv[1] + '/web/driving_side.js');
const places = JSON.parse(process.argv[2]);
const m = new Map(), st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
const got = Object.fromEntries(Object.entries(places).map(([k, [la, lo]]) => [k, S.at(la, lo)]));
const auto = S.forRoute(51.5, -0.1, st); S.setChoice('right', st); const forced = S.forRoute(51.5, -0.1, st); S.setChoice('auto', st);
console.log(JSON.stringify({ got, unknown: S.at(NaN, 1), auto, forced, back: S.choice(st) }));
"""


def test_sides():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT, json.dumps(PLACES)], capture_output=True, text=True, check=True).stdout)
    assert out["got"] == {k: v[2] for k, v in PLACES.items()}
    assert out["unknown"] is None
    assert [out["auto"], out["forced"], out["back"]] == ["left", "right", "auto"]
