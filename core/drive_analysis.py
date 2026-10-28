"""Private drive analysis: compare passes of the same road, corner by corner.

docs/SOCIAL.md section 3. Inputs are profiled 5 m bins (index i <-> distance 5 i).
Drive B is measured over the *same physical stretch* as each corner of drive A, found by
location, so the comparison does not depend on both drives detecting the same corner.
`web/apex_core.js` (analysis section) is held to parity by tests/test_web_core_parity.py.
"""
from __future__ import annotations

import math

import numpy as np

from core import road_dna as rd

G = rd.G_STD
MATCH_RADIUS_M = 20.0        # a B sample must lie this close to A's path to count as the same road
SEARCH_WINDOW = 400          # samples searched around the previous match (2 km)
BRAKE_G = -0.15              # a_lon below this counts as braking
BRAKE_LOOKBACK = 40          # search 200 m before the apex for the brake point
DELTA_STRIDE = 5             # delta curve every 25 m
STOPPED_MPS = 2.5            # below this through a corner, the time measures waiting, not driving
PACE_TARGET = 0.85           # Driver Score: full pace credit from 85 % of the corner's sane grip limit...
PACE_CEILING = 1.0           # ...held to 100 %, then falling steeply: overdriving is never rewarded


def elapsed_s(speed_mps, ds: float = 5.0) -> np.ndarray:
    """Time at each 5 m bin from bin speeds."""
    v = np.maximum(np.asarray(speed_mps, dtype=float), 0.5)
    return np.concatenate([[0.0], np.cumsum(ds / v[:-1])])


def nearest_index(lat, lon, path_lat, path_lon, hint: int = -1, window: int = SEARCH_WINDOW):
    """(index, distance m) of the nearest path sample; windowed around hint when hint >= 0."""
    n = len(path_lat)
    lo, hi = (max(0, hint - window), min(n, hint + window)) if hint >= 0 else (0, n)
    c = math.cos(math.radians(lat))
    dx = (np.asarray(path_lon[lo:hi]) - lon) * 111320.0 * c
    dy = (np.asarray(path_lat[lo:hi]) - lat) * 110540.0
    d2 = dx * dx + dy * dy
    k = int(np.argmin(d2))
    return lo + k, float(math.sqrt(d2[k]))


def corner_metrics(speed_mps, lon_g, lat_g, start: int, end: int, apex: int, apex_mps: float) -> dict:
    """Technique and time through one corner window [start, end] (inclusive bins)."""
    v = np.asarray(speed_mps, dtype=float)
    seg = slice(start, end + 1)
    t = elapsed_s(v[seg])
    i_min = start + int(np.argmin(v[seg]))
    lon = np.asarray(lon_g, dtype=float)
    lat = np.asarray(lat_g, dtype=float)

    brake_m = None
    i = apex
    lo = max(0, apex - BRAKE_LOOKBACK)
    while i > lo and lon[i] < BRAKE_G:
        i -= 1
    if i < apex:
        brake_m = (apex - i) * 5.0
    else:
        braking = np.flatnonzero(lon[lo:apex + 1] < BRAKE_G)
        if len(braking):
            brake_m = (apex - (lo + int(braking[0]))) * 5.0

    lat_seg = lat[seg]
    dt = 5.0 / np.maximum(v[seg], 0.5)
    jerk = np.diff(lat_seg) / dt[:-1] if len(lat_seg) > 1 else np.zeros(1)
    return {
        "time_s": float(t[-1] + 5.0 / max(v[end], 0.5)),
        "entry_mps": float(v[start]),
        "min_mps": float(v[i_min]),
        "exit_mps": float(v[end]),
        "min_offset_m": (i_min - apex) * 5.0,          # < 0 early apex, > 0 late apex
        "brake_m": brake_m,
        "peak_brake_g": float(min(0.0, np.min(lon[lo:apex + 1]))),
        "peak_lat_g": float(np.max(np.abs(lat_seg))),
        "envelope_use": float(v[i_min] / max(apex_mps, 0.5)),
        "smoothness_gps": float(np.sqrt(np.mean(jerk ** 2))),
    }


def match_window(a: dict, start: int, end: int, b: dict, hint: int = -1):
    """B's bins covering A's [start, end], same direction, or None."""
    bs, ds_ = nearest_index(a["lat"][start], a["lon"][start], b["lat"], b["lon"], hint)
    if ds_ > MATCH_RADIUS_M:
        bs, ds_ = nearest_index(a["lat"][start], a["lon"][start], b["lat"], b["lon"], -1)
        if ds_ > MATCH_RADIUS_M:
            return None
    be, de = nearest_index(a["lat"][end], a["lon"][end], b["lat"], b["lon"], bs, 2 * (end - start) + 20)
    if de > MATCH_RADIUS_M or be <= bs:
        return None
    ratio = (be - bs) / max(1, end - start)
    if not 0.7 <= ratio <= 1.3:
        return None
    return bs, be


def compare(a: dict, b: dict) -> dict:
    """Corner-by-corner and cumulative comparison of drive B against drive A.

    a, b: {lat, lon, speed_mps, lon_g, lat_g, corners: [{start, end, apex, apex_mps, code, call}]}
    """
    corners = []
    hint = -1
    for c in a["corners"]:
        ma = corner_metrics(a["speed_mps"], a["lon_g"], a["lat_g"], c["start"], c["end"], c["apex"], c["apex_mps"])
        w = match_window(a, c["start"], c["end"], b, hint)
        mb = None
        if w is not None:
            bs, be = w
            hint = be
            # floor(x + 0.5), not round(): Python rounds halves to even, JS (the port) rounds up.
            b_apex = bs + int(math.floor((c["apex"] - c["start"]) * (be - bs) / max(1, c["end"] - c["start"]) + 0.5))
            mb = corner_metrics(b["speed_mps"], b["lon_g"], b["lat_g"], bs, be, b_apex, c["apex_mps"])
        stopped = ma["min_mps"] < STOPPED_MPS or (mb is not None and mb["min_mps"] < STOPPED_MPS)
        corners.append({"code": c["code"], "call": c["call"], "apex": c["apex"], "a": ma, "b": mb,
                        "stopped": bool(stopped),
                        "delta_s": None if mb is None else mb["time_s"] - ma["time_s"]})

    # Cumulative delta along A over every run where B drives the same road, same direction.
    ta, tb = elapsed_s(a["speed_mps"]), elapsed_s(b["speed_mps"])
    curve = []
    overlap_bins = 0
    run_a0 = run_b0 = None
    run_total, run_last = 0.0, 0.0
    prev_j = -1
    for i in range(0, len(a["lat"]), DELTA_STRIDE):
        j, d = nearest_index(a["lat"][i], a["lon"][i], b["lat"], b["lon"], prev_j)
        if d > MATCH_RADIUS_M and prev_j >= 0:
            j, d = nearest_index(a["lat"][i], a["lon"][i], b["lat"], b["lon"], -1)
        same_way = prev_j < 0 or j >= prev_j
        if d <= MATCH_RADIUS_M and same_way:
            if run_a0 is None:
                run_a0, run_b0 = i, j
            run_last = float((tb[j] - tb[run_b0]) - (ta[i] - ta[run_a0]))
            curve.append([i * 5.0, run_last])
            overlap_bins += DELTA_STRIDE
            prev_j = j
        else:
            if run_a0 is not None:
                curve.append([i * 5.0, None])   # gap marker: delta restarts on the next run
                run_total += run_last
                run_last = 0.0
            run_a0 = run_b0 = None
            prev_j = j if d <= MATCH_RADIUS_M else -1
    run_total += run_last if run_a0 is not None else 0.0
    matched = [c for c in corners if c["delta_s"] is not None and not c["stopped"]]
    return {
        "corners": corners,
        "overlap_m": overlap_bins * 5.0,
        "matched_corners": len(matched),
        "corner_delta_s": float(sum(c["delta_s"] for c in matched)),
        "overlap_delta_s": run_total,
        "delta_curve": curve,
    }


# ---------------------------------------------------------------------------
# Driver Score: an obfuscated 0-1000 rating of technique, never of time or speed.
# ---------------------------------------------------------------------------

def _pace_credit(use: float) -> float:
    if use <= PACE_TARGET:
        return max(0.0, use / PACE_TARGET)
    if use <= PACE_CEILING:
        return 1.0
    return max(0.0, 1.0 - 4.0 * (use - PACE_CEILING))     # 125 % of the limit earns nothing


def driver_score(speed_mps, lon_g, lat_g, corners, lo: int = 0, hi=None) -> dict:
    """Score the driving between bins [lo, hi). corners: [{start, end, apex, apex_mps}].

    pace 40 %, smoothness 25 %, braking discipline 15 %, consistency 20 %. score None when no
    clean corners. Technique only: posted limits and legality never enter it, and a perfect score
    (driving at the corner limit) is a closed-track figure, not a goal for public roads.
    """
    v = np.asarray(speed_mps, dtype=float)
    lon = np.asarray(lon_g, dtype=float)
    hi = len(v) if hi is None else hi
    uses, pace, smooth, brake = [], [], [], []
    for c in corners:
        if c["start"] < lo or c["end"] >= hi or not math.isfinite(c["apex_mps"]):
            continue
        if not np.all(np.isfinite(v[c["start"]:c["end"] + 1])):    # a speed gap (blank GPS speed) leaves the corner out, not NaN
            continue
        m = corner_metrics(v, lon_g, lat_g, c["start"], c["end"], c["apex"], c["apex_mps"])
        if m["min_mps"] < STOPPED_MPS:
            continue
        uses.append(m["envelope_use"])
        pace.append(_pace_credit(m["envelope_use"]))
        # Smoothness per metre of road (speed-invariant): how abruptly lateral load changes.
        lat = np.asarray(lat_g, dtype=float)[c["start"]:c["end"] + 1]
        step = float(np.sqrt(np.mean(np.diff(lat) ** 2))) if len(lat) > 1 else 0.0
        smooth.append(math.exp(-step / 0.15))
        late = max(0.0, -float(np.min(lon[c["apex"]:c["end"] + 1])))       # braking after the apex
        brake.append(1.0 - min(1.0, max(0.0, (late - 0.10) / 0.30)))
    if not uses:
        return {"score": None, "corners": 0, "components": None}
    consistency = 1.0 - min(1.0, float(np.std(uses)) / 0.25)
    comp = {"pace": float(np.mean(pace)), "smoothness": float(np.mean(smooth)),
            "braking": float(np.mean(brake)), "consistency": consistency}
    raw = 0.40 * comp["pace"] + 0.25 * comp["smoothness"] + 0.15 * comp["braking"] + 0.20 * comp["consistency"]
    return {"score": int(np.floor(1000.0 * raw + 0.5)), "corners": len(uses),   # JS Math.round
            "components": {k: round(val, 4) for k, val in comp.items()}}


# ---------------------------------------------------------------------------
# Corner coach: how each corner was driven (brake, trail, coast, throttle) and where the time is.
# Compared against the person's own best clean pass of the same corner, never against a limit.
# ---------------------------------------------------------------------------

COAST_G = 0.05               # |a_lon| below this: neither braking nor driving, the car is coasting
THROTTLE_G = 0.05            # a_lon above this after the slowest point counts as back on the throttle
TRAIL_LAT_G = 0.20           # braking while this much lateral load is on counts as trail braking
THROTTLE_LOOKAHEAD = 20      # search 100 m past the corner exit for the throttle point
TIP_SPEED_MPS = 0.9          # ~2 mph at the slowest point is a real difference, less is GPS noise
TIP_BRAKE_M = 10.0           # two bins of brake or throttle point
TIP_COAST_M = 15.0
TIP_GAIN_S = 0.10            # a corner worth less than this is not an opportunity
SOLO_COAST_M = 20.0          # without a better pass: this much coasting after braking is worth a note
SOLO_EARLY_APEX_M = -15.0    # ...slowest point this far before the apex
SOLO_LATE_BRAKE_G = 0.25     # ...braking this hard after the apex
TOP_OPPORTUNITIES = 3


def corner_phases(speed_mps, lon_g, lat_g, start: int, end: int, apex: int, apex_mps: float) -> dict:
    """corner_metrics plus the phases of the corner: trail braking, coasting and the throttle point.

    trail_m: metres braking (a_lon < BRAKE_G) with |a_lat| >= TRAIL_LAT_G before the apex.
    coast_m: metres with |a_lon| < COAST_G from the brake point (or corner start) to the throttle point (or exit).
    throttle_m: throttle point relative to the apex (< 0 before it); None if not back on the throttle by 100 m after.
    """
    m = corner_metrics(speed_mps, lon_g, lat_g, start, end, apex, apex_mps)
    v = np.asarray(speed_mps, dtype=float)
    lon = np.asarray(lon_g, dtype=float)
    lat = np.asarray(lat_g, dtype=float)
    n = len(v)
    lo = max(0, apex - BRAKE_LOOKBACK)
    i_min = apex + int(round(m["min_offset_m"] / 5.0))
    trail = int(np.count_nonzero((lon[lo:apex + 1] < BRAKE_G) & (np.abs(lat[lo:apex + 1]) >= TRAIL_LAT_G)))
    k_thr = None
    for k in range(i_min, min(n, end + THROTTLE_LOOKAHEAD + 1)):
        if lon[k] > THROTTLE_G:
            k_thr = k
            break
    b0 = start if m["brake_m"] is None else apex - int(round(m["brake_m"] / 5.0))
    b1 = end if k_thr is None else k_thr
    coast = int(np.count_nonzero(np.abs(lon[b0:b1 + 1]) < COAST_G)) if b1 >= b0 else 0
    late = max(0.0, -float(np.min(lon[apex:end + 1])))
    return {**m, "trail_m": trail * 5.0, "coast_m": coast * 5.0,
            "throttle_m": None if k_thr is None else (k_thr - apex) * 5.0, "late_brake_g": late}


def _known(drive: dict, lo: int, hi: int) -> bool:
    """Speed measured through [lo, hi] and, when the drive says which bins have measured g, g as well."""
    v = np.asarray(drive["speed_mps"][lo:hi + 1], dtype=float)
    if not np.all(np.isfinite(v)):
        return False
    gk = drive.get("g_known")
    return gk is None or all(gk[lo:hi + 1])


def _tip(m: dict, ref: dict | None):
    """The one thing to change in this corner, as {kind, value}, or None. ref: the best other pass (faster)."""
    if ref is not None:
        if ref["min_mps"] - m["min_mps"] >= TIP_SPEED_MPS:
            return {"kind": "min_speed", "value": ref["min_mps"] - m["min_mps"]}
        if m["brake_m"] is not None and ref["brake_m"] is not None and m["brake_m"] - ref["brake_m"] >= TIP_BRAKE_M:
            return {"kind": "brake_later", "value": m["brake_m"] - ref["brake_m"]}
        if m["throttle_m"] is not None and ref["throttle_m"] is not None and m["throttle_m"] - ref["throttle_m"] >= TIP_BRAKE_M:
            return {"kind": "throttle_sooner", "value": m["throttle_m"] - ref["throttle_m"]}
        if m["coast_m"] - ref["coast_m"] >= TIP_COAST_M:
            return {"kind": "coast", "value": m["coast_m"] - ref["coast_m"]}
        return None
    if m["late_brake_g"] >= SOLO_LATE_BRAKE_G:
        return {"kind": "brake_after_apex", "value": m["late_brake_g"]}
    if m["brake_m"] is not None and m["coast_m"] >= SOLO_COAST_M:     # dead time between brake and throttle
        return {"kind": "coast", "value": m["coast_m"]}
    if m["min_offset_m"] <= SOLO_EARLY_APEX_M:
        return {"kind": "early_apex", "value": -m["min_offset_m"]}
    return None


def coach(a: dict, others: list) -> dict:
    """Corner-by-corner coaching for drive a against the person's other drives.

    a, others: {lat, lon, speed_mps, lon_g, lat_g, corners, g_known?}. For each corner of a: its phases,
    the best clean pass of the same stretch among a and others (passes over the sane corner limit
    never count as best: overdriving is not a reference), the time a lost to it and one tip.
    ideal_s: sum of the best passes over the corners a drove cleanly; gain_s = a's time there - ideal_s.
    """
    hints = [-1] * len(others)
    out = []
    for c in a["corners"]:
        if not math.isfinite(c["apex_mps"]) or not _known(a, c["start"], c["end"]):
            out.append({"apex": c["apex"], "m": None, "best": None, "gain_s": None, "tip": None, "passes": 0})
            continue
        ma = corner_phases(a["speed_mps"], a["lon_g"], a["lat_g"], c["start"], c["end"], c["apex"], c["apex_mps"])
        if ma["min_mps"] < STOPPED_MPS:
            out.append({"apex": c["apex"], "m": ma, "best": None, "gain_s": None, "tip": None, "passes": 0})
            continue
        best, best_from, passes = ma, -1, 1
        for j, b in enumerate(others):
            w = match_window(a, c["start"], c["end"], b, hints[j])
            if w is None:
                continue
            bs, be = w
            hints[j] = be
            if not _known(b, bs, be):
                continue
            b_apex = bs + int(math.floor((c["apex"] - c["start"]) * (be - bs) / max(1, c["end"] - c["start"]) + 0.5))
            mb = corner_phases(b["speed_mps"], b["lon_g"], b["lat_g"], bs, be, b_apex, c["apex_mps"])
            if mb["min_mps"] < STOPPED_MPS:
                continue
            passes += 1
            if mb["envelope_use"] <= PACE_CEILING and mb["time_s"] < best["time_s"]:
                best, best_from = mb, j
        gain = ma["time_s"] - best["time_s"]
        tip = _tip(ma, best if best_from >= 0 and gain >= TIP_GAIN_S else None)
        out.append({"apex": c["apex"], "m": ma, "best": None if best_from < 0 else best, "best_from": best_from,
                    "gain_s": gain, "tip": tip, "passes": passes})
    clean = [x for x in out if x["gain_s"] is not None]
    this_s = float(sum(x["m"]["time_s"] for x in clean))
    gain_s = float(sum(x["gain_s"] for x in clean))
    order = sorted((k for k, x in enumerate(out) if x["gain_s"] is not None and x["gain_s"] >= TIP_GAIN_S),
                   key=lambda k: (-out[k]["gain_s"], k))
    return {"corners": out, "clean": len(clean), "this_s": this_s, "ideal_s": this_s - gain_s, "gain_s": gain_s,
            "top": order[:TOP_OPPORTUNITIES]}


def segment_window(seg: dict, drive: dict):
    """Bins [lo, hi] where a drive passes a user segment {lat0, lon0, lat1, lon1, length_m}
    from start to end in that direction, or None."""
    i0, d0 = nearest_index(seg["lat0"], seg["lon0"], drive["lat"], drive["lon"], -1)
    if d0 > MATCH_RADIUS_M:
        return None
    span = int(seg["length_m"] / 5.0)
    i1, d1 = nearest_index(seg["lat1"], seg["lon1"], drive["lat"], drive["lon"], i0 + span, max(40, span // 2))
    if d1 > MATCH_RADIUS_M or i1 <= i0:
        return None
    if not 0.7 <= (i1 - i0) / max(1, span) <= 1.3:
        return None
    return i0, i1


def segment_pass(seg: dict, drive: dict):
    """Time and Driver Score of one drive over a segment (private: the time stays on-device)."""
    w = segment_window(seg, drive)
    if w is None:
        return None
    lo, hi = w
    t = elapsed_s(drive["speed_mps"])
    ds = driver_score(drive["speed_mps"], drive["lon_g"], drive["lat_g"], drive["corners"], lo, hi + 1)
    return {"lo": lo, "hi": hi, "time_s": float(t[hi] - t[lo]), **ds}
