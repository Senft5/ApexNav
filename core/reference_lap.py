"""Reference lap: simulate a sane, skilled driver in a given car, then read the drive.

docs/ROAD_INTELLIGENCE.md sections 2-5. Every scoring feature is computed from this
simulated drive -- what the road *feels like in time* -- never from raw geometry alone.

Units: SI and radians inside; scores 0-100 at the boundary.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from core import road_dna as rd

G = rd.G_STD


@dataclass(frozen=True)
class CarProfile:
    """Enough of a car to change how a road drives. Defaults: a 1.5 t, 150 kW sports sedan."""
    mass_kg: float = 1500.0
    power_kw: float = 150.0
    mu_lat: float = rd.MU_EFF_DEFAULT    # sane street lateral grip, not the tyre limit
    mu_lon: float = 0.45                 # usable longitudinal grip under power
    cda_m2: float = 0.65                 # drag area
    drivetrain_eff: float = 0.85


DEFAULT_CAR = CarProfile()
ENGAGED_G = 0.20             # lateral load that counts as "in a corner"
CRUISE_MPS = 27.0              # sim cruise where no posted limit is known (~60 mph)
CRUISE_OVER_LIMIT = 1.2        # sim cruise = 1.2 x posted limit where known
AIR_DENSITY = 1.2


def acceleration_mps2(v: float, grade: float, car: CarProfile) -> float:
    """Tractive acceleration available at speed v on a grade (rise/run)."""
    traction = car.mu_lon * G
    power = car.power_kw * 1000.0 * car.drivetrain_eff / (car.mass_kg * max(v, 1.0))
    drag = 0.5 * AIR_DENSITY * car.cda_m2 * v * v / car.mass_kg
    return min(traction, power) - drag - G * grade / math.sqrt(1.0 + grade * grade)


def simulate(kappa, ds, sight_m=None, camber_rad=None, roughness_rms_g=None,
             elevation_m=None, limit_mps=None, car: CarProfile = DEFAULT_CAR) -> dict:
    """Quasi-steady-state lap: min(braking envelope, cruise, acceleration forward pass).

    Returns per-sample v, dt, t, a_lat, a_lon, a_vert (m/s, s, m/s^2) plus grade.
    """
    kappa = np.asarray(kappa, dtype=float)
    ds = np.asarray(ds, dtype=float)
    n = len(kappa)
    env = rd.braking_envelope_mps(kappa, ds, camber_rad, roughness_rms_g, car.mu_lat, sight_m)

    cruise = np.full(n, CRUISE_MPS)
    if limit_mps is not None:
        lim = np.asarray(limit_mps, dtype=float)
        cruise = np.where(np.isfinite(lim) & (lim > 0), lim * CRUISE_OVER_LIMIT, CRUISE_MPS)
    # The cruise cap is a property of the simulated driver, so it must be braked for too.
    v_cap = np.minimum(env, cruise)
    for i in range(n - 2, -1, -1):
        v_cap[i] = min(v_cap[i], math.sqrt(v_cap[i + 1] ** 2 + 2.0 * rd.BRAKE_DECEL_MPS2 * ds[i]))

    if elevation_m is not None and n > 2:
        z = rd.moving_average(np.asarray(elevation_m, dtype=float), rd.SMOOTH_WINDOW)
        s = np.concatenate([[0.0], np.cumsum(ds[:-1])])
        grade = np.gradient(z, s)
        kappa_v = rd.moving_average(np.gradient(grade, s), rd.SMOOTH_WINDOW)
    else:
        z = None
        grade = np.zeros(n)
        kappa_v = np.zeros(n)

    v = v_cap.copy()
    v[0] = v_cap[0]
    for i in range(n - 1):
        a = acceleration_mps2(v[i], grade[i], car)
        v[i + 1] = min(v_cap[i + 1], math.sqrt(max(0.0, v[i] ** 2 + 2.0 * a * ds[i])))
    v = np.maximum(v, 0.5)

    dt = ds / v
    t = np.concatenate([[0.0], np.cumsum(dt[:-1])])
    a_lon = np.gradient(v * v / 2.0) / ds
    return {
        "v": v, "dt": dt, "t": t, "a_lat": v * v * kappa, "a_lon": a_lon,
        "a_vert": v * v * kappa_v, "grade": grade, "elevation": z, "envelope": env,
        "cruise": cruise,
    }


# ---------------------------------------------------------------------------
# Features (section 3) over an index window [lo, hi)
# ---------------------------------------------------------------------------

def _per_min(count: float, seconds: float) -> float:
    return count * 60.0 / max(seconds, 1.0)


def _events(mask: np.ndarray) -> int:
    """Number of separate runs of True."""
    m = np.asarray(mask, dtype=bool)
    return int(np.sum(m[1:] & ~m[:-1]) + (1 if len(m) and m[0] else 0))


def window_features(lap: dict, corners: list, sight_m, lo: int, hi: int) -> dict:
    sl = slice(lo, hi)
    dt = lap["dt"][sl]
    T = float(np.sum(dt))
    a_lat = lap["a_lat"][sl]
    a_lon = lap["a_lon"][sl]
    v = lap["v"][sl]
    w = dt / max(T, 1e-6)

    engaged = float(np.sum(w * (np.abs(a_lat) > ENGAGED_G * G)))
    dead = float(np.sum(w * ((np.abs(a_lat) < 0.05 * G) & (v >= 0.95 * lap["cruise"][sl]))))

    cs = [c for c in corners if lo <= c["apex"] < hi]
    apex_t = np.array([lap["t"][c["apex"]] for c in cs])
    gaps = np.diff(apex_t) if len(apex_t) > 2 else np.array([])
    regularity = 1.0 - min(1.0, float(np.std(gaps) / np.mean(gaps))) if len(gaps) >= 2 else 0.0

    # Esses: lateral load flips side within 3 s while keeping >= 85 % of the speed --
    # weight thrown side to side, not brake-turn-brake.
    transitions = 0
    last_side, last_t, last_v = 0, -1e9, 0.0
    t = lap["t"][sl]
    for i in range(len(a_lat)):
        side = 1 if a_lat[i] > 0.15 * G else (-1 if a_lat[i] < -0.15 * G else 0)
        if side == 0:
            continue
        if last_side and side != last_side and t[i] - last_t <= 3.0 and v[i] >= 0.85 * last_v:
            transitions += 1
        last_side, last_t, last_v = side, t[i], v[i]

    braking_j = float(np.sum(np.maximum(0.0, -np.diff(v * v / 2.0)))) if len(v) > 1 else 0.0

    a_vert = lap["a_vert"][sl]
    unweight = _events(a_vert < -0.15 * G)
    compress = _events(a_vert > 0.15 * G)
    relief = 0.0
    if lap["elevation"] is not None and hi - lo > 1:
        relief = float(np.sum(np.abs(np.diff(lap["elevation"][sl]))))

    sight = np.asarray(sight_m, dtype=float)
    blind = 0
    for c in cs:
        vc = c["apex_mps"]
        stop = vc * rd.REACTION_S + vc * vc / (2.0 * rd.BRAKE_DECEL_MPS2)
        if sight[c["start"]] < stop:
            blind += 1
    hairpins = sum(1 for c in cs if c["severity"] == "HP")
    tight = sum(1 for c in cs if c["severity"] == "HP" or c["severity"] <= 3)
    tightens = sum(1 for c in cs if "tightens" in c["mods"])

    return {
        "seconds": T,
        "engagement": engaged,
        "dead_time": dead,
        "cadence_pm": _per_min(len(cs), T),
        "regularity": regularity,
        "transitions_pm": _per_min(transitions, T),
        "braking_jpkg_pm": _per_min(braking_j, T),
        "vertical_pm": _per_min(unweight + compress, T),
        "relief_m_pm": _per_min(relief, T),
        "hairpins_pm": _per_min(hairpins, T),
        "tight_share": tight / len(cs) if cs else 0.0,
        "blind_share": blind / len(cs) if cs else 0.0,
        "tightens_pm": _per_min(tightens, T),
        "mean_speed": float(np.sum(w * v)),
    }


def _sat(x: float, x0: float) -> float:
    return 100.0 * (1.0 - math.exp(-max(0.0, x) / x0))


def axis_scores(f: dict) -> dict:
    """TECH and FLOW from features (SURF/CLEAR need crowd/external data: road_dna)."""
    tech = (0.25 * _sat(f["cadence_pm"], 3.0)
            + 0.20 * 100.0 * f["tight_share"]
            + 0.15 * _sat(f["hairpins_pm"], 0.8)
            + 0.15 * _sat(f["transitions_pm"], 2.0)
            + 0.10 * 100.0 * f["blind_share"]
            + 0.10 * _sat(f["vertical_pm"], 1.5)
            + 0.05 * _sat(f["tightens_pm"], 0.5))
    # Braking per unit of cornering: point-and-squirt roads brake a lot for little load.
    squirt = f["braking_jpkg_pm"] / max(1.0, 1000.0 * f["engagement"])
    flow = (0.35 * 100.0 * min(1.0, f["engagement"] / 0.6)
            + 0.20 * 100.0 * f["regularity"]
            + 0.20 * _sat(f["transitions_pm"], 2.0)
            + 0.15 * 100.0 * (1.0 - min(1.0, squirt))
            + 0.10 * 100.0 * (1.0 - f["dead_time"]))
    return {"tech": int(round(np.clip(tech, 0, 100))), "flow": int(round(np.clip(flow, 0, 100)))}


ARCHETYPES = ("Switchbacks", "Esses", "Technical", "Rollercoaster",
              "Flowing sweepers", "Fast open", "Town", "Connector")


def archetype(f: dict, town: bool = False) -> str:
    """A label a driver recognises. Rule-based until crowd data allows clustering."""
    if town:
        return "Town"
    if f["hairpins_pm"] >= 0.8:
        return "Switchbacks"
    if f["transitions_pm"] >= 2.0 and f["engagement"] >= 0.25:
        return "Esses"
    if f["cadence_pm"] >= 3.0 and f["tight_share"] >= 0.4:
        return "Technical"
    if f["vertical_pm"] >= 2.0:
        return "Rollercoaster"
    if f["engagement"] >= 0.15 and f["cadence_pm"] >= 1.0 and f["tight_share"] < 0.4:
        return "Flowing sweepers"
    if f["dead_time"] < 0.6 and f["cadence_pm"] >= 0.4:
        return "Fast open"
    return "Connector"
