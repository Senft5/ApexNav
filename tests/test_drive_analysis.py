import numpy as np
import pytest

from core import drive_analysis as da
from tests.synthetic import path_from_legs


def _drive(speed_scale=1.0, stop_at=None):
    lat, lon = path_from_legs([("straight", 400.0), ("arc", 40.0, 90.0), ("straight", 400.0)])
    n = len(lat)
    v = np.full(n, 25.0) * speed_scale
    v[75:100] = 14.0 * speed_scale                      # slower through the corner
    if stop_at is not None:
        v[stop_at] = 0.3
    lon_g = np.zeros(n)
    lon_g[65:80] = -0.4                                 # braking into it
    lat_g = np.zeros(n)
    lat_g[80:96] = 0.5
    corners = [{"start": 80, "end": 96, "apex": 88, "apex_mps": 15.0, "code": "L3", "call": "Left 3"}]
    return {"lat": lat, "lon": lon, "speed_mps": v, "lon_g": lon_g, "lat_g": lat_g, "corners": corners}


def test_identical_passes_have_zero_delta():
    a = _drive()
    r = da.compare(a, _drive())
    assert r["matched_corners"] == 1
    assert r["corner_delta_s"] == pytest.approx(0.0, abs=1e-9)
    assert r["overlap_delta_s"] == pytest.approx(0.0, abs=1e-9)
    assert r["overlap_m"] >= 860          # the whole 863 m road


def test_faster_pass_gains_time_in_proportion():
    a, b = _drive(), _drive(speed_scale=1.1)
    r = da.compare(a, b)
    c = r["corners"][0]
    assert c["delta_s"] == pytest.approx(c["a"]["time_s"] * (1 / 1.1 - 1), rel=1e-9)
    assert r["overlap_delta_s"] < 0


def test_corner_metrics_read_the_technique():
    m = da.corner_metrics(*(lambda d: (d["speed_mps"], d["lon_g"], d["lat_g"]))(_drive()), 80, 96, 88, 15.0)
    assert m["min_mps"] == pytest.approx(14.0)
    assert m["brake_m"] == pytest.approx((88 - 65) * 5.0)   # braking began 115 m before the apex
    assert m["peak_lat_g"] == pytest.approx(0.5)
    assert m["envelope_use"] == pytest.approx(14.0 / 15.0)


def test_stops_are_flagged_and_left_out_of_totals():
    r = da.compare(_drive(), _drive(stop_at=90))
    assert r["corners"][0]["stopped"] is True
    assert r["matched_corners"] == 0 and r["corner_delta_s"] == 0.0


def _score(d, scale=1.0):
    return da.driver_score(d["speed_mps"] * scale, d["lon_g"], d["lat_g"], d["corners"])


def test_driver_score_never_rewards_overdriving():
    d = _drive()
    apex = d["corners"][0]["apex_mps"]
    s85 = _score(d, scale=0.85 * apex / 14.0)["score"]    # corner min speed at 85 % of the grip limit
    s100 = _score(d, scale=1.00 * apex / 14.0)["score"]
    s120 = _score(d, scale=1.20 * apex / 14.0)["score"]
    s60 = _score(d, scale=0.60 * apex / 14.0)["score"]
    assert s85 == s100, "full credit anywhere from 85 % to 100 % of the limit (and speed-invariant smoothness)"
    assert s120 < s85 and s60 < s85, "beyond the limit scores lower than staying inside it"


def test_driver_score_penalises_jerk_and_ignores_limits():
    d = _drive()
    n = len(d["lat"])
    # Technique only: posted limits are not an input, and no legality component exists.
    assert "limit_mps" not in da.driver_score.__code__.co_varnames
    assert set(_score(d)["components"]) == {"pace", "smoothness", "braking", "consistency"}
    jerky = dict(d, lat_g=d["lat_g"] + 0.3 * np.sin(np.arange(n)))      # sawing at the wheel
    assert _score(jerky)["components"]["smoothness"] < _score(d)["components"]["smoothness"]
    assert _score(dict(d, corners=[]))["score"] is None


def test_segment_pass_finds_the_stretch_and_scores_it():
    d = _drive()
    seg = {"lat0": d["lat"][60], "lon0": d["lon"][60], "lat1": d["lat"][120], "lon1": d["lon"][120], "length_m": 60 * 5.0}
    p = da.segment_pass(seg, d)
    assert p is not None and (p["lo"], p["hi"]) == (60, 120) and p["score"] is not None
    back = {"lat0": seg["lat1"], "lon0": seg["lon1"], "lat1": seg["lat0"], "lon1": seg["lon0"], "length_m": seg["length_m"]}
    assert da.segment_pass(back, d) is None, "a pass the other way is a different segment"
