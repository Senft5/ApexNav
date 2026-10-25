import glob
import json
import math

import numpy as np
import pytest

from core import road_dna as rd
from tests.synthetic import path_from_legs

STAGE = [
    ("straight", 300.0),
    ("arc", 50.0, 90.0),      # left, R50 -> severity 3
    ("straight", 300.0),
    ("arc", 150.0, -60.0),    # right, R150 -> severity 5
    ("straight", 300.0),
]


def _corners(legs, **kw):
    lat, lon = path_from_legs(legs, **kw)
    kappa, ds = rd.compute_curvature(lat, lon)
    return kappa, ds, rd.detect_corners(kappa, ds)


def test_curvature_sign_and_radius_follow_iso8855():
    kappa, _, _ = _corners([("straight", 100.0), ("arc", 80.0, 120.0), ("straight", 100.0)])
    peak = kappa[np.argmax(np.abs(kappa))]
    assert peak > 0, "left turn must be positive curvature"
    assert 1.0 / peak == pytest.approx(80.0, rel=0.10)


def test_stage_yields_exactly_the_two_real_corners():
    _, _, corners = _corners(STAGE)
    assert [(c["dir"], c["severity"]) for c in corners] == [("L", 3), ("R", 5)]
    assert math.degrees(corners[0]["turn_rad"]) == pytest.approx(90.0, abs=6.0)
    assert math.degrees(corners[1]["turn_rad"]) == pytest.approx(-60.0, abs=6.0)


def test_gps_noise_does_not_invent_corners():
    _, _, corners = _corners([("straight", 2000.0)], noise_m=1.5)
    assert corners == []
    for seed in range(5):
        _, _, corners = _corners(STAGE, noise_m=1.0, seed=seed)
        assert [c["dir"] for c in corners] == ["L", "R"]
        # Noise may only ever grade a corner one step TIGHTER (safer), never looser.
        assert corners[0]["severity"] in (2, 3) and corners[1]["severity"] in (4, 5)


def test_hairpin_and_tightening_modifiers():
    _, _, corners = _corners([("straight", 200.0), ("arc", 15.0, -180.0), ("straight", 200.0)])
    assert len(corners) == 1 and corners[0]["severity"] == "HP" and corners[0]["dir"] == "R"
    assert rd.pace_note_text(corners[0]) == ("RHP", "Right hairpin")

    legs = [("straight", 200.0), ("arc", 120.0, 35.0), ("arc", 45.0, 60.0), ("straight", 200.0)]
    _, _, corners = _corners(legs)
    assert len(corners) == 1 and "tightens" in corners[0]["mods"]


def test_apex_speed_is_manifesto_formula():
    v = rd.apex_speed_mps(50.0, math.radians(4.0), 0.6)
    assert v == pytest.approx(math.sqrt(50.0 * rd.G_STD * (0.6 + math.tan(math.radians(4.0)))))
    assert rd.apex_speed_mps(50.0, -0.1, 0.6) < rd.apex_speed_mps(50.0, 0.0, 0.6) < rd.apex_speed_mps(50.0, 0.1, 0.6)


def test_braking_envelope_brakes_before_and_respects_apex():
    kappa, ds, corners = _corners(STAGE)
    env = rd.braking_envelope_mps(kappa, ds)
    apex = corners[0]["apex"]
    assert env[apex] == pytest.approx(rd.apex_speed_mps(1.0 / abs(kappa[apex])), rel=1e-9)
    approach = env[apex - 30:apex + 1]
    assert np.all(np.diff(approach) <= 1e-9), "envelope must fall monotonically into the corner"
    assert env[5] == pytest.approx(rd.V_CAP_MPS)
    decel = (np.diff(env[apex - 20:apex + 1] ** 2) / (2 * ds[apex - 20:apex]))
    assert np.all(-decel <= rd.BRAKE_DECEL_MPS2 + 1e-6)


def test_hazards_come_only_from_measured_imu():
    dist = np.arange(400) * 5.0
    crest = np.zeros(400)
    crest[50:53] = [-0.05, -0.12, -0.06]
    crest[300] = 0.14
    rough = np.full(400, 0.05)
    peak = np.full(400, 0.10)
    peak[[120, 124, 200]] = [0.40, 0.55, 0.20]
    hz = rd.detect_hazards(dist, crest, rough, peak)
    assert [(h["type"], h["index"]) for h in hz] == [("crest", 51), ("bump", 124), ("dip", 300)]
    assert rd.detect_hazards(dist, np.zeros(400), rough, np.full(400, 0.1)) == []


def test_steadily_broken_pavement_is_not_a_stream_of_bumps():
    dist = np.arange(400) * 5.0
    rough = np.full(400, 0.09)              # rough road everywhere
    peak = np.full(400, 0.40)               # every bin over 0.35 g
    peak[200] = 0.95                        # one real impact
    hz = rd.detect_hazards(dist, np.zeros(400), rough, peak)
    assert [(h["type"], h["index"]) for h in hz] == [("bump", 200)]


def test_sector_clear_is_unknown_without_alpr_data():
    lat, lon = path_from_legs(STAGE)
    kappa, ds = rd.compute_curvature(lat, lon)
    n = len(lat)
    dist = np.arange(n) * 5.0
    args = (dist, kappa, rd.detect_corners(kappa, ds), np.zeros(n), np.zeros(n),
            np.full(n, 20.0), np.full(n, 0.05), [])
    sectors = rd.score_sectors(*args)
    assert all(s["clear"] is None for s in sectors)
    assert all(0 <= s[k] <= 100 for s in sectors for k in ("tech", "flow", "surf"))
    with_corners = [s for s in sectors if s["corners"]]
    without = [s for s in sectors if not s["corners"]]
    assert with_corners and without
    assert min(s["tech"] for s in with_corners) > max(s["tech"] for s in without)

    sids = (dist // rd.SECTOR_LENGTH_M).astype(int)
    cam = {"lat": float(lat[150]), "lon": float(lon[150])}
    counts = rd.alpr_counts_by_sector(lat, lon, sids, [cam])
    sectors = rd.score_sectors(*args, alpr_counts=counts)
    assert sectors[int(sids[150])]["clear"] < 100
    assert all(s["clear"] == 100 for s in sectors if s["id"] != int(sids[150]))


@pytest.mark.parametrize("path", sorted(glob.glob("web/data/*.js")))
def test_shipped_drive_data_has_no_fabricated_events(path):
    text = open(path, encoding="utf-8").read()
    payload = json.loads(text[text.index("push(") + 5:text.rindex(");")])
    allowed = {"corner", "bump", "crest", "dip"}
    assert {e["type"] for e in payload["events"]} <= allowed
    assert all(s["clear"] is None for s in payload["sectors"]), "CLEAR needs real ALPR data"
