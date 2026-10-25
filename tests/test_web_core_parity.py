"""web/apex_core.js must compute exactly what core/road_dna.py computes."""
import json
import math
import os
import shutil
import subprocess

import numpy as np
import pytest

from core import road_dna as rd
from tests.synthetic import path_from_legs

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

JS_RUNNER = r"""
const core = require(process.argv[1]);
const inp = JSON.parse(require('fs').readFileSync(0, 'utf8'));
let lat = inp.lat, lon = inp.lon;
if (inp.resample) ({ lat, lon } = core.resamplePolyline(lat, lon, 5));
const { kappa, ds } = core.computeCurvature(lat, lon);
const env = core.brakingEnvelopeMps(kappa, ds, inp.camber, inp.rough);
const corners = core.detectCorners(kappa, ds, inp.camber, inp.crest, inp.rough)
  .map(c => Object.assign(c, { text: core.paceNoteText(c) }));
process.stdout.write(JSON.stringify({ lat, kappa: Array.from(kappa), env: Array.from(env), corners }));
"""


def _run_js(payload: dict) -> dict:
    core_path = os.path.abspath("web/apex_core.js")
    out = subprocess.run([NODE, "-e", JS_RUNNER, core_path], input=json.dumps(payload),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def _assert_parity(lat, lon, camber=None, crest=None, rough=None, resample=False):
    payload = {"lat": list(map(float, lat)), "lon": list(map(float, lon)), "resample": resample,
               "camber": None if camber is None else list(map(float, camber)),
               "crest": None if crest is None else list(map(float, crest)),
               "rough": None if rough is None else list(map(float, rough))}
    js = _run_js(payload)
    if resample:
        lat, lon = rd.resample_polyline(lat, lon, 5.0)
        np.testing.assert_allclose(js["lat"], lat, atol=1e-10)
    kappa, ds = rd.compute_curvature(lat, lon)
    env = rd.braking_envelope_mps(kappa, ds, camber, rough)
    corners = rd.detect_corners(kappa, ds, camber, crest, rough)
    np.testing.assert_allclose(js["kappa"], kappa, atol=1e-9)
    np.testing.assert_allclose(js["env"], env, rtol=1e-9)
    assert len(js["corners"]) == len(corners)
    for a, b in zip(js["corners"], corners):
        assert (a["start"], a["apex"], a["end"], a["dir"], a["severity"], a["mods"]) == \
               (b["start"], b["apex"], b["end"], b["dir"], b["severity"], b["mods"])
        assert a["apex_mps"] == pytest.approx(b["apex_mps"], rel=1e-9)
        assert tuple(a["text"].values()) == rd.pace_note_text(b)
    return corners


def test_parity_on_synthetic_stage_with_noise():
    legs = [("straight", 250.0), ("arc", 20.0, 150.0), ("straight", 120.0), ("arc", 70.0, -80.0),
            ("arc", 35.0, -50.0), ("straight", 300.0), ("arc", 200.0, 45.0), ("straight", 200.0)]
    lat, lon = path_from_legs(legs, noise_m=0.6)
    n = len(lat)
    rng = np.random.default_rng(11)
    camber = np.radians(rng.normal(0.0, 2.0, n))
    crest = rng.normal(0.0, 0.04, n)
    rough = np.abs(rng.normal(0.06, 0.05, n))
    assert len(_assert_parity(lat, lon)) >= 3
    _assert_parity(lat, lon, camber, crest, rough)


def test_parity_on_irregular_polyline_like_osrm():
    lat, lon = path_from_legs([("straight", 400.0), ("arc", 60.0, 100.0), ("straight", 400.0)], step_m=1.0)
    keep = np.unique(np.concatenate([[0], np.sort(np.random.default_rng(5).choice(len(lat), 90, replace=False)),
                                     [len(lat) - 1]]))
    _assert_parity(lat[keep], lon[keep], resample=True)


def test_parity_on_real_logged_drive():
    path = "web/data/pebble_ridge.js"
    if not os.path.exists(path):
        pytest.skip("no shipped drive data")
    text = open(path, encoding="utf-8").read()
    d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
    f = {name: i for i, name in enumerate(d["fields"])}
    rows = np.array(d["rows"][:2500], dtype=float)
    _assert_parity(rows[:, f["lat"]], rows[:, f["lon"]], np.radians(rows[:, f["camber_deg"]]),
                   rows[:, f["crest_vertical_g"]], rows[:, f["roughness_rms"]])
    assert math.isfinite(rows[:, f["lat"]].sum())
