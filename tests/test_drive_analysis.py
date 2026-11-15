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


def _loop_drive():
    """A 2 km circle driven 1.3 times; the first lap's GPS sits 3 m wide, so the start is closer on the way back round."""
    n_lap, r0 = 400, 2000.0 / (2 * np.pi)
    k = np.arange(int(n_lap * 1.3))
    r = np.where(k < n_lap, r0 + 3.0, r0)
    th = 2 * np.pi * k / n_lap
    c = np.cos(np.radians(35.6))
    lat = 35.6 + r * np.cos(th) / 110540.0
    lon = -83.9 + r * np.sin(th) / (111320.0 * c)
    seg = {"lat0": 35.6 + r0 / 110540.0, "lon0": -83.9, "lat1": 35.6 + r0 / 110540.0, "lon1": -83.9, "length_m": n_lap * 5.0}
    return {"lat": lat, "lon": lon}, seg


def test_segment_window_on_a_loop_tries_every_visit_to_the_start():
    """A time attack loop's end is its start. The closest visit to the start can be the way back round (GPS noise), where
    no lap follows: every visit is tried, closest first, so the lap is still found."""
    d, seg = _loop_drive()
    assert da.segment_window(seg, d) == (0, 400)
    assert da.segment_window(dict(seg, lat0=36.0), d) is None            # a start the drive never passes


def _two_laps(first_mps=20.0, second_mps=25.0):
    """The same 2 km circle driven 2.3 times: the first lap at first_mps, the rest at second_mps; no corners."""
    n_lap, r0 = 400, 2000.0 / (2 * np.pi)
    k = np.arange(int(n_lap * 2.3))
    th = 2 * np.pi * k / n_lap
    c = np.cos(np.radians(35.6))
    d = {"lat": 35.6 + r0 * np.cos(th) / 110540.0, "lon": -83.9 + r0 * np.sin(th) / (111320.0 * c),
         "speed_mps": np.where(k < n_lap, first_mps, second_mps), "lon_g": np.zeros(len(k)), "lat_g": np.zeros(len(k)), "corners": []}
    seg = {"lat0": 35.6 + r0 / 110540.0, "lon0": -83.9, "lat1": 35.6 + r0 / 110540.0, "lon1": -83.9, "length_m": n_lap * 5.0}
    return d, seg


def test_segment_pass_takes_the_quickest_lap_of_a_loop():
    """Two laps of a time attack loop in one drive: both are passes, and the quicker one is the drive's time (the boards
    and the Log keep your best), whichever visit to the start was closest."""
    d, seg = _two_laps()
    assert sorted(da.segment_windows(seg, d)) == [(0, 400), (400, 800)]
    p = da.segment_pass(seg, d)
    assert (p["lo"], p["hi"]) == (400, 800) and p["time_s"] == pytest.approx(400 * 5.0 / 25.0, rel=1e-6)
    slow, _ = _two_laps(25.0, 20.0)
    assert (da.segment_pass(seg, slow)["lo"], da.segment_pass(seg, slow)["hi"]) == (0, 400)


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


def _coast(d, b=96, drop=0.1):
    """Off the brakes at bin 80 and rolling down to the corner speed by bin b: a car off the gas loses speed (drop m/s a
    bin, ~0.03 g, as the motion sensors say too). Held speed is part throttle, not coasting."""
    v, lon = np.asarray(d["speed_mps"], dtype=float).copy(), np.asarray(d["lon_g"], dtype=float).copy()
    vc = v[b]
    for k in range(75, b + 1):
        v[k] = vc + drop * (b - k)
    for k in range(80, b + 1):
        lon[k] = -drop * v[k] / 5.0 / da.G_STD
    return dict(d, speed_mps=v, lon_g=lon)


def test_corner_phases_read_trail_coast_and_throttle():
    d = _coast(_pass(throttle_at=92, lat_from=75), b=91)
    m = da.corner_phases(d["speed_mps"], d["lon_g"], d["lat_g"], 80, 96, 88, 15.0)
    assert m["brake_m"] == pytest.approx(115.0)
    assert m["trail_m"] == pytest.approx(25.0), "braking with lateral load on: bins 75-79"
    assert m["throttle_m"] == pytest.approx(20.0), "back on the throttle 20 m after the apex"
    assert m["coast_m"] == pytest.approx(60.0), "bins 80-91: off the brake, not yet on the throttle, slowing"
    held = _pass(throttle_at=92, lat_from=75)                # the same corner at a held speed: part throttle
    assert da.corner_phases(held["speed_mps"], held["lon_g"], held["lat_g"], 80, 96, 88, 15.0)["coast_m"] == 0.0
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
    a = _coast(_pass())                                 # off the brake at 80, never back on the throttle, rolling down
    tip = da.coach(a, [])["corners"][0]["tip"]
    assert tip["kind"] == "coast" and tip["value"] >= da.SOLO_COAST_M
    assert da.coach(_pass(), [])["corners"][0]["tip"] is None, "the corner at a held speed: no coasting to tell"
    late = _pass()
    late["lon_g"][80:94] = -0.35                        # still braking past the apex (88), never off the brakes
    assert da.coach(late, [])["corners"][0]["tip"]["kind"] == "brake_after_apex"
    again = _pass(throttle_at=84)
    again["lon_g"][90:94] = -0.35                       # back on the gas, then braking again: for what comes next
    t = da.coach(again, [])["corners"][0]["tip"]
    assert t is None or t["kind"] != "brake_after_apex"


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
    a, b = _coast(_pass(corner_v=14.0)), _coast(_pass(corner_v=14.1))   # a quicker pass, but by less than TIP_GAIN_S
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


def _early_corner(v_min_at, lon_cross_at, dip=4.0, n=120, s=50, e=70, a=60):
    """A left corner at 20 m/s whose GPS speed bottoms out at bin v_min_at, and whose a_lon (the motion sensors) goes from
    slowing to speeding up at bin lon_cross_at; the load sideways peaks at the apex."""
    v = np.full(n, 20.0)
    for i in range(n):
        v[i] = 20.0 - dip * max(0.0, 1.0 - abs(i - v_min_at) / 12.0)
    lon = np.array([-0.15 if i < lon_cross_at else 0.15 for i in range(n)], dtype=float)
    lat = np.array([0.5 * max(0.0, 1.0 - abs(i - a) / 10.0) for i in range(n)], dtype=float)
    return v, lon, lat, s, e, a


def test_early_apex_is_told_only_when_gps_and_the_motion_sensors_agree():
    """Nate's drives (2026-11-15, "i don't do that?"): 37 early-apex notes on 11 drives, half from a dip under 2 mph that GPS
    cannot tell and more where the motion sensors put the slowest point at the apex. Now: a real dip, more than one GPS fix
    early, and the sensors saying so too. Not softer: the same corner with both agreeing is still told."""
    v, lon, lat, s, e, a = _early_corner(56, 56)                     # slowest 20 m early, the sensors agree
    m = da.corner_phases(v, lon, lat, s, e, a, 25.0)
    assert m["min_offset_m"] == -20.0 and m["imu_slow_m"] == -20.0
    assert da._tip({**m, "road_off_m": -20.0}, None)["kind"] == "early_apex"
    # the size told is the line's against the road (Nate: "drive geometry compared to road geometry"), not the slowest point's
    assert da._tip({**m, "road_off_m": -17.25}, None)["value"] == 17.3
    v, lon, lat, s, e, a = _early_corner(56, 60)                     # GPS says early, the sensors say at the apex
    m = da.corner_phases(v, lon, lat, s, e, a, 25.0)
    assert m["imu_slow_m"] == 0.0 and da._tip(m, None) is None
    v, lon, lat, s, e, a = _early_corner(56, 56, dip=0.4)            # a dip under 1 m/s is GPS noise, not slowing
    assert da._tip(da.corner_phases(v, lon, lat, s, e, a, 25.0), None) is None
    v, lon, lat, s, e, a = _early_corner(57, 57)                     # 15 m early is inside one GPS fix of travel (16 m at 16 m/s)
    assert da._tip(da.corner_phases(v, lon, lat, s, e, a, 25.0), None) is None


def _road_corner(turn_at, n=120, s=50, e=70, road_at=60):
    """A left corner on the map centred at bin road_at (a 40 m radius arc over 20 bins, straight either side), and the
    phone's sideways load, at 15 m/s, centred at bin turn_at."""
    import math as m
    v = np.full(n, 15.0)
    lat_g = np.array([0.55 * max(0.0, 1.0 - abs(i - turn_at) / 10.0) for i in range(n)], dtype=float)
    x, y, h, la, lo = 0.0, 0.0, 0.0, [], []
    for i in range(n):
        la.append(39.0 + y / 110540.0)
        lo.append(-84.0 + x / (111320.0 * m.cos(m.radians(39.0))))
        k = (1 / 40.0) * max(0.0, 1.0 - abs(i + 0.5 - road_at) / 10.0)   # curvature rises to the road's apex and falls,
        x += 5.0 * m.cos(h + k * 2.5)                                    # taken at the middle of each 5 m step
        y += 5.0 * m.sin(h + k * 2.5)
        h += k * 5.0
    return v, lat_g, la, lo, s, e


def test_the_line_is_measured_against_the_roads_own_shape():
    """Nate (2026-11-15): "shouldn't it be drive geometry compared to road geometry?". road_turn_offset_m: the centre of
    your turning less the centre of the road's under you. On his 13 drives it says median -2 m (no early habit), and backs
    2 of the 13 corners the speed alone called early. Unknown road: None, never 0."""
    v, g, la, lo, s, e = _road_corner(56)                             # turned 20 m before the road does
    assert da.road_turn_offset_m(la, lo, v, g, s, e) == pytest.approx(-20.0, abs=3)
    v, g, la, lo, s, e = _road_corner(60)                             # turned with the road
    assert abs(da.road_turn_offset_m(la, lo, v, g, s, e)) < 3
    v, g, la, lo, s, e = _road_corner(64)                             # later than the road: a late apex
    assert da.road_turn_offset_m(la, lo, v, g, s, e) == pytest.approx(20.0, abs=3)
    assert da.road_turn_offset_m(None, None, v, g, s, e) is None
    la[60] = None                                                     # a bin off the map: the road is not known there
    assert da.road_turn_offset_m(la, lo, v, g, s, e) is None


def test_an_early_apex_needs_the_line_itself_early():
    """Speed alone (slowest before the tightest) said early on 13 of Nate's corners; against the road his turning was
    centred within 10 m of the road's on 11. The note now also needs the line early on the map, and with no road known
    it says nothing about the line. Not softer: a corner whose line is early is still told."""
    v, lon, lat, s, e, a = _early_corner(56, 56)
    m = da.corner_phases(v, lon, lat, s, e, a, 25.0)
    assert da._tip({**m, "road_off_m": -20.0}, None)["kind"] == "early_apex"
    assert da._tip({**m, "road_off_m": -15.0}, None)["kind"] == "early_apex"
    assert da._tip({**m, "road_off_m": -5.0}, None) is None           # slowest early, but the line with the road
    assert da._tip({**m, "road_off_m": None}, None) is None           # no road: no claim
    assert da._tip(m, None) is None


def test_the_line_against_the_road_is_the_same_in_the_app():
    """web/apex_core.js roadTurnOffsetM is the port of road_turn_offset_m."""
    import json, shutil, subprocess
    from pathlib import Path
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not installed")
    cases = []
    for t in (56, 60, 64, 52):
        v, g, la, lo, s, e = _road_corner(t)
        cases.append({"v": v.tolist(), "g": g.tolist(), "la": la, "lo": lo, "s": s, "e": e})
    cases.append({**cases[0], "la": [None if i == 60 else x for i, x in enumerate(cases[0]["la"])]})
    js = "const C = require(process.argv[1]); const k = JSON.parse(process.argv[2]); console.log(JSON.stringify(k.map((c) => C.roadTurnOffsetM(c.la, c.lo, c.v, c.g, c.s, c.e))))"
    got = json.loads(subprocess.run([node, "-e", js, str(Path(__file__).resolve().parents[1] / "web" / "apex_core.js"), json.dumps(cases)],
                                    capture_output=True, text=True, check=True).stdout)
    want = [da.road_turn_offset_m(c["la"], c["lo"], np.asarray(c["v"]), np.asarray(c["g"]), c["s"], c["e"]) for c in cases]
    assert got[-1] is None and want[-1] is None
    assert got[:-1] == pytest.approx(want[:-1], abs=1e-6), (got, want)


def test_the_motion_sensors_slowest_point_is_the_same_in_the_app():
    """web/apex_core.js imuSlowM is the port of _imu_slow_m: the same metres on the same corner, unknown g included."""
    import json, shutil, subprocess
    from pathlib import Path
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not installed")
    cases = []
    for vm, lc in ((56, 56), (56, 60), (60, 52), (50, 64)):
        v, lon, lat, s, e, a = _early_corner(vm, lc)
        lon = [None if i in (40, 41) else float(x) for i, x in enumerate(lon)]   # unknown g before the corner
        cases.append({"v": v.tolist(), "lon": lon, "lat": lat.tolist(), "s": s, "e": e})
    js = "const C = require(process.argv[1]); const k = JSON.parse(process.argv[2]); console.log(JSON.stringify(k.map((c) => C.imuSlowM(c.v, c.lon, c.lat, c.s, c.e))))"
    got = json.loads(subprocess.run([node, "-e", js, str(Path(__file__).resolve().parents[1] / "web" / "apex_core.js"), json.dumps(cases)],
                                    capture_output=True, text=True, check=True).stdout)
    want = [da._imu_slow_m(np.asarray(c["v"]), np.asarray([np.nan if x is None else x for x in c["lon"]]), np.asarray(c["lat"]), c["s"], c["e"]) for c in cases]
    assert got == want and want[:2] == [-20.0, 0.0], (got, want)


def _drive_with_g_ahead(ahead):
    """A winding drive whose phone g runs `ahead` bins ahead of GPS (as builds before Nov 14 recorded it)."""
    import math as m
    n = 400
    x = np.arange(n) * 5.0
    lat = (39.0 + (12.0 * np.sin(x / 25.0)) / 110540.0).tolist()
    lon = (-84.0 + x / (111320.0 * m.cos(m.radians(39.0)))).tolist()
    v = (18.0 + 4.0 * np.sin(x / 30.0)).tolist()
    kappa, _ = da.rd.compute_curvature(np.asarray(lat), np.asarray(lon))
    true_lat = [v[i] * v[i] * kappa[i] / da.G for i in range(n)]
    true_lon = [((v[min(n - 1, i + 1)] - v[max(0, i - 1)]) / (10.0 / v[i])) / da.G for i in range(n)]
    sh = lambda a: [a[min(n - 1, i + ahead)] for i in range(n)]
    return {"lat": lat, "lon": lon, "speed_mps": v, "lon_g": sh(true_lon), "lat_g": sh(true_lat), "g_known": [1] * n}


def test_the_phones_g_is_put_back_on_gps_places():
    """Nate's drives (2026-11-15): builds before Nov 14 put g 2 bins ahead of GPS, so braking read as done 10 m early. The lag
    is read from the drive (a_lon against GPS dv/dt, a_lat against v^2 kappa) and undone; a drive in step is left alone."""
    import json, shutil, subprocess
    from pathlib import Path
    d = _drive_with_g_ahead(2)
    assert da.imu_lag_bins(d) == -2
    fixed = da.align_imu(d, -2)
    assert da.imu_lag_bins(fixed) == 0 and fixed["lat_g"][:2] == [None, None] and fixed["g_known"][:2] == [0, 0]
    assert fixed["lat_g"][100] == d["lat_g"][98]
    assert da.imu_lag_bins(_drive_with_g_ahead(0)) == 0
    node = shutil.which("node")
    if node is None:
        return
    js = "const C = require(process.argv[1]); const k = JSON.parse(process.argv[2]); console.log(JSON.stringify(k.map((d) => C.imuLagBins(d))))"
    got = json.loads(subprocess.run([node, "-e", js, str(Path(__file__).resolve().parents[1] / "web" / "apex_core.js"),
                                     json.dumps([_drive_with_g_ahead(2), _drive_with_g_ahead(0), _drive_with_g_ahead(-1)])],
                                    capture_output=True, text=True, check=True).stdout)
    assert got == [-2, 0, da.imu_lag_bins(_drive_with_g_ahead(-1))]
