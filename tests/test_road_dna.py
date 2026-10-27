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
    assert env[5] == pytest.approx(rd.sight_speed_mps(rd.SIGHT_MAX_M)), "no policy cap: straight = sight limit"
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
    from core import reference_lap as rl
    lat, lon = path_from_legs(STAGE)
    kappa, ds = rd.compute_curvature(lat, lon)
    n = len(lat)
    dist = np.arange(n) * 5.0
    sight = rd.sight_distance_m(lat, lon)
    corners = rd.detect_corners(kappa, ds)
    lap = rl.simulate(kappa, ds, sight)
    args = (dist, corners, np.zeros(n), np.full(n, 0.05), [], lap, sight)
    sectors = rd.score_sectors(*args)
    assert all(s["clear"] is None for s in sectors)
    assert all(0 <= s[k] <= 100 for s in sectors for k in ("tech", "flow", "surf"))
    assert all(s["archetype"] in rl.ARCHETYPES for s in sectors)

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


def test_sight_distance_on_a_curve_matches_chord_geometry():
    lat, lon = path_from_legs([("straight", 200.0), ("arc", 50.0, 180.0), ("straight", 200.0)])
    sight = rd.sight_distance_m(lat, lon)
    mid = 40 + int(round(math.pi * 50 / 2 / 5))           # middle of the arc
    expected = 2 * 50 * math.acos((50 - rd.SIGHT_OFFSET_M) / 50)   # ~40 m
    assert sight[mid] == pytest.approx(expected, abs=8.0)
    # 25 m in, the view runs down the 175 m of straight and a little way into the bend
    assert 175 < sight[5] < 230


def test_sight_distance_over_a_crest_and_flat():
    n = 300
    lat, lon = path_from_legs([("straight", (n - 1) * 5.0)])
    flat = rd.sight_distance_m(lat, lon, np.zeros(n))
    assert np.all(flat[:200] == rd.SIGHT_MAX_M)
    s = np.arange(n) * 5.0
    crest = 8.0 - ((s - 750.0) / 60.0) ** 2              # sharp crest at 750 m
    crest = np.maximum(crest, -40.0)
    sight = rd.sight_distance_m(lat, lon, crest)
    before = int(700 / 5)
    assert sight[before] < 150, "a sharp crest 50 m ahead must hide the road beyond"
    assert sight[int(400 / 5)] > sight[before]


def test_sight_speed_and_envelope_respect_sightline():
    assert rd.sight_speed_mps(0.0) == pytest.approx(0.0)
    v = float(rd.sight_speed_mps(100.0))
    assert v * rd.REACTION_S + v * v / (2 * rd.BRAKE_DECEL_MPS2) == pytest.approx(100.0)
    kappa = np.zeros(100)
    ds = np.full(100, 5.0)
    short = np.full(100, 60.0)
    env = rd.braking_envelope_mps(kappa, ds, sight_m=short)
    assert np.allclose(env, rd.sight_speed_mps(60.0))


def test_pace_note_grammar_shapes_and_grades():
    def call(legs):
        _, _, cs = _corners(legs)
        return [rd.pace_note_text(c) for c in cs]
    assert call([("straight", 200.0), ("arc", 12.0, 90.0), ("straight", 200.0)]) == [("LSQ", "Square left")]
    assert call([("straight", 200.0), ("arc", 18.0, -120.0), ("straight", 200.0)])[0][1].startswith("Acute right")
    # 4 band is 65-100 m: 70 m sits in its tight quarter -> "4 minus", 95 m in its open quarter -> "4 plus"
    assert call([("straight", 200.0), ("arc", 70.0, 60.0), ("straight", 200.0)])[0][0] == "L4-"
    assert call([("straight", 200.0), ("arc", 96.0, 60.0), ("straight", 200.0)])[0][0] == "L4+"
    assert "long" in call([("straight", 200.0), ("arc", 120.0, 70.0), ("straight", 200.0)])[0][1]


def test_caution_ladder_and_note_chaining():
    lat, lon = path_from_legs([("straight", 600.0), ("arc", 15.0, 180.0), ("straight", 15.0),
                               ("arc", 50.0, -60.0), ("straight", 150.0), ("arc", 60.0, 60.0), ("straight", 300.0)])
    kappa, ds = rd.compute_curvature(lat, lon)
    sight = rd.sight_distance_m(lat, lon)
    env = rd.braking_envelope_mps(kappa, ds, sight_m=sight)
    cs = rd.annotate_cautions(rd.detect_corners(kappa, ds), env, sight)
    assert cs[0]["shape"] == "hairpin" and cs[0]["caution"] >= 2      # hairpin after a long straight
    assert "caution" in rd.pace_note_text(cs[0])[1]
    notes = rd.link_notes([{"start_m": c["start"] * 5.0, "end_m": c["end"] * 5.0} for c in cs])
    assert notes[0]["link"] in ("into", "and")                         # 15 m later: chained
    assert notes[1]["link"] == str(rd.rally_distance(notes[2]["start_m"] - notes[1]["end_m"]))
    assert notes[-1]["link"] is None
    assert rd.rally_distance(140.0) == 150 and rd.rally_distance(33.0) == 30


def test_two_left_squares_are_not_one_hairpin():
    # A left at one junction and another left 30 m later (a jog) must read as two squares.
    for gap in (25.0, 30.0, 40.0):
        _, _, cs = _corners([("straight", 200.0), ("arc", 12.0, 90.0), ("straight", gap),
                             ("arc", 12.0, 90.0), ("straight", 200.0)])
        codes = [rd.pace_note_text(c)[0] for c in cs]
        assert codes == ["LSQ", "LSQ"], (gap, codes)
    # ...while a real hairpin stays a hairpin.
    _, _, cs = _corners([("straight", 200.0), ("arc", 15.0, 180.0), ("straight", 200.0)])
    assert [rd.pace_note_text(c)[0] for c in cs] == ["LHP"]


def test_junction_square_running_into_a_bend_is_not_a_hairpin():
    # Turning off one road onto another that bends straight away (US 27 -> Dry Ridge Rd).
    for r_sq, r_bend in ((12.0, 40.0), (15.0, 60.0), (20.0, 50.0)):
        _, _, cs = _corners([("straight", 200.0), ("arc", r_sq, 90.0), ("arc", r_bend, 80.0), ("straight", 200.0)])
        codes = [rd.pace_note_text(c)[0] for c in cs]
        assert "LHP" not in codes and codes[0] == "LSQ" and len(codes) == 2, (r_sq, r_bend, codes)


def test_unknown_camber_and_roughness_cells_are_treated_as_missing_not_nan():
    # A web/iOS recording leaves camber_deg blank (NaN) on every row and roughness blank now and then; that used to make the whole
    # envelope and every corner's apex speed NaN, which turned the drive score into NaN.
    kappa, ds, _ = _corners(STAGE)
    n = len(kappa)
    rough = np.full(n, 0.1)
    rough_gaps = rough.copy()
    rough_gaps[::9] = np.nan
    env = rd.braking_envelope_mps(kappa, ds, np.full(n, np.nan), rough_gaps)
    assert np.all(np.isfinite(env))
    np.testing.assert_allclose(env, rd.braking_envelope_mps(kappa, ds, None, np.where(np.isnan(rough_gaps), 0.08, rough)), rtol=1e-12)
    corners = rd.detect_corners(kappa, ds, np.full(n, np.nan), None, np.full(n, np.nan))
    assert corners and all(np.isfinite(c["apex_mps"]) for c in corners)
    assert [c["apex_mps"] for c in corners] == pytest.approx([c["apex_mps"] for c in rd.detect_corners(kappa, ds)], rel=1e-12)
