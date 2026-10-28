"""Road geometry, rally pace notes, braking envelope, hazards and 4-axis Stage DNA.

Headless and platform-agnostic. `web/apex_core.js` is a line-for-line port of the
geometry / pace-note / envelope half of this module and is held to parity by
`tests/test_web_core_parity.py` -- change both or neither.

Conventions (CLAUDE.md section 3):
  * SI units and radians internally; mph / degrees only at serialization.
  * Curvature kappa is signed per ISO 8855 yaw: + = LEFT turn, - = RIGHT turn.
  * Input sample spacing is ~5.0 m arc length (recorded bins or a resampled polyline).
"""
from __future__ import annotations

import math

import numpy as np

G_STD = 9.80665
MPS_TO_MPH = 2.2369362921

SMOOTH_WINDOW = 5            # samples (~25 m) for position and curvature smoothing
EDGE_TRIM = 2 * (SMOOTH_WINDOW // 2)
CORNER_KAPPA_MIN = 1.0 / 300.0
CORNER_MIN_TURN_RAD = math.radians(20.0)
CORNER_MERGE_GAP = 3         # samples; same-direction runs closer than this merge
HAIRPIN_TURN_RAD = math.radians(135.0)
HAIRPIN_MAX_RADIUS_M = 30.0
HAIRPIN_COMPACT = 1.8        # a hairpin is one arc: length <= 1.8 x turn x radius
SPLIT_RATIO = 0.5            # a curvature valley this far below both peaks splits a run in two
SPLIT_MIN_TURN_RAD = math.radians(45.0)   # ...when both halves are real turns, not GPS wobble
SPLIT_CORE_EDGE = 0.7        # cut the tight core where curvature falls to 70 % of its peak
HAIRPIN_CORE_SHARE = 0.64    # a hairpin does >= 64 % of its turning in its tight core; a junction
                             # square that runs on into the next road's bend does far less
MIN_RADIUS_M = 8.0           # tighter than any car can turn: GPS jitter, not road
LONG_TURN_RAD = math.radians(100.0)
LONG_ARC_M = 90.0            # a corner this long is called "long" whatever its turn
SHORT_ARC_M = 20.0           # ...and this brief is "short"
ACUTE_TURN_RAD = math.radians(105.0)
ACUTE_MAX_RADIUS_M = 25.0
SQUARE_TURN_RAD = math.radians(75.0)
SQUARE_MAX_RADIUS_M = 25.0      # "equal to 1 or worse" (the 1 band)
GRADE_EDGE = 0.25            # outer quarter of a severity band earns "-" (tighter) or "+" (opener)
CAUTION_WORDS = ("", "care", "caution", "double caution", "triple caution")
APPROACH_CAP_MPS = 27.0      # approach speed for caution scoring is the sim cruise, not the envelope
LINK_INTO_M = 25.0           # gap to the next note below which the call chains with "into"
LINK_AND_M = 60.0            # ...or "and"
LINK_MAX_M = 500.0           # beyond this no distance is called
RALLY_DISTANCES = (30, 40, 50, 60, 70, 80, 100, 120, 150, 200, 250, 300, 350, 400, 450, 500)

# Rally severity by minimum radius: 1 = tightest, 6 = barely a bend. Above the last
# bound the bend is not called at all.
SEVERITY_RADIUS_M = (25.0, 40.0, 65.0, 100.0, 160.0, 260.0)

MU_EFF_DEFAULT = 0.60        # sane spirited street lateral grip, not a track limit
BRAKE_DECEL_MPS2 = 0.5 * G_STD
REACTION_S = 1.5             # alert driver; AASHTO design uses 2.5 s for the general public
EYE_HEIGHT_M = 1.08          # AASHTO stopping-sight geometry
OBJECT_HEIGHT_M = 0.60
SIGHT_OFFSET_M = 4.0         # lateral clearance to obstructions (wooded verge, conservative)
# On a bend toward your own side you sit nearer its inside edge (half a lane is 1.8 m), but SIGHT_OFFSET_M is already a
# cautious figure: the full 1.8 m on top doubled the right-hander cautions on the bundled Dry Ridge drive (6 to 13 of 17),
# 0.8 m adds one. A first estimate, to calibrate against crowd data (IDEAS Q-19).
NEAR_SIDE_M = 0.8
NEAR_SIDE_FLOOR_M = 1.0      # never less clearance than this
SIGHT_MAX_M = 400.0          # beyond this, sight no longer constrains a car
CAMBER_CLIP_RAD = 0.15

SECTOR_LENGTH_M = 500.0
SECTOR_CONTEXT_S = 30.0      # sector features read over +-30 s of reference-lap time
TOWN_LIMIT_MPS = 15.7        # posted limit <= 35 mph -> town transit

# IMU hazard thresholds (manifesto section 4 for the spike value)
SPIKE_PEAK_G = 0.35
SPIKE_CONTRAST = 6.0         # impact must exceed 6x the surrounding road's roughness
SPIKE_BACKGROUND_BINS = 41   # ~200 m rolling median of 5 m roughness RMS
ROUGH_RMS_FALLBACK_G = 0.25  # 5 m RMS proxy when per-bin peak is unavailable
CREST_UNWEIGHT_G = -0.08
DIP_COMPRESS_G = 0.10
HAZARD_MIN_SEPARATION_M = 150.0

ALPR_RADIUS_M = 60.0


# ---------------------------------------------------------------------------
# Small numeric helpers (kept trivially portable to JS)
# ---------------------------------------------------------------------------

def moving_average(values: np.ndarray, window: int) -> np.ndarray:
    """Centered moving average; edges average over the samples that exist."""
    v = np.asarray(values, dtype=float)
    n = len(v)
    half = window // 2
    csum = np.concatenate([[0.0], np.cumsum(v)])
    lo = np.clip(np.arange(n) - half, 0, n)
    hi = np.clip(np.arange(n) + half + 1, 0, n)
    return (csum[hi] - csum[lo]) / (hi - lo)


def local_xy_m(lat_deg: np.ndarray, lon_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Equirectangular projection to metres around the first point (x = East, y = North)."""
    lat = np.asarray(lat_deg, dtype=float)
    lon = np.asarray(lon_deg, dtype=float)
    lat0 = math.radians(float(np.mean(lat)))
    x = (lon - lon[0]) * 111320.0 * math.cos(lat0)
    y = (lat - lat[0]) * 110540.0
    return x, y


def resample_polyline(lat_deg, lon_deg, step_m: float = 5.0) -> tuple[np.ndarray, np.ndarray]:
    """Resample a lat/lon polyline to uniform arc-length spacing."""
    lat = np.asarray(lat_deg, dtype=float)
    lon = np.asarray(lon_deg, dtype=float)
    x, y = local_xy_m(lat, lon)
    s = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(x), np.diff(y)))])
    if s[-1] < step_m:
        return lat.copy(), lon.copy()
    s_new = np.arange(0.0, s[-1] + 1e-9, step_m)
    return np.interp(s_new, s, lat), np.interp(s_new, s, lon)


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def smooth_elevation_and_grade(dist_m, elevation_m, window_m: float = 50.0):
    """Barometric elevation smoothed over window_m, and its grade in percent (clipped +-35)."""
    dist = np.asarray(dist_m, dtype=float)
    win = max(3, int(round(window_m / 5.0)) | 1)
    elev = moving_average(np.asarray(elevation_m, dtype=float), win)
    if len(dist) < 3:
        return elev, np.zeros(len(dist))
    grade = np.clip(np.gradient(elev, dist) * 100.0, -35.0, 35.0)
    return elev, moving_average(grade, win)

def compute_curvature(lat_deg, lon_deg) -> tuple[np.ndarray, np.ndarray]:
    """Return (kappa [1/m, + = left], ds [m per sample]) for a ~5 m spaced path."""
    x, y = local_xy_m(lat_deg, lon_deg)
    if len(x) < 3:
        return np.zeros(len(x)), np.full(len(x), 5.0)
    xs = moving_average(x, SMOOTH_WINDOW)
    ys = moving_average(y, SMOOTH_WINDOW)
    dx = np.gradient(xs)
    dy = np.gradient(ys)
    ds = np.maximum(np.hypot(dx, dy), 0.5)
    psi = np.unwrap(np.arctan2(dy, dx))
    kappa = moving_average(np.gradient(psi) / ds, SMOOTH_WINDOW)
    # One-sided differences at the path ends amplify GPS noise into phantom corners.
    edge = min(EDGE_TRIM, len(kappa) // 2)
    kappa[:edge] = 0.0
    kappa[len(kappa) - edge:] = 0.0
    return kappa, ds


def apex_speed_mps(radius_m, camber_rad=0.0, mu_eff: float = MU_EFF_DEFAULT):
    """Manifesto corner speed v = sqrt(R g (mu_eff + tan(phi))).

    Small-angle form of the banked-curve limit; it omits the 1/(1 - mu tan phi) term,
    which makes it slightly conservative on positive banking.
    """
    # Unknown camber (NaN, e.g. a blank CSV cell) is flat, as when the whole column is missing.
    phi = np.clip(np.nan_to_num(np.asarray(camber_rad, dtype=float), nan=0.0), -CAMBER_CLIP_RAD, CAMBER_CLIP_RAD)
    return np.sqrt(np.maximum(0.0, np.asarray(radius_m, dtype=float) * G_STD * (mu_eff + np.tan(phi))))


def effective_mu(roughness_rms_g=None, mu_eff: float = MU_EFF_DEFAULT):
    """Derate grip on broken pavement: up to -30 % as 5 m RMS goes 0.08 g -> 0.38 g. Unknown (NaN) keeps full grip."""
    if roughness_rms_g is None:
        return mu_eff
    r = np.asarray(roughness_rms_g, dtype=float)
    mu = np.where(np.isfinite(r), mu_eff * (1.0 - np.clip((r - 0.08) / 0.30, 0.0, 0.30)), mu_eff)
    return float(mu) if mu.ndim == 0 else mu


def sight_distance_m(lat_deg, lon_deg, elevation_m=None, offset_m=SIGHT_OFFSET_M, keep_side=None) -> np.ndarray:
    """Geometric sight distance ahead of each sample (m), capped at SIGHT_MAX_M.

    Target j is visible from i when the straight sightline between them
      * horizontally stays within offset_m of every path point in between (anything
        further off the road -- trees, banks, buildings -- is assumed to block), and
      * vertically clears the road surface from eye height to object height (crests).
    Sight ends at the first target that fails either test.
    offset_m is one clearance for the whole road, or one per sample (IDEAS Q-09: wider beside open fields than
    beside woods), read at the point the sightline passes.
    keep_side ('right' in the US, 'left' in the UK; IDEAS U-22): on bends toward that side the driver sits nearer the
    inside edge, so those sightlines get NEAR_SIDE_M less clearance. Bends the other way keep offset_m: the
    clearance across the oncoming lane is never counted on. None: the same clearance both ways.
    """
    x, y = local_xy_m(lat_deg, lon_deg)
    n = len(x)
    out = np.full(n, SIGHT_MAX_M)
    if n < 3:
        return out
    xs = moving_average(x, SMOOTH_WINDOW)
    ys = moving_average(y, SMOOTH_WINDOW)
    s = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(xs), np.diff(ys)))])
    z = None if elevation_m is None else np.asarray(elevation_m, dtype=float)
    offs = np.broadcast_to(np.asarray(offset_m, dtype=float), (n,))
    offs = np.where(np.isfinite(offs), offs, SIGHT_OFFSET_M)           # unknown land beside the road: the cautious default
    for i in range(n - 2):
        end = int(np.searchsorted(s, s[i] + SIGHT_MAX_M, side="right"))
        js = np.arange(i + 2, end)
        if len(js) == 0:
            continue
        ks = np.arange(i + 1, end - 1)
        # blocked[j, k]: k strictly between i and j obstructs the sightline i -> j
        cx, cy = xs[js] - xs[i], ys[js] - ys[i]
        chord = np.maximum(np.hypot(cx, cy), 1e-6)
        px, py = xs[ks] - xs[i], ys[ks] - ys[i]
        between = ks[None, :] < js[:, None]
        cross = cx[:, None] * py[None, :] - cy[:, None] * px[None, :]
        off = np.abs(cross) / chord[:, None]
        allow = np.broadcast_to(offs[ks][None, :], off.shape)
        if keep_side in ("right", "left"):
            # the road bending right leaves the points between left of the sightline (cross > 0)
            near = cross > 0 if keep_side == "right" else cross < 0
            allow = np.where(near, np.maximum(NEAR_SIDE_FLOOR_M, allow - NEAR_SIDE_M), allow)
        blocked = between & (off > allow)
        if z is not None:
            eye = z[i] + EYE_HEIGHT_M
            frac = (s[ks][None, :] - s[i]) / (s[js] - s[i])[:, None]
            line = eye + (z[js][:, None] + OBJECT_HEIGHT_M - eye) * frac
            blocked |= between & (z[ks][None, :] > line)
        hit = np.flatnonzero(blocked.any(axis=1))
        if len(hit):
            out[i] = min(SIGHT_MAX_M, s[js[hit[0]] - 1] - s[i])
    return out


def sight_speed_mps(sight_m, reaction_s: float = REACTION_S, decel_mps2: float = BRAKE_DECEL_MPS2):
    """Fastest speed that still stops within the visible road: v t_r + v^2 / (2 a) = S."""
    S = np.asarray(sight_m, dtype=float)
    return decel_mps2 * (-reaction_s + np.sqrt(reaction_s ** 2 + 2.0 * S / decel_mps2))


def braking_envelope_mps(kappa, ds, camber_rad=None, roughness_rms_g=None,
                         mu_eff: float = MU_EFF_DEFAULT, sight_m=None) -> np.ndarray:
    """Max speed at each sample so the driver can still slow for every corner ahead.

    Local limit = min(corner limit apex_speed_mps on |kappa|, stopping-sight limit),
    then a backward pass with constant deceleration BRAKE_DECEL_MPS2:
    v[i] <= sqrt(v[i+1]^2 + 2 a ds). No policy cap: without sight data the ceiling is
    the stopping-sight speed for SIGHT_MAX_M.
    """
    k = np.abs(np.asarray(kappa, dtype=float))
    n = len(k)
    phi = np.zeros(n) if camber_rad is None else np.asarray(camber_rad, dtype=float)
    mu = effective_mu(roughness_rms_g, mu_eff)
    radius = 1.0 / np.maximum(k, 1e-6)
    sight = np.full(n, SIGHT_MAX_M) if sight_m is None else np.asarray(sight_m, dtype=float)
    v = np.minimum(apex_speed_mps(radius, phi, mu), sight_speed_mps(sight))
    for i in range(n - 2, -1, -1):
        v[i] = min(v[i], math.sqrt(v[i + 1] ** 2 + 2.0 * BRAKE_DECEL_MPS2 * ds[i]))
    return v


def severity_for_radius(radius_m: float) -> int | None:
    for sev, bound in enumerate(SEVERITY_RADIUS_M, start=1):
        if radius_m < bound:
            return sev
    return None


CROWD_MIN_PASSES = 2          # a bin's crowd curvature counts once this many passes measured it
CROWD_MIN_RUN = 6             # ... and only in runs of this many known bins (30 m): a lone bin is noise, not a corner


def blend_curvature(kappa_map, kappa_crowd, passes):
    """Curvature from members' driven paths over the map's (IDEAS Q-04): the map simplifies corners (a hairpin drawn with
    three nodes), the crowd drove them. Where at least CROWD_MIN_PASSES passes measured a sample, in runs of at least
    CROWD_MIN_RUN such samples, the crowd's mean replaces the map's; everywhere else the map stays. Returns (kappa, replaced).
    """
    k = np.asarray(kappa_map, dtype=float).copy()
    n = len(k)
    ok = np.zeros(n, dtype=bool)
    for i in range(n):
        c = kappa_crowd[i] if i < len(kappa_crowd) else None
        p = passes[i] if i < len(passes) else None
        ok[i] = c is not None and p is not None and np.isfinite(c) and p >= CROWD_MIN_PASSES
    replaced = 0
    i = 0
    while i < n:
        if not ok[i]:
            i += 1
            continue
        j = i
        while j < n and ok[j]:
            j += 1
        if j - i >= CROWD_MIN_RUN:
            k[i:j] = [kappa_crowd[q] for q in range(i, j)]
            replaced += j - i
        i = j
    return k, replaced


def detect_corners(kappa, ds, camber_rad=None, crest_g=None, roughness_rms_g=None,
                   mu_eff: float = MU_EFF_DEFAULT) -> list[dict]:
    """Segment curvature into corners and grade them as rally pace notes.

    Each corner: start/apex/end sample index, direction, severity (1-6 or 'HP'),
    total turn (rad), min radius (m), apex speed (m/s) and modifier words.
    """
    k = np.asarray(kappa, dtype=float)
    n = len(k)
    sign = np.where(k > CORNER_KAPPA_MIN, 1, np.where(k < -CORNER_KAPPA_MIN, -1, 0))

    runs = []  # [start, end_inclusive, sign]
    i = 0
    while i < n:
        if sign[i] == 0:
            i += 1
            continue
        j = i
        while j + 1 < n and sign[j + 1] == sign[i]:
            j += 1
        if runs and runs[-1][2] == sign[i] and i - runs[-1][1] - 1 <= CORNER_MERGE_GAP:
            runs[-1][1] = j
        else:
            runs.append([i, j, int(sign[i])])
        i = j + 1

    # Two same-direction corners close together (a jog: left at one junction, left at the
    # next) merge into one run; split it wherever curvature dips into a valley between peaks.
    def split(a: int, b: int) -> list:
        if b - a < 6:
            return [(a, b)]
        m = min(range(a + 2, b - 1), key=lambda q: abs(k[q]))
        left, right = float(np.max(np.abs(k[a:m + 1]))), float(np.max(np.abs(k[m:b + 1])))
        if abs(k[m]) < SPLIT_RATIO * min(left, right):
            lt, rt = float(np.sum(k[a:m + 1] * ds[a:m + 1])), float(np.sum(k[m + 1:b + 1] * ds[m + 1:b + 1]))
            if abs(lt) >= SPLIT_MIN_TURN_RAD and abs(rt) >= SPLIT_MIN_TURN_RAD:
                return split(a, m) + split(m + 1, b)
        # Hairpin-sized turn that isn't one tight arc: split off the tight core
        # ("square left into left 2", not "left hairpin").
        turn_ab = float(np.sum(k[a:b + 1] * ds[a:b + 1]))
        if abs(turn_ab) >= HAIRPIN_TURN_RAD:
            ap = a + int(np.argmax(np.abs(k[a:b + 1])))
            peak = abs(float(k[ap]))
            core = np.abs(k[a:b + 1]) >= 0.5 * peak
            share = float(np.sum((k[a:b + 1] * ds[a:b + 1])[core])) / turn_ab
            if share < HAIRPIN_CORE_SHARE:
                lo, hi = ap, ap
                while lo > a and abs(k[lo - 1]) >= SPLIT_CORE_EDGE * peak:
                    lo -= 1
                while hi < b and abs(k[hi + 1]) >= SPLIT_CORE_EDGE * peak:
                    hi += 1
                before = float(np.sum(k[a:lo] * ds[a:lo]))
                after = float(np.sum(k[hi + 1:b + 1] * ds[hi + 1:b + 1]))
                if abs(after) >= abs(before) and abs(after) >= SPLIT_MIN_TURN_RAD:
                    return split(a, hi) + split(hi + 1, b)
                if abs(before) >= SPLIT_MIN_TURN_RAD:
                    return split(a, lo - 1) + split(lo, b)
        return [(a, b)]

    pieces = [(a2, b2, sgn) for a, b, sgn in runs for a2, b2 in split(a, b)]

    corners = []
    for start, end, sgn in pieces:
        seg = slice(start, end + 1)
        turn = float(np.sum(k[seg] * ds[seg]))
        if abs(turn) < CORNER_MIN_TURN_RAD:
            continue
        apex = start + int(np.argmax(np.abs(k[seg])))
        # Mean |kappa| over +-2 samples: accurate on clean paths and errs tight (slower,
        # safer) under GPS noise, unlike the raw peak or an arc/turn ratio.
        lo, hi = max(start, apex - 2), min(end, apex + 2)
        radius = 1.0 / max(float(np.mean(np.abs(k[lo:hi + 1]))), 1e-6)
        if radius < MIN_RADIUS_M:
            continue
        # Compactness on the arc's core (|kappa| >= half the apex), not the smoothed tails.
        core = np.abs(k[seg]) >= 0.5 * abs(float(k[apex]))
        core_arc = float(np.sum(ds[seg][core]))
        hairpin = (abs(turn) >= HAIRPIN_TURN_RAD and radius < HAIRPIN_MAX_RADIUS_M
                   and core_arc <= HAIRPIN_COMPACT * abs(turn) * radius)
        sev = "HP" if hairpin else severity_for_radius(radius)
        if sev is None:
            continue

        # McRae shapes beyond the 1-6 scale, then +/- within a band.
        arc = float(np.sum(ds[seg]))
        shape = None
        if hairpin:
            shape = "hairpin"
        elif radius < ACUTE_MAX_RADIUS_M and abs(turn) >= ACUTE_TURN_RAD:
            shape = "acute"
        elif radius < SQUARE_MAX_RADIUS_M and abs(turn) >= SQUARE_TURN_RAD:
            shape = "square"
        grade = ""
        if shape is None:
            lo_b = MIN_RADIUS_M if sev == 1 else SEVERITY_RADIUS_M[sev - 2]
            frac = (radius - lo_b) / (SEVERITY_RADIUS_M[sev - 1] - lo_b)
            grade = "-" if frac < GRADE_EDGE else ("+" if frac > 1.0 - GRADE_EDGE else "")

        mods = []
        if not hairpin and (abs(turn) >= LONG_TURN_RAD or arc >= LONG_ARC_M):
            mods.append("long")
        elif shape is None and arc < SHORT_ARC_M:
            mods.append("short")
        mid = (start + end) // 2
        if end - start >= 4:
            r1 = 1.0 / max(float(np.max(np.abs(k[start:mid + 1]))), 1e-6)
            r2 = 1.0 / max(float(np.max(np.abs(k[mid:end + 1]))), 1e-6)
            if r2 < 0.7 * r1:
                mods.append("tightens")
            elif r1 < 0.7 * r2:
                mods.append("opens")

        phi = 0.0
        if camber_rad is not None:
            phi = float(camber_rad[apex])
            if phi > math.radians(2.0):
                mods.append("banked")
            elif phi < math.radians(-2.0):
                mods.append("off-camber")
        if crest_g is not None and float(np.min(crest_g[seg])) < CREST_UNWEIGHT_G:
            mods.append("over crest")

        mu = effective_mu(None if roughness_rms_g is None else float(roughness_rms_g[apex]), mu_eff)
        corners.append({
            "start": int(start),
            "apex": int(apex),
            "end": int(end),
            "dir": "L" if sgn > 0 else "R",
            "severity": sev,
            "grade": grade,
            "shape": shape,
            "arc_m": arc,
            "turn_rad": turn,
            "radius_m": radius,
            "apex_mps": float(apex_speed_mps(radius, phi, mu)),
            "mods": mods,
        })
    return corners


def pace_note_text(corner: dict) -> tuple[str, str]:
    """(short code, spoken call) in McRae order, e.g. ('L4-', 'Left 4 minus long tightens, caution')."""
    word = "Left" if corner["dir"] == "L" else "Right"
    shape = corner.get("shape")
    if corner["severity"] == "HP" or shape == "hairpin":
        code, call = f"{corner['dir']}HP", f"{word} hairpin"
    elif shape == "square":
        code, call = f"{corner['dir']}SQ", f"Square {word.lower()}"
    elif shape == "acute":
        code, call = f"{corner['dir']}AC", f"Acute {word.lower()}"
    else:
        grade = corner.get("grade", "")
        code = f"{corner['dir']}{corner['severity']}{grade}"
        call = f"{word} {corner['severity']}" + {"-": " minus", "+": " plus"}.get(grade, "")
    if corner["mods"]:
        call += " " + " ".join(corner["mods"])
    level = corner.get("caution", 0)
    if level:
        call += ", " + CAUTION_WORDS[level]
    return code, call


def annotate_cautions(corners: list, envelope_mps, sight_m) -> list:
    """Caution ladder 0-4 (care, caution, double, triple) from what makes a corner bite:
    a fast approach for its speed, a blind entry, tightening, off-camber, a crest."""
    env = np.asarray(envelope_mps, dtype=float)
    sight = np.asarray(sight_m, dtype=float)
    for c in corners:
        lo = max(0, c["start"] - 30)                                   # 150 m approach
        v_app = min(float(np.max(env[lo:c["start"] + 1])), APPROACH_CAP_MPS)
        ratio = v_app / max(c["apex_mps"], 1.0)
        score = 2 if ratio >= 3.0 else (1 if ratio >= 2.0 else 0)
        vc = c["apex_mps"]
        if sight[c["start"]] < 0.5 * (vc * REACTION_S + vc * vc / (2.0 * BRAKE_DECEL_MPS2)):
            score += 1                                                 # can't see half of a stop
        score += sum(1 for m in ("tightens", "off-camber", "over crest") if m in c["mods"])
        c["caution"] = min(score, 4)
    return corners


def rally_distance(gap_m: float) -> int:
    """Nearest call distance from the rally ladder (30 ... 500)."""
    return min(RALLY_DISTANCES, key=lambda d: abs(d - gap_m))


def link_notes(notes: list) -> list:
    """Chain consecutive notes the way a co-driver reads them: "into" / "and" when the next
    note follows almost at once, otherwise the distance to it ("Left 4, 150").
    notes: sorted by start_m, each with start_m and end_m. Sets note["link"]."""
    for i, n in enumerate(notes):
        n["link"] = None
        if i + 1 == len(notes):
            continue
        gap = notes[i + 1]["start_m"] - n["end_m"]
        if gap < LINK_INTO_M:
            n["link"] = "into"
        elif gap < LINK_AND_M:
            n["link"] = "and"
        elif gap <= LINK_MAX_M:
            n["link"] = str(rally_distance(gap))
    return notes


# ---------------------------------------------------------------------------
# IMU hazards and 4-axis Stage DNA (recorded drives only)
# ---------------------------------------------------------------------------

def _peak_events(values: np.ndarray, mask: np.ndarray, dist_m: np.ndarray, pick_max: bool) -> list[int]:
    """Indices of the strongest sample in each cluster of `mask`, clusters >= separation apart."""
    idx = np.flatnonzero(mask)
    picks: list[int] = []
    for i in idx:
        if picks and dist_m[i] - dist_m[picks[-1]] < HAZARD_MIN_SEPARATION_M:
            better = values[i] > values[picks[-1]] if pick_max else values[i] < values[picks[-1]]
            if better:
                picks[-1] = int(i)
        else:
            picks.append(int(i))
    return picks


def _rolling_median(values: np.ndarray, window: int) -> np.ndarray:
    """Centered rolling median; edges use the samples that exist."""
    half = window // 2
    n = len(values)
    return np.array([np.median(values[max(0, i - half):min(n, i + half + 1)]) for i in range(n)])


def detect_hazards(dist_m, crest_g, roughness_rms_g, vert_peak_g=None) -> list[dict]:
    """Bumps (vertical spike), crests (unweighting) and dips (compression) from measured IMU."""
    dist_m = np.asarray(dist_m, dtype=float)
    crest = np.asarray(crest_g, dtype=float)
    hazards = []
    if vert_peak_g is not None:
        # A pothole is an event that stands out from the road around it; steadily
        # broken pavement is SURF's job, not a stream of bump calls.
        peak = np.asarray(vert_peak_g, dtype=float)
        rough = np.asarray(roughness_rms_g, dtype=float)
        background = _rolling_median(rough, SPIKE_BACKGROUND_BINS)
        is_spike = (peak > SPIKE_PEAK_G) & (peak > SPIKE_CONTRAST * background)
        for i in _peak_events(peak, is_spike, dist_m, True):
            hazards.append({"index": i, "type": "bump", "severity_g": float(peak[i])})
    else:
        rough = np.asarray(roughness_rms_g, dtype=float)
        for i in _peak_events(rough, rough > ROUGH_RMS_FALLBACK_G, dist_m, True):
            hazards.append({"index": i, "type": "bump", "severity_g": float(rough[i])})
    for i in _peak_events(crest, crest < CREST_UNWEIGHT_G, dist_m, False):
        hazards.append({"index": i, "type": "crest", "severity_g": float(crest[i])})
    for i in _peak_events(crest, crest > DIP_COMPRESS_G, dist_m, True):
        hazards.append({"index": i, "type": "dip", "severity_g": float(crest[i])})
    hazards.sort(key=lambda h: h["index"])
    return hazards


def alpr_counts_by_sector(lat, lon, sector_ids, alpr_nodes) -> dict[int, int]:
    """Number of ALPR cameras within ALPR_RADIUS_M of each sector's path."""
    counts: dict[int, int] = {int(s): 0 for s in np.unique(sector_ids)}
    if not alpr_nodes:
        return counts
    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float)
    cos0 = math.cos(math.radians(float(np.mean(lat))))
    for node in alpr_nodes:
        dx = (lon - node["lon"]) * 111320.0 * cos0
        dy = (lat - node["lat"]) * 110540.0
        d = np.hypot(dx, dy)
        i = int(np.argmin(d))
        if d[i] <= ALPR_RADIUS_M:
            counts[int(sector_ids[i])] += 1
    return counts


def score_sectors(dist_m, corners, camber_rad, roughness_rms_g, hazards, lap, sight_m,
                  limit_mps=None, alpr_counts=None, ramp=None) -> list[dict]:
    """Sectors of SECTOR_LENGTH_M scored 0-100 on TECH/FLOW/SURF/CLEAR plus an archetype.

    TECH and FLOW come from the reference lap (core/reference_lap.py), read over a
    +-SECTOR_CONTEXT_S window of simulated driving around each sector so per-minute
    rates are stable. CLEAR is None unless ALPR data was supplied -- unknown is never
    shown as safe.
    """
    from core import reference_lap as rl  # local: reference_lap builds on this module

    dist_m = np.asarray(dist_m, dtype=float)
    sector_ids = (dist_m // SECTOR_LENGTH_M).astype(int)
    t = lap["t"]
    haz_by_sector = {}
    for h in hazards:
        haz_by_sector.setdefault(int(sector_ids[h["index"]]), []).append(h)

    sectors = []
    for sid in np.unique(sector_ids):
        idx = np.flatnonzero(sector_ids == sid)
        lo, hi = int(idx[0]), int(idx[-1]) + 1
        tc = 0.5 * (t[lo] + t[hi - 1])
        wlo = min(lo, int(np.searchsorted(t, tc - SECTOR_CONTEXT_S)))
        whi = max(hi, int(np.searchsorted(t, tc + SECTOR_CONTEXT_S)))
        f = rl.window_features(lap, corners, sight_m, wlo, whi)
        axes = rl.axis_scores(f)

        bank_frac = float(np.mean(np.asarray(camber_rad)[lo:hi] > math.radians(2.0)))
        flow = 0.9 * axes["flow"] + 10.0 * min(1.0, bank_frac * 4.0)

        town = False
        if limit_mps is not None:
            lim = np.asarray(limit_mps, dtype=float)[lo:hi]
            known = lim[np.isfinite(lim)]
            town = len(known) > 0 and float(np.mean(known <= TOWN_LIMIT_MPS)) > 0.5

        # ramp: per sample, 1 on a motorway link / ramp (map matching's edge use), 0 off it, NaN unknown (IDEAS R-34)
        on_ramp = False
        if ramp is not None:
            r = np.asarray(ramp, dtype=float)[lo:hi]
            known = r[np.isfinite(r)]
            on_ramp = len(known) > 0 and float(np.mean(known > 0.5)) > 0.5

        rough = np.asarray(roughness_rms_g)[lo:hi]
        haz = haz_by_sector.get(int(sid), [])
        surf = 100.0 - 300.0 * max(0.0, float(np.mean(rough)) - 0.03) - 12.0 * len(haz)

        clear = None
        if alpr_counts is not None:
            clear = 100.0 - 45.0 * alpr_counts.get(int(sid), 0)

        sectors.append({
            "id": int(sid),
            "start_index": lo,
            "end_index": hi - 1,
            "start_m": float(dist_m[lo]),
            "end_m": float(dist_m[hi - 1]),
            "corners": sum(1 for c in corners if lo <= c["apex"] < hi),
            "archetype": rl.archetype(f, town, on_ramp),
            "tech": axes["tech"],
            "flow": int(round(np.clip(flow, 0, 100))),
            "surf": int(round(np.clip(surf, 0, 100))),
            "clear": None if clear is None else int(round(np.clip(clear, 0, 100))),
            "features": {k: round(float(v), 3) for k, v in f.items()},
        })
    return sectors
