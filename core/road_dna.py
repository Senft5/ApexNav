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
MIN_RADIUS_M = 8.0           # tighter than any car can turn: GPS jitter, not road
LONG_TURN_RAD = math.radians(100.0)

# Rally severity by minimum radius: 1 = tightest, 6 = barely a bend. Above the last
# bound the bend is not called at all.
SEVERITY_RADIUS_M = (25.0, 40.0, 65.0, 100.0, 160.0, 260.0)

MU_EFF_DEFAULT = 0.60        # sane spirited street lateral grip, not a track limit
BRAKE_DECEL_MPS2 = 0.5 * G_STD
REACTION_S = 1.5             # alert driver; AASHTO design uses 2.5 s for the general public
EYE_HEIGHT_M = 1.08          # AASHTO stopping-sight geometry
OBJECT_HEIGHT_M = 0.60
SIGHT_OFFSET_M = 4.0         # lateral clearance to obstructions (wooded verge, conservative)
SIGHT_MAX_M = 400.0          # beyond this, sight no longer constrains a car
CAMBER_CLIP_RAD = 0.15

SECTOR_LENGTH_M = 500.0

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
    phi = np.clip(camber_rad, -CAMBER_CLIP_RAD, CAMBER_CLIP_RAD)
    return np.sqrt(np.maximum(0.0, np.asarray(radius_m, dtype=float) * G_STD * (mu_eff + np.tan(phi))))


def effective_mu(roughness_rms_g=None, mu_eff: float = MU_EFF_DEFAULT):
    """Derate grip on broken pavement: up to -30 % as 5 m RMS goes 0.08 g -> 0.38 g."""
    if roughness_rms_g is None:
        return mu_eff
    r = np.asarray(roughness_rms_g, dtype=float)
    return mu_eff * (1.0 - np.clip((r - 0.08) / 0.30, 0.0, 0.30))


def sight_distance_m(lat_deg, lon_deg, elevation_m=None, offset_m: float = SIGHT_OFFSET_M) -> np.ndarray:
    """Geometric sight distance ahead of each sample (m), capped at SIGHT_MAX_M.

    Target j is visible from i when the straight sightline between them
      * horizontally stays within offset_m of every path point in between (anything
        further off the road -- trees, banks, buildings -- is assumed to block), and
      * vertically clears the road surface from eye height to object height (crests).
    Sight ends at the first target that fails either test.
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
        off = np.abs(cx[:, None] * py[None, :] - cy[:, None] * px[None, :]) / chord[:, None]
        blocked = between & (off > offset_m)
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

    corners = []
    for start, end, sgn in runs:
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
        hairpin = abs(turn) >= HAIRPIN_TURN_RAD and radius < HAIRPIN_MAX_RADIUS_M
        sev = "HP" if hairpin else severity_for_radius(radius)
        if sev is None:
            continue

        mods = []
        mid = (start + end) // 2
        if end - start >= 4:
            r1 = 1.0 / max(float(np.max(np.abs(k[start:mid + 1]))), 1e-6)
            r2 = 1.0 / max(float(np.max(np.abs(k[mid:end + 1]))), 1e-6)
            if r2 < 0.7 * r1:
                mods.append("tightens")
            elif r1 < 0.7 * r2:
                mods.append("opens")
        if not hairpin and abs(turn) >= LONG_TURN_RAD:
            mods.append("long")

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
            "turn_rad": turn,
            "radius_m": radius,
            "apex_mps": float(apex_speed_mps(radius, phi, mu)),
            "mods": mods,
        })
    return corners


def pace_note_text(corner: dict) -> tuple[str, str]:
    """(short code, spoken call) e.g. ('L4', 'Left 4 tightens, over crest')."""
    word = "Left" if corner["dir"] == "L" else "Right"
    sev = corner["severity"]
    code = f"{corner['dir']}{sev}"
    call = f"{word} hairpin" if sev == "HP" else f"{word} {sev}"
    if corner["mods"]:
        call += " " + ", ".join(corner["mods"])
    return code, call


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


def _saturate(x: float, scale: float) -> float:
    """0 -> 0, scale -> 63, 3*scale -> 95 (smooth, bounded 0-100)."""
    return 100.0 * (1.0 - math.exp(-max(0.0, x) / scale))


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


def score_sectors(dist_m, kappa, corners, grade_pct, camber_rad, speed_mps,
                  roughness_rms_g, hazards, alpr_counts=None) -> list[dict]:
    """Aggregate 5 m bins into SECTOR_LENGTH_M sectors scored 0-100 on TECH/FLOW/SURF/CLEAR.

    CLEAR is None unless ALPR data was supplied -- unknown is never shown as safe.
    """
    dist_m = np.asarray(dist_m, dtype=float)
    k = np.abs(np.asarray(kappa, dtype=float))
    sector_ids = (dist_m // SECTOR_LENGTH_M).astype(int)
    by_apex = {}
    for c in corners:
        by_apex.setdefault(int(sector_ids[c["apex"]]), []).append(c)
    haz_by_sector = {}
    for h in hazards:
        haz_by_sector.setdefault(int(sector_ids[h["index"]]), []).append(h)

    sectors = []
    for sid in np.unique(sector_ids):
        m = sector_ids == sid
        length_km = max(0.05, (dist_m[m][-1] - dist_m[m][0] + 5.0) / 1000.0)
        cs = by_apex.get(int(sid), [])
        hairpins = sum(1 for c in cs if c["severity"] == "HP")
        tight = sum(1 for c in cs if c["severity"] == "HP" or c["severity"] <= 3)
        sweepers = sum(1 for c in cs if c["severity"] != "HP" and c["severity"] >= 4)

        tech = (_saturate(len(cs) / length_km, 6.0) * 0.45
                + _saturate(float(np.std(k)) * 1000.0, 6.0) * 0.25
                + _saturate(tight + 2 * hairpins, 3.0) * 0.20
                + _saturate(float(np.std(grade_pct[m])), 3.0) * 0.10)

        sp = speed_mps[m]
        moving = sp[sp > 2.0]
        continuity = 1.0 - min(1.0, float(np.std(moving) / np.mean(moving))) if len(moving) > 3 else 0.0
        bank_frac = float(np.mean(camber_rad[m] > math.radians(2.0)))
        sweep_frac = sweepers / len(cs) if cs else 0.0
        flow = 100.0 * (0.45 * continuity + 0.35 * sweep_frac + 0.20 * min(1.0, bank_frac * 4.0))

        rough = roughness_rms_g[m]
        haz = haz_by_sector.get(int(sid), [])
        surf = 100.0 - 300.0 * max(0.0, float(np.mean(rough)) - 0.03) - 12.0 * len(haz)

        clear = None
        if alpr_counts is not None:
            clear = 100.0 - 45.0 * alpr_counts.get(int(sid), 0)

        idx = np.flatnonzero(m)
        sectors.append({
            "id": int(sid),
            "start_index": int(idx[0]),
            "end_index": int(idx[-1]),
            "start_m": float(dist_m[idx[0]]),
            "end_m": float(dist_m[idx[-1]]),
            "corners": len(cs),
            "tech": int(round(np.clip(tech, 0, 100))),
            "flow": int(round(np.clip(flow, 0, 100))),
            "surf": int(round(np.clip(surf, 0, 100))),
            "clear": None if clear is None else int(round(np.clip(clear, 0, 100))),
        })
    return sectors
