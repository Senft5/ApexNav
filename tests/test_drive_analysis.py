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


def test_driver_score_leaves_out_corners_with_unknown_speed_or_limit():
    d = _drive()
    whole = _score(d)["score"]
    gap = dict(d, speed_mps=d["speed_mps"].copy())
    gap["speed_mps"][85] = np.nan                       # a blank GPS speed inside the only corner
    assert da.driver_score(gap["speed_mps"], gap["lon_g"], gap["lat_g"], gap["corners"])["score"] is None
    nolimit = [dict(d["corners"][0], apex_mps=float("nan"))]
    assert da.driver_score(d["speed_mps"], d["lon_g"], d["lat_g"], nolimit)["score"] is None
    assert whole is not None


# ---------------------------------------------------------------------------
# Corner coach
# ---------------------------------------------------------------------------

def _pass(corner_v=14.0, brake_from=65, throttle_at=None, lat_from=80):
    d = _drive()
    d["speed_mps"][75:100] = corner_v
    d["lon_g"][:] = 0.0
    d["lon_g"][brake_from:80] = -0.4
    if throttle_at is not None:
        d["lon_g"][throttle_at:110] = 0.2
    d["lat_g"][:] = 0.0
    d["lat_g"][lat_from:96] = 0.5
    return d


def test_corner_phases_read_trail_coast_and_throttle():
    d = _pass(throttle_at=92, lat_from=75)
    m = da.corner_phases(d["speed_mps"], d["lon_g"], d["lat_g"], 80, 96, 88, 15.0)
    assert m["brake_m"] == pytest.approx(115.0)
    assert m["trail_m"] == pytest.approx(25.0), "braking with lateral load on: bins 75-79"
    assert m["throttle_m"] == pytest.approx(20.0), "back on the throttle 20 m after the apex"
    assert m["coast_m"] == pytest.approx(60.0), "bins 80-91: off the brake, not yet on the throttle"
    none = da.corner_phases(*(lambda p: (p["speed_mps"], p["lon_g"], p["lat_g"]))(_pass()), 80, 96, 88, 15.0)
    assert none["throttle_m"] is None and none["trail_m"] == 0.0


def test_coach_finds_the_time_against_your_own_best_pass():
    a = _pass(corner_v=14.0)
    slow = _pass(corner_v=13.0)
    late_brake = _pass(corner_v=14.5, brake_from=72)
    r = da.coach(a, [slow, late_brake])
    c = r["corners"][0]
    assert c["passes"] == 3 and c["best_from"] == 1
    assert c["gain_s"] == pytest.approx(c["m"]["time_s"] - c["best"]["time_s"])
    assert c["gain_s"] > da.TIP_GAIN_S
    assert c["tip"] == {"kind": "brake_later", "value": pytest.approx(35.0), "vs_best": True}
    assert r["ideal_s"] == pytest.approx(r["this_s"] - r["gain_s"]) and r["top"] == [0]
    quicker = _pass(corner_v=15.0)
    assert da.coach(a, [quicker])["corners"][0]["tip"]["kind"] == "min_speed"


def test_coach_never_takes_an_overdriven_pass_as_the_reference():
    a = _pass(corner_v=14.0)
    over = _pass(corner_v=16.5)                         # 110 % of the 15 m/s sane limit
    r = da.coach(a, [over])
    c = r["corners"][0]
    assert c["passes"] == 2 and c["best"] is None and c["gain_s"] == 0.0 and r["top"] == []


def test_coach_leaves_out_stops_and_unmeasured_g():
    a = _pass()
    stopped = _pass()
    stopped["speed_mps"][90] = 0.3
    assert da.coach(stopped, [a])["corners"][0]["gain_s"] is None
    gap = dict(_pass(corner_v=15.0), g_known=[1] * len(a["lat"]))
    gap["g_known"][85] = 0
    r = da.coach(a, [gap])
    assert r["corners"][0]["passes"] == 1, "a pass with blank g is no reference"
    own_gap = dict(a, g_known=gap["g_known"])
    assert da.coach(own_gap, [])["clean"] == 0


def test_coach_alone_still_names_the_habit():
    a = _pass()                                         # off the brake at 80, never back on the throttle
    tip = da.coach(a, [])["corners"][0]["tip"]
    assert tip["kind"] == "coast" and tip["value"] >= da.SOLO_COAST_M
    late = _pass(throttle_at=84)
    late["lon_g"][90:94] = -0.35                        # braking after the apex
    assert da.coach(late, [])["corners"][0]["tip"]["kind"] == "brake_after_apex"


def test_coach_finds_no_time_in_the_same_drive_seen_through_gps_jitter():
    a = _pass(corner_v=14.0)
    rng = np.random.default_rng(7)
    copies = [dict(a, lat=a["lat"] + rng.normal(0, 3 / 110540, len(a["lat"])),
                   lon=a["lon"] + rng.normal(0, 3 / 90000, len(a["lat"]))) for _ in range(6)]
    shifted = dict(a, lat=np.concatenate([a["lat"][1:], a["lat"][-1:]]), lon=np.concatenate([a["lon"][1:], a["lon"][-1:]]))
    r = da.coach(a, copies + [shifted])
    assert r["top"] == [] and r["gain_s"] == 0.0, "identical speeds are no gain, whatever the GPS does"


def test_coach_reads_g_only_where_measured_around_the_corner():
    a = _pass(corner_v=14.0)
    ref = dict(_pass(corner_v=14.5), g_known=[1] * len(a["lat"]))
    for q in range(48, 75):                             # blank g in the brake zone, before the corner starts
        ref["g_known"][q] = 0
    ref["lon_g"] = ref["lon_g"].copy()
    ref["lon_g"][48:75] = 0.0                           # zero-filled, as recording.js stores it
    c = da.coach(a, [ref])["corners"][0]
    assert c["passes"] == 1, "a pass with blank g in its brake zone is no reference"


def test_corner_phases_ignore_braking_for_an_earlier_corner():
    d = _pass()
    d["lon_g"][:] = 0.0
    d["lon_g"][50:56] = -0.4                            # braking 120 m before turn-in, then steady
    m = da.corner_phases(d["speed_mps"], d["lon_g"], d["lat_g"], 80, 96, 88, 15.0)
    assert m["brake_m"] is None and m["trail_m"] == 0.0
    assert da.coach(d, [])["corners"][0]["tip"] is None, "no brake zone of its own: no coasting note"


def test_coach_says_whether_a_tip_is_against_the_best_pass():
    a, b = _pass(corner_v=14.0), _pass(corner_v=14.1)   # a quicker pass, but by less than TIP_GAIN_S
    c = da.coach(a, [b])["corners"][0]
    assert c["best"] is not None and c["gain_s"] < da.TIP_GAIN_S
    assert c["tip"]["kind"] == "coast" and c["tip"]["vs_best"] is False, "both coasted 85 m: this is the pass's own number"


def test_aligned_time_ignores_blank_speed_outside_the_stretch():
    a = _pass(corner_v=14.0)
    b = _pass(corner_v=14.0)
    b["speed_mps"] = b["speed_mps"].copy()
    b["speed_mps"][10] = np.nan                          # a blank speed long before the corner
    t = da.aligned_time_s(a, 80, 96, b, 80)
    assert t == pytest.approx(da.corner_metrics(a["speed_mps"], a["lon_g"], a["lat_g"], 80, 96, 88, 15.0)["time_s"], rel=1e-9)

# ---------------------------------------------------------------------------
# Friction circle
# ---------------------------------------------------------------------------

def test_gg_envelope_reads_each_direction_and_ignores_one_spike():
    lat, lon = [], []
    for k in range(40):
        lat += [0.0, 0.0, 0.5, -0.4]
        lon += [-0.7, 0.3, 0.0, 0.0]
    lon[0] = -1.4                                       # one pothole jolt in the braking slice
    env = da.gg_envelope(lat, lon)
    assert env["brake_g"] == pytest.approx(0.7) and env["throttle_g"] == pytest.approx(0.3)
    assert env["left_g"] == pytest.approx(0.5) and env["right_g"] == pytest.approx(0.4)
    assert env["points"] == 160
    diag = [r for k, r in enumerate(env["radius_g"]) if k % 4 == 2]
    assert diag == [None] * 4, "no measured points on the diagonals: unknown, not zero"


def test_gg_envelope_skips_unmeasured_and_cruising():
    lat = [0.5] * 20 + [0.01] * 50
    lon = [0.0] * 70
    known = [0] * 10 + [1] * 60
    env = da.gg_envelope(lat, lon, known)
    assert env["points"] == 10 and env["left_g"] == pytest.approx(0.5)
    assert da.gg_envelope([0.5] * 5, [0.0] * 5)["peak_g"] is None


def test_grip_use_is_the_share_of_your_own_envelope():
    env = da.gg_envelope([0.5] * 20 + [0.0] * 20, [0.0] * 20 + [-0.8] * 20)
    assert da.grip_use([0.25, 0.5, 0.0], [0.0, 0.0, -0.4], 0, 2, env) == pytest.approx((0.5 + 1.0 + 0.5) / 3)
    assert da.grip_use([0.25, 0.01], [0.0, 0.0], 0, 1, env) == pytest.approx(0.5), "cruising bins are left out"
    assert da.grip_use([0.25, 0.5], [0.0, 0.0], 0, 1, env, [1, 0]) is None


def test_gg_slices_are_centred_on_the_axes_and_none_is_unknown():
    assert da._sector(0.5, 0.0) == 4 and da._sector(-0.5, 0.0) == 12 and da._sector(0.0, -0.5) == 8 and da._sector(0.0, 0.3) == 0
    assert da._sector(0.01, 0.3) == da._sector(-0.01, 0.3) == 0, "noise either side of an axis stays in one slice"
    env = da.gg_envelope([None, 0.3] + [0.5] * 10, [0.1, None] + [0.0] * 10)
    assert env["points"] == 10 and env["left_g"] == pytest.approx(0.5)
    assert da.grip_use([None], [0.0], 0, 0, env) is None


def test_abrupt_moments_finds_the_jolts_and_ignores_crawling_and_unknown():
    import math
    from core import drive_analysis as da
    n = 400
    lat = [0.2 * math.sin(i / 20) for i in range(n)]                                  # a calm weave: well under the floor
    lon = [0.0] * n
    v = [20.0] * n
    for i, g in ((100, 0.5), (110, 0.4), (250, -0.45), (330, 0.6)):                  # sudden inputs; 110 is too close to 100
        lat[i] = g
    v[330] = 3.0                                                                       # crawling: not driving input
    r = da.abrupt_moments(lat, lon, v, [0 if i == 251 else 1 for i in range(n)])
    assert [m["index"] for m in r["moments"]] == [100, 250]
    assert r["jerk"][330] is None and r["jerk"][331] is None and r["jerk"][251] is None and r["jerk"][252] is None
    assert all(m["jerk_gps"] >= da.JERK_FLOOR_GPS for m in r["moments"])
    calm = da.abrupt_moments([0.2 * math.sin(i / 20) for i in range(n)], lon, v)
    assert calm["moments"] == []


def _ramped(turn_at: int, speed_scale: float = 1.0) -> dict:
    """The test corner with the lateral load building over 4 bins from turn_at (a real turn-in is a ramp, not a step)."""
    d = _drive(speed_scale)
    lat_g = np.zeros(len(d["lat_g"]))
    for k in range(4):
        lat_g[turn_at + k] = 0.125 * (k + 1)
    lat_g[turn_at + 4:96] = 0.5
    d["lat_g"] = lat_g
    return d


def test_turn_in_is_read_from_the_lateral_load():
    d = _ramped(78)
    assert da._turn_in(d, 80, 96) == 79                          # 3-bin smoothed load first holds 40 % of its peak
    flat = _drive()
    flat["lat_g"] = flat["lat_g"] * 0.3                           # a light curve: no clear turn-in
    assert da._turn_in(flat, 80, 96) is None
    right = _ramped(78)
    right["lat_g"] = -right["lat_g"]                              # the same either way
    assert da._turn_in(right, 80, 96) == 79


def _lat(n: int, runs: list) -> dict:
    lat = np.zeros(n)
    for a, b, g in runs:
        lat[a:b] = g
    return {"lat_g": lat}


def test_turn_in_is_unknown_where_it_cannot_be_told():
    # a chicane: a right, a short transition, then this left; the direction comes from the corner's peak, not one bin
    chicane = _lat(200, [(60, 80, -0.5), (80, 84, 0.1), (84, 100, 0.4)])
    assert da._turn_in(chicane, 82, 100) == 83                    # not the right-hander's turn-in at 60
    # linked lefts: a lighter left runs into this one; above 40 % between them, whose turn-in it is cannot be told
    for gap, want in ((0.19, 79), (0.21, None)):
        linked = _lat(200, [(50, 70, 0.3), (70, 80, gap), (80, 100, 0.5)])
        assert da._turn_in(linked, 82, 100) == want
    # unknown lateral g anywhere it reads: unknown, never a later turn-in
    d = _ramped(78)
    d["lat_g"][81] = np.nan
    assert da._turn_in(d, 80, 96) is None
    # and never further back than 40 m before the corner's start
    long_run = _lat(200, [(40, 100, 0.5)])
    assert da._turn_in(long_run, 80, 96) is None


def test_turn_in_matches_its_js_port():
    import json
    import os
    import subprocess
    cases = [(_ramped(78)["lat_g"].tolist(), 80, 96), ((-_ramped(78)["lat_g"]).tolist(), 80, 96),
             (_lat(200, [(60, 80, -0.5), (80, 84, 0.1), (84, 100, 0.4)])["lat_g"].tolist(), 82, 100),
             (_lat(200, [(50, 70, 0.3), (70, 80, 0.19), (80, 100, 0.5)])["lat_g"].tolist(), 82, 100),
             (_lat(200, [(50, 70, 0.3), (70, 80, 0.21), (80, 100, 0.5)])["lat_g"].tolist(), 82, 100),
             (_lat(200, [(40, 100, 0.5)])["lat_g"].tolist(), 80, 96)]
    gap = _ramped(78)["lat_g"].tolist()
    gap[81] = None                                                # JSON null in JS, NaN in Python
    runner = ("const c=require(process.argv[1]);const cases=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify(cases.map(([l,s,e])=>c.turnIn({lat_g:l},s,e))));")
    out = subprocess.run(["node", "-e", runner, os.path.abspath("web/apex_core.js")], input=json.dumps(cases + [(gap, 80, 96)]),
                         capture_output=True, text=True, check=True)
    py = [da._turn_in({"lat_g": np.array(l, dtype=float)}, s, e) for l, s, e in cases]
    py.append(da._turn_in({"lat_g": np.array([np.nan if v is None else v for v in gap])}, 80, 96))
    assert json.loads(out.stdout) == py and py[-1] is None


def test_coach_says_turn_in_later_when_the_quicker_pass_did():
    early, late = _ramped(73, 0.96), _ramped(78)                  # turned in 25 m sooner, and 4 % slower
    co = da.coach(early, [late])
    c = co["corners"][0]
    assert c["m"]["turn_in_m"] - c["best"]["turn_in_m"] == pytest.approx(25.0)
    assert c["tip"] == {"kind": "turn_in_later", "value": pytest.approx(25.0), "vs_best": True}
    same = da.coach(_ramped(78, 0.96), [late])["corners"][0]      # the same turn-in: the time is elsewhere, no turn-in tip
    assert same["tip"] is None or same["tip"]["kind"] != "turn_in_later"
