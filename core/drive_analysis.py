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
