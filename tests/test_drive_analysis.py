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
