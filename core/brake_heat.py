"""Brake heat: how hard the brakes have been working, from speed and height alone. Pure; web/brake_heat.js is the port
(tests/test_brake_heat.py holds the two to one sequence).

The phone cannot see a brake disc. What it can see is energy going away. A car's mechanical energy per kilogram is
e = v^2 / 2 + g h. When e falls faster than rolling resistance and air drag take it, something else is taking it, and
on a road that is the brakes (or the engine, in a low gear). So

    brake power per kg   p = max(0, -de/dt - c_rr g v - k_aero v^3)          W/kg

and the discs are one lumped thermal mass that takes it in and gives it back to the air, faster the faster you go:

    d(rise)/dt = p / C - rise / tau(v)

C is the disc heat capacity per kilogram of car (discs ~1.7 % of the car's mass, cast iron 460 J/kg K, so 7.8 J/kg K;
the car's mass cancels). tau(v) is the cooling time, ~10 minutes standing, ~2 minutes at 80 km/h.

Two honest limits. Engine braking is counted as brake work, because the phone cannot tell them apart, so this is an
upper bound (in a low gear the real discs are cooler). And it is a model, not a thermometer: `rise_k` is kept inside,
the driver only ever hears a level in words ("working hard", "hot"), never a temperature.

Unknown stays unknown: a step with no speed or no height only cools what is already there (the discs are cooling
whatever we know), and before the first known step `rise_k` is None. A gap of more than GAP_S between known steps, or
height coming back after a gap, starts a new baseline: a jump in height is never read as energy.

ISO 8855 / SI inside: m, s, m/s, K above the air.
"""
import math

G_STD = 9.80665
DISC_C = 0.017 * 460.0        # J per kg of car per K: discs at 1.7 % of the car's mass, cast iron
C_RR = 0.012                  # rolling resistance coefficient
K_AERO = 2.6e-4               # 0.5 rho Cd A / m, 1/m: a 1500 kg car with Cd A 0.65 m^2
TAU_STILL_S = 600.0           # cooling time standing still
TAU_MOVING_S = 150.0          # convective part at V_REF
V_REF = 22.0                  # m/s
H_TAU_S = 4.0                 # height is low-passed first: GPS height jitters by metres, that is not energy
GAP_S = 5.0
WARM_K, HOT_K, REARM_K = 150.0, 250.0, 150.0
CALL_GAP_S = 180.0            # at most one "hot" call every 3 minutes
MAX_P = 400.0                 # W/kg: more than a 1.2 g stop from 120 km/h is a glitch, not braking
WINDOW_S = 2.0                # energy is differenced over at least this long (speed is held between 1 Hz fixes)
MAX_DT_S = 3600.0             # a page asleep for an hour still cools for that hour


def _finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def tau_s(v):
    """Cooling time constant at speed v (m/s)."""
    v = max(0.0, v) if _finite(v) else 0.0
    return 1.0 / (1.0 / TAU_STILL_S + (v / V_REF) ** 0.8 / TAU_MOVING_S)


def level(rise_k):
    """'cool' / 'warm' / 'hot', or None when unknown."""
    if not _finite(rise_k):
        return None
    return 'hot' if rise_k >= HOT_K else 'warm' if rise_k >= WARM_K else 'cool'


class BrakeHeat:
    def __init__(self):
        self.reset()

    def reset(self):
        self.rise = None          # K above the air
        self.h = None             # low-passed height, m
        self.e0 = None            # specific energy at the window's start, J/kg
        self.win = 0.0            # s since the window's start
        self.loss = 0.0           # J/kg rolling and air took since the window's start
        self.v = None
        self.pend = None          # s since the last known step (None before any)
        self.p = None             # brake power over the last closed window, W/kg
        self.armed = True
        self.since_call = None    # s since the last call
        self.peak = None

    def step(self, dt, speed_mps=None, elevation_m=None):
        """One step of dt seconds. Returns {rise_k, power_wkg, level, call}; call is True once when the brakes get hot.

        Energy is differenced over windows of at least WINDOW_S, not step by step: the app sends frames at 10 Hz with the
        speed held between 1 Hz fixes, and a step-by-step difference would put a second's braking into a tenth of a
        second (clipped at MAX_P) and count drag as braking on the step the speed moves. Over a window both even out."""
        dt = max(0.0, min(MAX_DT_S, dt)) if _finite(dt) else 0.0
        v = speed_mps if _finite(speed_mps) and speed_mps >= 0 else None
        h = elevation_m if _finite(elevation_m) else None
        if self.since_call is not None:
            self.since_call += dt
        power = None
        if self.rise is not None:
            vc = v if v is not None else (self.v if self.v is not None else 0.0)
            self.rise *= math.exp(-dt / tau_s(vc))
        if v is not None and h is not None:
            span = (self.pend or 0.0) + dt
            fresh = self.e0 is None or self.pend is None or span > GAP_S
            if fresh:
                self.h = h
            else:
                self.h += (h - self.h) * (1.0 - math.exp(-span / H_TAU_S))
            e = 0.5 * v * v + G_STD * self.h
            if fresh:
                self.e0, self.win, self.loss, self.p = e, 0.0, 0.0, None
            else:
                vm = 0.5 * (v + self.v)
                self.win += span
                self.loss += (C_RR * G_STD * vm + K_AERO * vm ** 3) * span
                if self.win >= WINDOW_S:
                    absorbed = min(MAX_P * self.win, max(0.0, (self.e0 - e) - self.loss))
                    self.p = absorbed / self.win
                    self.rise = (self.rise or 0.0) + absorbed / DISC_C
                    self.e0, self.win, self.loss = e, 0.0, 0.0
                power = self.p
            self.v, self.pend = v, 0.0
            if self.rise is None:
                self.rise = 0.0
        elif self.pend is not None:
            self.pend += dt
        if self.rise is not None:
            self.peak = self.rise if self.peak is None else max(self.peak, self.rise)
        call = False
        if self.rise is not None:
            if self.rise < REARM_K:
                self.armed = True
            elif self.rise >= HOT_K and self.armed and (self.since_call is None or self.since_call >= CALL_GAP_S):
                call, self.armed, self.since_call = True, False, 0.0
        return {'rise_k': self.rise, 'power_wkg': power, 'level': level(self.rise), 'call': call}


def over_track(dist_m, speed_mps, elevation_m):
    """A recorded drive (5 m rows: distance, speed, height) through the model, the time of each row from its distance
    and speed. Returns {peak_k, level, hot_m}: the hottest the discs got, its level, and the metres driven while hot.
    None when no row had both speed and height."""
    bh = BrakeHeat()
    hot_m = 0.0
    for i in range(len(dist_m)):
        dt = 0.0
        if i > 0 and _finite(dist_m[i]) and _finite(dist_m[i - 1]):
            v0, v1 = speed_mps[i - 1], speed_mps[i]
            vm = 0.5 * (v0 + v1) if _finite(v0) and _finite(v1) else None
            dd = dist_m[i] - dist_m[i - 1]
            dt = dd / vm if vm is not None and vm > 0.5 and dd >= 0 else (GAP_S + 1.0)
        out = bh.step(dt, speed_mps[i], elevation_m[i] if elevation_m is not None else None)
        if out['level'] == 'hot' and i > 0 and _finite(dist_m[i]) and _finite(dist_m[i - 1]):
            hot_m += max(0.0, dist_m[i] - dist_m[i - 1])
    if bh.peak is None:
        return None
    return {'peak_k': bh.peak, 'level': level(bh.peak), 'hot_m': hot_m}


DESCENT_DROP_M = 300.0        # a descent the brakes notice: at least this much height lost...
DESCENT_GRADE = 0.05          # ...at 5 % or steeper on average
DESCENT_RISE_M = 30.0         # a rise of more than this ends a descent (a short climb in the middle does not)


def long_descents(dist_m, elevation_m):
    """The long, steep descents on a planned route, from its terrain profile (the map's heights, not a model):
    [{start_m, end_m, drop_m, grade}] biggest drop first. Each runs from a high point to the lowest point before the road
    climbs more than DESCENT_RISE_M again. Rows with no height are skipped; [] when nothing qualifies."""
    pts = [(d, e) for d, e in zip(dist_m, elevation_m or []) if _finite(d) and _finite(e)]
    out = []
    i = 0
    while i < len(pts):
        top = i
        low = i
        j = i + 1
        while j < len(pts):
            if pts[j][1] > pts[top][1] and low == top:
                top = low = j                       # still climbing to the high point
            elif pts[j][1] < pts[low][1]:
                low = j
            elif pts[j][1] - pts[low][1] > DESCENT_RISE_M:
                break
            j += 1
        drop = pts[top][1] - pts[low][1]
        run = pts[low][0] - pts[top][0]
        if drop >= DESCENT_DROP_M and run > 0 and drop / run >= DESCENT_GRADE:
            out.append({'start_m': pts[top][0], 'end_m': pts[low][0], 'drop_m': drop, 'grade': drop / run})
        i = max(low, i + 1) if low > i else j
    out.sort(key=lambda x: -x['drop_m'])
    return out
