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


def corner_technique(v, lon_g, lat_g, c: dict):
    """One clean corner's Driver Score inputs: envelope use, smoothness and braking credit (0..1), or None when the
    corner is not scored (unknown apex speed, a speed or g gap, or a stop through it)."""
    if not math.isfinite(c["apex_mps"]):
        return None
    v = np.asarray(v, dtype=float)
    span = slice(c["start"], c["end"] + 1)
    if not np.all(np.isfinite(v[span])):    # a speed gap (blank GPS speed) leaves the corner out, not NaN
        return None
    if not (np.all(np.isfinite(np.asarray(lat_g, dtype=float)[span])) and np.all(np.isfinite(np.asarray(lon_g, dtype=float)[span]))):
        return None
    m = corner_metrics(v, lon_g, lat_g, c["start"], c["end"], c["apex"], c["apex_mps"])
    if m["min_mps"] < STOPPED_MPS:
        return None
    # Smoothness per metre of road (speed-invariant): how abruptly lateral load changes.
    lat = np.asarray(lat_g, dtype=float)[c["start"]:c["end"] + 1]
    step = float(np.sqrt(np.mean(np.diff(lat) ** 2))) if len(lat) > 1 else 0.0
    late = max(0.0, -float(np.min(np.asarray(lon_g, dtype=float)[c["apex"]:c["end"] + 1])))   # braking after the apex
    return {"use": m["envelope_use"], "smooth": math.exp(-step / 0.15),
            "brake": 1.0 - min(1.0, max(0.0, (late - 0.10) / 0.30))}


def driver_score(speed_mps, lon_g, lat_g, corners, lo: int = 0, hi=None) -> dict:
    """Score the driving between bins [lo, hi). corners: [{start, end, apex, apex_mps}].

    pace 40 %, smoothness 25 %, braking discipline 15 %, consistency 20 %. score None when no
    clean corners. Technique only: posted limits and legality never enter it, and a perfect score
    (driving at the corner limit) is a closed-track figure, not a goal for public roads.
    """
    v = np.asarray(speed_mps, dtype=float)
    hi = len(v) if hi is None else hi
    uses, pace, smooth, brake = [], [], [], []
    for c in corners:
        if c["start"] < lo or c["end"] >= hi:
            continue
        t = corner_technique(v, lon_g, lat_g, c)
        if t is None:
            continue
        uses.append(t["use"])
        pace.append(_pace_credit(t["use"]))
        smooth.append(t["smooth"])
        brake.append(t["brake"])
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
BRAKE_GAP = 20               # braking that ended more than 100 m before turn-in belongs to something else
SOLO_APEX_DIP_MPS = 0.3      # early-apex note only when the apex itself is this much faster than the slowest point
THROTTLE_LOOKAHEAD = 20      # search 100 m past the corner exit for the throttle point
TIP_SPEED_MPS = 0.9          # ~2 mph at the slowest point is a real difference, less is GPS noise
TIP_BRAKE_M = 10.0           # two bins of brake or throttle point
TIP_COAST_M = 15.0
TIP_GAIN_S = 0.20            # a corner worth less than this is not an opportunity (GPS alignment noise is ~0.1 s)
SOLO_COAST_M = 20.0          # without a better pass: this much coasting after braking is worth a note
SOLO_EARLY_APEX_M = -15.0    # ...slowest point this far before the apex
SOLO_LATE_BRAKE_G = 0.25     # ...braking this hard after the apex
TOP_OPPORTUNITIES = 3


def corner_phases(speed_mps, lon_g, lat_g, start: int, end: int, apex: int, apex_mps: float) -> dict:
    """corner_metrics plus the phases of the corner: its own brake zone, trail braking, coasting and the throttle point.

    brake_m (replaces corner_metrics'): start of the braking run nearest the apex, in m before it, None when that run
      ends more than BRAKE_GAP bins before the corner starts (that braking was for something else).
    trail_m: metres of that run with |a_lat| >= TRAIL_LAT_G, before the apex.
    coast_m: metres with |a_lon| < COAST_G from the brake point (or corner start) to the throttle point (or exit).
    throttle_m: throttle point relative to the apex (< 0 before it); None if not back on the throttle by 100 m after.
    """
    m = corner_metrics(speed_mps, lon_g, lat_g, start, end, apex, apex_mps)
    v = np.asarray(speed_mps, dtype=float)
    lon = np.asarray(lon_g, dtype=float)
    lat = np.asarray(lat_g, dtype=float)
    n = len(v)
    lo = max(0, apex - BRAKE_LOOKBACK)
    r1 = apex
    while r1 >= lo and not lon[r1] < BRAKE_G:
        r1 -= 1
    r0 = None
    if r1 >= lo and r1 >= start - BRAKE_GAP:
        r0 = r1
        while r0 - 1 >= lo and lon[r0 - 1] < BRAKE_G:
            r0 -= 1
    trail = 0 if r0 is None else sum(1 for k in range(r0, r1 + 1) if abs(lat[k]) >= TRAIL_LAT_G)
    i_min = apex + int(round(m["min_offset_m"] / 5.0))
    k_thr = None
    for k in range(i_min, min(n, end + THROTTLE_LOOKAHEAD + 1)):
        if lon[k] > THROTTLE_G:
            k_thr = k
            break
    b0 = start if r0 is None else r0
    b1 = end if k_thr is None else k_thr
    coast = sum(1 for k in range(b0, b1 + 1) if abs(lon[k]) < COAST_G)
    late = 0.0
    for k in range(apex, end + 1):
        late = max(late, -float(lon[k]))
    return {**m, "brake_m": None if r0 is None else (apex - r0) * 5.0, "trail_m": trail * 5.0, "coast_m": coast * 5.0,
            "throttle_m": None if k_thr is None else (k_thr - apex) * 5.0, "late_brake_g": late,
            "apex_mps_driven": float(v[apex])}


def _known(drive: dict, start: int, end: int, apex: int) -> bool:
    """A corner the coach may read: apex inside it, speed measured through it and, when the drive says which bins have
    measured g, g measured over every bin corner_phases reads (the brake lookback to the throttle lookahead)."""
    v, gk, n = drive["speed_mps"], drive.get("g_known"), len(drive["speed_mps"])
    if not (0 <= start <= apex <= end < n):
        return False
    for q in range(start, end + 1):
        if v[q] is None or not math.isfinite(v[q]):
            return False
    if gk is None:
        return True
    for q in range(max(0, apex - BRAKE_LOOKBACK), min(n - 1, end + THROTTLE_LOOKAHEAD) + 1):
        if q >= len(gk) or not gk[q]:
            return False
    return True


def _frac_index(lat: float, lon: float, b: dict, j: int) -> float:
    """Fractional bin index of the point's projection onto b's path next to bin j (5 m bins: arc = 5 x index)."""
    n = len(b["lat"])
    c = math.cos(math.radians(lat))
    xy = lambda k: ((b["lon"][k] - lon) * 111320.0 * c, (b["lat"][k] - lat) * 110540.0)
    best = None
    for k in (j - 1, j):
        if k < 0 or k + 1 >= n:
            continue
        (x0, y0), (x1, y1) = xy(k), xy(k + 1)
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy
        u = 0.0 if L2 <= 0 else min(1.0, max(0.0, -(x0 * dx + y0 * dy) / L2))
        px, py = x0 + u * dx, y0 + u * dy
        d2 = px * px + py * py
        if best is None or d2 < best[0]:
            best = (d2, k + u)
    return float(j) if best is None else best[1]


def _cum_time_at(t: np.ndarray, v: np.ndarray, x: float) -> float:
    """Elapsed time at fractional bin x (t[k] = time at the start of bin k; bin k is crossed at v[k])."""
    k = int(math.floor(x))
    return float(t[k] + (x - k) * 5.0 / max(float(v[k]), 0.5))


def aligned_time_s(a: dict, start: int, end: int, b: dict, bs: int):
    """b's time over exactly a's stretch [start, end] (bins inclusive), aligned to a fraction of a bin.

    Each of a's bins is projected onto b's path; the median offset (robust to GPS jitter) places a's stretch on b,
    and b's time is integrated over it with fractional ends. None when the stretch runs off b.
    """
    offs = []
    for i in range(start, end + 1):
        j, _ = nearest_index(a["lat"][i], a["lon"][i], b["lat"], b["lon"], min(len(b["lat"]) - 1, bs + (i - start)), 6)
        offs.append(_frac_index(a["lat"][i], a["lon"][i], b, j) - i)
    offs.sort()
    h = len(offs) // 2
    off = offs[h] if len(offs) % 2 else 0.5 * (offs[h - 1] + offs[h])
    x0, x1 = start + off, end + 1 + off
    vb = np.asarray(b["speed_mps"], dtype=float)
    if x0 < 0 or x1 > len(vb) - 1:
        return None
    if not np.all(np.isfinite(vb[int(math.floor(x0)):int(math.floor(x1)) + 1])):
        return None
    k0 = int(math.floor(x0))
    seg = vb[k0:int(math.floor(x1)) + 1]
    t = elapsed_s(seg)                                  # only over the stretch: a blank speed elsewhere does not matter
    return _cum_time_at(t, seg, x1 - k0) - _cum_time_at(t, seg, x0 - k0)


def _tip(m: dict, ref: dict | None):
    """The one thing to change in this corner, as {kind, value, vs_best}, or None. ref: the best other pass (faster);
    vs_best says whether value is a difference to it or this pass's own number."""
    if ref is not None:
        if ref["min_mps"] - m["min_mps"] >= TIP_SPEED_MPS:
            return {"kind": "min_speed", "value": ref["min_mps"] - m["min_mps"], "vs_best": True}
        if m["brake_m"] is not None and ref["brake_m"] is not None and m["brake_m"] - ref["brake_m"] >= TIP_BRAKE_M:
            return {"kind": "brake_later", "value": m["brake_m"] - ref["brake_m"], "vs_best": True}
        if m["throttle_m"] is not None and ref["throttle_m"] is not None and m["throttle_m"] - ref["throttle_m"] >= TIP_BRAKE_M:
            return {"kind": "throttle_sooner", "value": m["throttle_m"] - ref["throttle_m"], "vs_best": True}
        if m["coast_m"] - ref["coast_m"] >= TIP_COAST_M:
            return {"kind": "coast", "value": m["coast_m"] - ref["coast_m"], "vs_best": True}
        ta, tr = m.get("turn_in_m"), ref.get("turn_in_m")
        if ta is not None and tr is not None and ta - tr >= TIP_TURN_M:
            return {"kind": "turn_in_later", "value": ta - tr, "vs_best": True}
        return None
    if m["late_brake_g"] >= SOLO_LATE_BRAKE_G:
        return {"kind": "brake_after_apex", "value": m["late_brake_g"], "vs_best": False}
    if m["brake_m"] is not None and m["coast_m"] >= SOLO_COAST_M:     # dead time between brake and throttle
        return {"kind": "coast", "value": m["coast_m"], "vs_best": False}
    if m["min_offset_m"] <= SOLO_EARLY_APEX_M and m["apex_mps_driven"] - m["min_mps"] >= SOLO_APEX_DIP_MPS:
        return {"kind": "early_apex", "value": -m["min_offset_m"], "vs_best": False}
    return None


SPREAD_MIN_PASSES = 3        # a spread from fewer passes says nothing
SPREAD_BRAKE_G = -0.20       # a pass whose (3-bin smoothed) braking peaks lighter than this has no clear braking point
SPREAD_ONSET = 0.4           # braking starts where the smoothed deceleration first reaches 40 % of that pass's peak
SLOW_DIP_MPS = 1.0           # a slowest point counts only this far below both ends of the corner
SLOW_BAND_MPS = 0.2          # ...placed at the middle of the bins within this of the minimum
SLOW_GAP = 2                 # ...bridging gaps of up to this many bins


def _median(xs: list) -> float:
    s = sorted(xs)
    k = len(s) // 2
    return s[k] if len(s) % 2 else (s[k - 1] + s[k]) / 2.0


def _sd(xs: list):
    """Robust spread: 1.4826 x the median absolute deviation (equals the SD for normal scatter), so one odd pass, behind
    traffic or in the wet, does not make a corner look erratic. None under SPREAD_MIN_PASSES values."""
    if len(xs) < SPREAD_MIN_PASSES:
        return None
    m = _median(xs)
    return 1.4826 * _median([abs(x - m) for x in xs])


def _marks(d: dict, start: int, end: int, apex: int) -> tuple:
    """(braking onset, slowest point) of one pass as indexes into that pass, each None when it has no clear one.
    Both are made robust to sensor noise for the spread: the onset is where the 3-bin smoothed deceleration first reaches
    SPREAD_ONSET of its peak (None when the peak is lighter than SPREAD_BRAKE_G or the run reaches back past the lookback),
    and the slowest point needs a real dip (SLOW_DIP_MPS below both ends) and sits mid-way along the bins near the minimum."""
    lon, v, n = d["lon_g"], d["speed_mps"], len(d["speed_mps"])
    lo = max(0, apex - BRAKE_LOOKBACK)
    sm = lambda i: (float(lon[max(0, i - 1)]) + float(lon[i]) + float(lon[min(n - 1, i + 1)])) / 3.0
    onset = None
    k = apex                                     # the braking run nearest the apex, not a harder one for the corner before
    while k >= lo and not sm(k) <= SPREAD_BRAKE_G:
        k -= 1
    if k >= lo:
        r = k
        while r > lo and sm(r - 1) <= SPREAD_BRAKE_G:
            r -= 1
        pk = min(range(r, k + 1), key=lambda i: (sm(i), i))
        j = pk
        while j > lo and sm(j - 1) <= SPREAD_ONSET * sm(pk):
            j -= 1
        onset = j if j > lo else None
    i0 = min(range(start, end + 1), key=lambda i: (float(v[i]), i))
    vmin = float(v[i0])
    slow = None
    if vmin <= float(v[start]) - SLOW_DIP_MPS and vmin <= float(v[end]) - SLOW_DIP_MPS:
        near = lambda q: float(v[q]) <= vmin + SLOW_BAND_MPS
        a, b = i0, i0                            # the bins near the minimum around it, bridging gaps of up to SLOW_GAP
        while True:                              # bins (speed noise), not a second dip further on
            back = [q for q in range(max(start, a - 1 - SLOW_GAP), a) if near(q)]
            if not back:
                break
            a = back[-1]
        while True:
            ahead = [q for q in range(b + 1, min(end, b + 1 + SLOW_GAP) + 1) if near(q)]
            if not ahead:
                break
            b = ahead[0]
        slow = int(math.floor((a + b) / 2.0 + 0.5))
    return onset, slow


TURN_MIN_G = 0.20            # a corner whose (3-bin smoothed) lateral load peaks lighter than this has no clear turn-in
TURN_ONSET = 0.4             # turn-in is where the smoothed lateral load, towards the corner, first reaches 40 % of its peak
TIP_TURN_M = 15.0            # three bins earlier than the quicker pass (one bin of it is sensor noise): an early turn-in


def _turn_in(d: dict, start: int, end: int, apex: int):
    """Turn-in of one pass as an index into it, or None (IDEAS D-18). Phone GPS cannot place the car in its lane, but the
    accelerometer shows where the car began to turn: the start of the run, towards the corner (the sign of the load at the
    apex), where the 3-bin smoothed lateral g stays at or above TURN_ONSET of its peak in the corner. None when the peak is
    under TURN_MIN_G or the run reaches back past the brake lookback."""
    lat, n = d["lat_g"], len(d["lat_g"])
    lo = max(0, apex - BRAKE_LOOKBACK)
    sm = lambda i: (float(lat[max(0, i - 1)]) + float(lat[i]) + float(lat[min(n - 1, i + 1)])) / 3.0
    side = sm(apex)
    if not math.isfinite(side) or side == 0:
        return None
    y = lambda i: sm(i) if side > 0 else -sm(i)
    pk = max(range(start, end + 1), key=lambda i: (y(i), -i))
    if not y(pk) >= TURN_MIN_G:
        return None
    j = pk
    while j > lo and y(j - 1) >= TURN_ONSET * y(pk):
        j -= 1
    return j if j > lo and j <= apex else None


ON_A_WINDOW = 10             # bins either side of where a pass's mark should fall on A's road


def _on_a(a: dict, near: int, b: dict, i: int):
    """Bin of A's path nearest to sample i of pass b, searched only around `near` (where proportional mapping puts it) so
    a hairpin's other leg cannot capture it, or None when b was not on A's road there."""
    j, dist = nearest_index(b["lat"][i], b["lon"][i], a["lat"], a["lon"], max(0, near), ON_A_WINDOW)
    return j if dist <= MATCH_RADIUS_M else None


def _spread(brakes: list, mins: list, passes: int, froms: list) -> dict:
    """How repeatably a corner is driven over your clean passes of it (IDEAS D-07): a robust SD (`_sd`), in m along this drive's
    road, of where braking began and of where the slowest point fell, each over the passes that had a clear one. None
    with fewer than SPREAD_MIN_PASSES of them; 5 m bins and GPS put the floor near 3 m."""
    b = [x for x in brakes if x is not None]
    m = [x for x in mins if x is not None]
    return {"passes": passes, "brake_sd_m": _sd(b), "brake_passes": len(b), "min_sd_m": _sd(m), "min_passes": len(m),
            "marks": [[f, x, y] for f, x, y in zip(froms, brakes, mins)]}       # per pass: [-1 this drive | j in others, brake, slowest]


def coach(a: dict, others: list) -> dict:
    """Corner-by-corner coaching for drive a against the person's other drives.

    a, others: {lat, lon, speed_mps, lon_g, lat_g, corners, g_known?}. For each corner of a: its phases,
    the best clean pass of the same stretch among a and others (passes over the sane corner limit
    never count as best: overdriving is not a reference), the time a lost to it and one tip.
    gain_s: the sum of the corners' gains of at least TIP_GAIN_S (smaller ones are GPS alignment noise);
    ideal_s = a's time over its clean corners - gain_s. Other passes are timed over exactly a's stretch (aligned_time_s).
    """
    hints = [-1] * len(others)
    out = []
    for c in a["corners"]:
        if not math.isfinite(c["apex_mps"]) or not _known(a, c["start"], c["end"], c["apex"]):
            out.append({"apex": c["apex"], "m": None, "best": None, "gain_s": None, "tip": None, "passes": 0})
            continue
        ma = corner_phases(a["speed_mps"], a["lon_g"], a["lat_g"], c["start"], c["end"], c["apex"], c["apex_mps"])
        if ma["min_mps"] < STOPPED_MPS:
            out.append({"apex": c["apex"], "m": ma, "best": None, "gain_s": None, "tip": None, "passes": 0})
            continue
        best, best_from, passes = ma, -1, 1
        oa, sa = _marks(a, c["start"], c["end"], c["apex"])                 # D-07 marks, in m along A's road from its apex
        ta = _turn_in(a, c["start"], c["end"], c["apex"])
        ma["turn_in_m"] = None if ta is None else (c["apex"] - ta) * 5.0
        brakes = [None if oa is None else (c["apex"] - oa) * 5.0]
        mins = [None if sa is None else (sa - c["apex"]) * 5.0]
        froms = [-1]
        for j, b in enumerate(others):
            w = match_window(a, c["start"], c["end"], b, hints[j])
            if w is None:
                continue
            bs, be = w
            hints[j] = be
            b_apex = bs + int(math.floor((c["apex"] - c["start"]) * (be - bs) / max(1, c["end"] - c["start"]) + 0.5))
            if not _known(b, bs, be, b_apex):
                continue
            mb = corner_phases(b["speed_mps"], b["lon_g"], b["lat_g"], bs, be, b_apex, c["apex_mps"])
            # time over exactly A's stretch: a window a bin off would look up to 0.3 s quicker or slower
            tb = aligned_time_s(a, c["start"], c["end"], b, bs)
            if tb is None:
                continue
            mb["time_s"] = tb
            if mb["min_mps"] < STOPPED_MPS:
                continue
            passes += 1
            ob, sb = _marks(b, bs, be, b_apex)
            ob, sb = (None if x is None else _on_a(a, c["apex"] - (b_apex - x), b, x) for x in (ob, sb))
            ob = None if ob is not None and ob > c["apex"] else ob             # braking cannot begin past the apex
            tb_ = _turn_in(b, bs, be, b_apex)
            tb_ = None if tb_ is None else _on_a(a, c["apex"] - (b_apex - tb_), b, tb_)
            mb["turn_in_m"] = None if tb_ is None or tb_ > c["apex"] else (c["apex"] - tb_) * 5.0   # on A's road, m before its apex
            brakes.append(None if ob is None else (c["apex"] - ob) * 5.0)
            mins.append(None if sb is None else (sb - c["apex"]) * 5.0)
            froms.append(j)
            if mb["envelope_use"] <= PACE_CEILING and mb["time_s"] < best["time_s"]:
                best, best_from = mb, j
        gain = ma["time_s"] - best["time_s"]
        tip = _tip(ma, best if best_from >= 0 and gain >= TIP_GAIN_S else None)
        out.append({"apex": c["apex"], "m": ma, "best": None if best_from < 0 else best, "best_from": best_from,
                    "gain_s": gain, "tip": tip, "passes": passes, "spread": _spread(brakes, mins, passes, froms)})
    clean = [x for x in out if x["gain_s"] is not None]
    this_s = float(sum(x["m"]["time_s"] for x in clean))
    gain_s = float(sum(x["gain_s"] for x in clean if x["gain_s"] >= TIP_GAIN_S))     # below that is GPS alignment noise
    order = sorted((k for k, x in enumerate(out) if x["gain_s"] is not None and x["gain_s"] >= TIP_GAIN_S),
                   key=lambda k: (-out[k]["gain_s"], k))
    return {"corners": out, "clean": len(clean), "this_s": this_s, "ideal_s": this_s - gain_s, "gain_s": gain_s,
            "top": order[:TOP_OPPORTUNITIES]}



TREND_MIN_PASSES = 5         # marks a corner needs inside one period: with 3, two passes in the same 5 m bin read as 0 m


def spread_by(co: dict, keys: list) -> dict:
    """How repeatably you braked within each period (IDEAS D-07 trend), from coach(a, others). keys[0] is the period of a
    (e.g. the month it was driven) and keys[j + 1] that of others[j], None when unknown. For every corner, the braking marks
    are grouped by period and each group of TREND_MIN_PASSES or more gives a robust SD (`_sd`). Spread inside a period,
    not distance from an all-time median, so braking deliberately earlier from one month on does not read as unsteady.
    Returns {key: [[apex, sd_m] per corner]}, apex being the corner's index in a."""
    out: dict = {}
    for c in co["corners"]:
        sp = c.get("spread")
        if not sp:
            continue
        groups: dict = {}
        for f, b, _ in sp["marks"]:
            k = keys[f + 1] if 0 <= f + 1 < len(keys) else None
            if b is None or k is None:
                continue
            groups.setdefault(k, []).append(b)
        for k in sorted(groups):
            sd = _sd(groups[k]) if len(groups[k]) >= TREND_MIN_PASSES else None
            if sd is not None:
                out.setdefault(k, []).append([c["apex"], sd])
    return out

# ---------------------------------------------------------------------------
# Friction circle (g-g): the person's own grip envelope, and how much of it each corner used.
# ---------------------------------------------------------------------------

GG_SECTORS = 16              # 22.5 degree slices centred on 0 = +lon (throttle), 90 deg = +lat (left), 180 = braking
GG_PCTL = 0.95               # envelope radius in a slice: the 95th percentile, so one pothole spike does not set it
GG_MIN_POINTS = 8            # a slice with fewer measured points has no envelope (unknown, not zero)
GG_MIN_G = 0.05              # below this the car is cruising; the angle means nothing
GG_USE_MIN_G = 0.15          # grip use counts only real load, so a long straight's sway does not dilute a corner


def _pctl(values: list, q: float) -> float:
    """Nearest-rank percentile (the JS port does the same; no interpolation)."""
    s = sorted(values)
    return float(s[min(len(s) - 1, max(0, int(math.ceil(q * len(s))) - 1))])


def _sector(lat: float, lon: float) -> int:
    """Slice k is centred on k x 22.5 deg, so the axes (straight braking, steady cornering) sit in the middle of a slice."""
    w = 2.0 * math.pi / GG_SECTORS
    a = (math.atan2(lat, lon) + 0.5 * w) % (2.0 * math.pi)
    return int(a / w) % GG_SECTORS


def _num(x) -> bool:
    return x is not None and math.isfinite(x)


def gg_envelope(lat_g, lon_g, g_known=None) -> dict:
    """The driver's g-g envelope from one drive: per slice the 95th-percentile combined g (None when too few points).

    Units are g (a / 9.80665) in the ISO 8855 frame: +lon throttle, -lon braking, +lat left.
    """
    buckets = [[] for _ in range(GG_SECTORS)]
    total = []
    for i, (la, lo) in enumerate(zip(lat_g, lon_g)):
        if (g_known is not None and not g_known[i]) or not (_num(la) and _num(lo)):
            continue
        r = math.hypot(la, lo)
        if r < GG_MIN_G:
            continue
        buckets[_sector(la, lo)].append(r)
        total.append(r)
    radius = [_pctl(b, GG_PCTL) if len(b) >= GG_MIN_POINTS else None for b in buckets]
    q = GG_SECTORS // 4
    return {"radius_g": radius, "points": len(total),
            "peak_g": _pctl(total, GG_PCTL) if len(total) >= GG_MIN_POINTS else None,
            "brake_g": radius[2 * q], "throttle_g": radius[0], "left_g": radius[q], "right_g": radius[3 * q]}


def grip_use(lat_g, lon_g, lo: int, hi: int, env: dict, g_known=None):
    """Mean share of the envelope used over bins [lo, hi] where the car was really loaded (>= GG_USE_MIN_G); None if unknown."""
    use = []
    for i in range(lo, hi + 1):
        if g_known is not None and not g_known[i]:
            return None
        la, lo_ = lat_g[i], lon_g[i]
        if not (_num(la) and _num(lo_)):
            return None
        r = math.hypot(la, lo_)
        cap = env["radius_g"][_sector(la, lo_)] if r >= GG_USE_MIN_G else None
        if cap:
            use.append(min(r / cap, 1.5))
    return float(sum(use) / len(use)) if use else None


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


# ---------------------------------------------------------------------------
# Smoothness map: how abruptly the load on the car changed (IDEAS D-06)
# ---------------------------------------------------------------------------
JERK_MIN_MPS = 5.0           # below walking-jog pace the phone is handled more than the car is driven
JERK_FLOOR_GPS = 0.3         # g per second: under this a moment is not abrupt enough to name
JERK_SEPARATION = 40         # samples (200 m) between named moments
JERK_TOP = 3


def abrupt_moments(lat_g, lon_g, speed_mps, g_known=None) -> dict:
    """Rate of change of the combined g vector, g/s, per 5 m sample (None where either sample is unmeasured or the
    car is under JERK_MIN_MPS at either), and the JERK_TOP most abrupt moments at least JERK_SEPARATION apart and over JERK_FLOOR_GPS.
    Sample i is the change from i-1 to i, over the 5 m covered at its speed."""
    n = len(lat_g)
    ok = [(g_known is None or bool(g_known[i])) and _num(lat_g[i]) and _num(lon_g[i]) for i in range(n)]
    jerk: list = [None] * n
    for i in range(1, n):
        v, v0 = speed_mps[i], speed_mps[i - 1]
        if not (ok[i] and ok[i - 1] and _num(v) and _num(v0) and min(v, v0) >= JERK_MIN_MPS):
            continue
        jerk[i] = math.hypot(lat_g[i] - lat_g[i - 1], lon_g[i] - lon_g[i - 1]) * v / 5.0
    order = sorted((i for i in range(n) if jerk[i] is not None and jerk[i] >= JERK_FLOOR_GPS), key=lambda i: (-jerk[i], i))
    picks: list[int] = []
    for i in order:
        if len(picks) == JERK_TOP:
            break
        if all(abs(i - p) >= JERK_SEPARATION for p in picks):
            picks.append(i)
    return {"jerk": jerk, "moments": [{"index": i, "jerk_gps": jerk[i]} for i in picks]}


# ---------------------------------------------------------------------------
# Fatigue cues (IDEAS D-16): on a long drive, did technique fade late on? The corners of the first and last thirds of the
# moving time are compared as two groups. Different roads late in a drive can do the same, so this is a cue, never a verdict.
# ---------------------------------------------------------------------------
FATIGUE_MIN_S = 3600.0       # an hour of moving time before a drive is long enough to ask
FATIGUE_MIN_CORNERS = 8      # clean corners needed in each third
CORRECTION_STEP_G = 0.03     # a change of lateral g between 5 m bins this large counts as a steering movement
FATIGUE_MIN_CORRECTIONS = 0.3  # extra steering corrections per corner the last third must add...
FATIGUE_MIN_DROP = 0.05      # ...or braking credit (0..1) it must lose...
FATIGUE_SE = 2.0             # ...and by this many standard errors of the difference


def steering_corrections(lat_g, start: int, end: int) -> int:
    """Mid-corner steering corrections: reversals of the lateral-g trend beyond the one every corner has (load builds,
    then eases). Counted only on steps of CORRECTION_STEP_G or more, so the road's own tightness barely matters."""
    signs = [1 if d > 0 else -1 for d in (lat_g[q + 1] - lat_g[q] for q in range(start, end)) if abs(d) >= CORRECTION_STEP_G]
    return max(0, sum(1 for a, b in zip(signs, signs[1:]) if a != b) - 1)


def _mean_se(xs: list) -> tuple:
    m = 0.0
    for x in xs:                 # plain left-to-right sums, as the JS port does (Python 3.12's sum() is compensated)
        m += x
    m /= len(xs)
    q = 0.0
    for x in xs:
        q += (x - m) ** 2
    var = q / (len(xs) - 1) if len(xs) > 1 else 0.0
    return m, math.sqrt(var / len(xs))


def _r(x: float, k: int) -> float:
    return math.floor(x * 10 ** k + 0.5) / 10 ** k       # JS Math.round, so both ports print the same digits


def fatigue(speed_mps, lon_g, lat_g, corners, g_known=None) -> dict | None:
    """None when the drive is under FATIGUE_MIN_S of moving time or either third has too few clean, measured corners.
    Otherwise the moving minutes, the first and last thirds' mean extra steering corrections per corner and braking credit,
    and `cues`: "steering" when corrections rose by FATIGUE_MIN_CORRECTIONS, "braking" when the credit fell by
    FATIGUE_MIN_DROP, each also by FATIGUE_SE standard errors. Moving time counts only bins with a known speed of
    STOPPED_MPS or more (a 5 m recording holds no time while parked, so a rest stop is invisible). Corners where g was not
    measured (g_known false) are left out: zero-filled g would read as perfect driving."""
    v = np.asarray(speed_mps, dtype=float)
    n = len(v)
    t = np.zeros(n)
    for i in range(1, n):
        ok = math.isfinite(v[i - 1]) and v[i - 1] >= STOPPED_MPS
        t[i] = t[i - 1] + (5.0 / v[i - 1] if ok else 0.0)
    total = float(t[-1]) if n else 0.0
    if total < FATIGUE_MIN_S:
        return None
    early, late = [], []
    for c in corners:
        if c["start"] < 0 or c["end"] >= n or not (c["start"] <= c["apex"] <= c["end"]):
            continue
        if g_known is not None and not all(g_known[q] for q in range(c["start"], c["end"] + 1)):
            continue
        tc = corner_technique(v, lon_g, lat_g, c)
        if tc is None:
            continue
        x = {"corrections": steering_corrections(lat_g, c["start"], c["end"]), "braking": tc["brake"]}
        at = t[c["apex"]]
        if at <= total / 3.0:
            early.append(x)
        elif at >= 2.0 * total / 3.0:
            late.append(x)
    if len(early) < FATIGUE_MIN_CORNERS or len(late) < FATIGUE_MIN_CORNERS:
        return None
    out = {"minutes": _r(total / 60.0, 1), "early": {"corners": len(early)}, "late": {"corners": len(late)}, "cues": []}
    for k, cue, worse, floor in (("corrections", "steering", 1.0, FATIGUE_MIN_CORRECTIONS), ("braking", "braking", -1.0, FATIGUE_MIN_DROP)):
        (me, se), (ml, sl) = _mean_se([x[k] for x in early]), _mean_se([x[k] for x in late])
        out["early"][k], out["late"][k] = _r(me, 4), _r(ml, 4)
        change = worse * (ml - me)
        if change >= floor and change >= FATIGUE_SE * math.sqrt(se ** 2 + sl ** 2):
            out["cues"].append(cue)
    return out
