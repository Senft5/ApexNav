"""Flow: the longest run of corners in a row driven smooth and settled on one drive. Pure; web/flow.js is the port
(tests/test_flow.py holds the two to one sequence).

A corner is in flow when the Driver Score's own judgement of it (drive_analysis.corner_technique) says it was smooth
(smooth >= SMOOTH_MIN, about the better half of real corners), settled (no braking past the apex to speak of: brake >=
BRAKE_MIN) and inside the corner's sane limit (use <= 1.0: overdriving never counts). A run is corners in road order, each
in flow; a corner that is not (or is not scored: a gap, a stop) ends it, and so does more than GAP_M of road between two
apexes (a run is a stretch of road, not two hills joined by a town). Only runs of MIN_RUN or more are worth saying.

It is about how the corners felt, never speed or time: a slow, smooth run counts the same as a quick one.
"""
import math

from core import drive_analysis as da

SMOOTH_MIN = 0.60
BRAKE_MIN = 0.90
USE_MAX = 1.0
GAP_M = 2000.0
MIN_RUN = 5
SEG_M = 5.0


def in_flow(t) -> bool:
    """Is this corner_technique result smooth, settled and inside the limit?"""
    return t is not None and t["smooth"] >= SMOOTH_MIN and t["brake"] >= BRAKE_MIN and t["use"] <= USE_MAX


def longest_flow(speed_mps, lon_g, lat_g, corners, dist_m=None):
    """The longest run: {corners, start_m, end_m} (start of its first corner to end of its last), or None when no run
    reaches MIN_RUN. corners: [{start, end, apex, apex_mps}] in any order. dist_m: metres per row (default 5 m bins)."""
    n = len(speed_mps)
    at = (lambda i: float(dist_m[i])) if dist_m is not None else (lambda i: i * SEG_M)
    order = sorted((c for c in corners if 0 <= c["start"] <= c["apex"] <= c["end"] < n), key=lambda c: c["apex"])
    best, run, last = None, [], None
    for c in order:
        t = da.corner_technique(speed_mps, lon_g, lat_g, c)
        if not in_flow(t) or (last is not None and at(c["apex"]) - at(last["apex"]) > GAP_M):
            run = []
        if in_flow(t):
            run.append(c)
            if len(run) >= MIN_RUN and (best is None or len(run) > best["corners"]):
                best = {"corners": len(run), "start_m": at(run[0]["start"]), "end_m": at(run[-1]["end"])}
        last = c
    if best is not None and not (math.isfinite(best["start_m"]) and math.isfinite(best["end_m"])):
        return None
    return best
