"""The audio bus (docs/ARCHITECTURE.md section 5): what the road asks of the driver, as numbers a sound engine can follow.

Pure and platform-agnostic: no audio here. Each step takes the aligned chassis loads (ISO 8855, in g), the speed, and
the corners inside the 400 m look-ahead, and returns one frame (schemas/telemetry_contracts.json `AudioBusFrame`):

  engagement    0..1  the driver's workload now: horizontal g and yaw jerk, the same blend as kinematics.py
  intensity     0..1  engagement held like music wants it: quick to rise, slow to fall
  anticipation  0..1  the build toward the next corner's entry, from the time left to it and how tight it is
  energy        0..1  what the music plays at: intensity, lifted by anticipation, capped while `calm`
  cutoff_hz           a low-pass that opens with energy (log scale)
  layers              gains for pad / pulse / bass / lead: stems that cross in as energy rises
  swell         0..1  the riser into a corner; back to 0 at its entry
  master        0..1  everything, lowered while the co-driver speaks
  calm                true while the driver is over Sight: the music thins out, it never eggs on

Two laws. Nothing here reads speed as excitement: speed only turns a distance into a time. And unknown stays unknown:
with no calibrated g `engagement` and `intensity` are None, with no look-ahead `anticipation` is None, and the music
rests on its pad rather than play a road it has not measured.

web/audio_bus.js is the port (tests/test_audio_bus.py holds the two to one sequence).
"""
import math

G_STD = 9.80665
HORIZON_M = 400.0          # corners further ahead than this are not heard yet
BUILD_S = 8.0              # a build starts this long before a corner's entry
MIN_V = 3.0                # m/s: below this a distance is not turned into a time (a queue is not a build-up)
ATTACK_S, RELEASE_S = 1.2, 6.0
ANTIC_S = 0.35
CALM_S = 0.6
CALM_CAP = 0.12
DUCK, DUCK_DOWN_S, DUCK_UP_S = 0.35, 0.12, 0.7
CUT_LO, CUT_HI = 380.0, 11000.0
LAYERS = (('pad', None, None), ('pulse', 0.12, 0.38), ('bass', 0.28, 0.52), ('lead', 0.52, 0.82))
PAD_FLOOR = 0.55


def _finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _clip(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def _smoothstep(a, b, x):
    t = _clip((x - a) / (b - a))
    return t * t * (3.0 - 2.0 * t)


def _toward(now, target, dt, tau):
    return target if tau <= 0 else now + (target - now) * (1.0 - math.exp(-dt / tau))


def severity(call):
    """A pace-note number (1 the tightest, 6 the most open) as 0..1; None when it has none."""
    return _clip((7.0 - call) / 6.0) if _finite(call) and 1 <= call <= 6 else None


class AudioBus:
    def __init__(self):
        self.reset()

    def reset(self):
        self.intensity = None
        self.anticipation = None
        self.cap = 1.0
        self.master = 1.0
        self.yaw = None

    def step(self, dt, lat_g=None, lon_g=None, speed_mps=None, corners=None, over_sight=False, speaking=False):
        """One frame. dt in s. corners: None when the road ahead is not known, else [(ahead_m, severity 0..1 or None)]."""
        dt = _clip(dt if _finite(dt) else 0.0, 0.0, 1.0)
        v = speed_mps if _finite(speed_mps) and speed_mps >= 0 else None

        # 1. the workload now (kinematics.py: 0.7 horizontal g over 0.8 g, 0.3 yaw jerk over 1.5 rad/s^2)
        engagement = None
        if _finite(lat_g) and _finite(lon_g):
            jerk = 0.0
            yaw = lat_g * G_STD / v if v is not None and v >= MIN_V else None     # steady-state yaw rate from lateral g
            if yaw is not None and self.yaw is not None and dt > 0:
                jerk = abs(yaw - self.yaw) / dt
            self.yaw = yaw
            engagement = _clip(0.7 * (math.hypot(lat_g, lon_g) / 0.8) + 0.3 * (jerk / 1.5))
        else:
            self.yaw = None

        # 2. held as music wants it
        if engagement is None:
            self.intensity = None
        elif self.intensity is None:
            self.intensity = engagement
        else:
            self.intensity = _toward(self.intensity, engagement, dt, ATTACK_S if engagement > self.intensity else RELEASE_S)

        # 3. the build toward the next corner
        target = None
        if corners is not None and v is not None:
            target = 0.0
            if v >= MIN_V:
                for ahead_m, sev in corners:
                    if not _finite(ahead_m) or ahead_m < 0 or ahead_m > HORIZON_M:
                        continue
                    weight = 0.4 + 0.6 * (sev if _finite(sev) else 0.5)
                    target = max(target, weight * _clip(1.0 - (ahead_m / v) / BUILD_S))
        if target is None:
            self.anticipation = None
        elif self.anticipation is None:
            self.anticipation = target
        else:
            # it builds; at the entry it lets go at once (the corner is the downbeat, not a fade)
            self.anticipation = _toward(self.anticipation, target, dt, ANTIC_S) if target >= self.anticipation else _toward(self.anticipation, target, dt, ANTIC_S / 3)

        # 4. over Sight the music steps back
        self.cap = _toward(self.cap, CALM_CAP if over_sight else 1.0, dt, CALM_S)
        self.master = _toward(self.master, DUCK if speaking else 1.0, dt, DUCK_DOWN_S if speaking else DUCK_UP_S)

        i = self.intensity if self.intensity is not None else 0.0
        a = self.anticipation if self.anticipation is not None else 0.0
        energy = min(_clip(i + 0.5 * a * (1.0 - i)), self.cap)
        layers = {}
        for name, lo, hi in LAYERS:
            layers[name] = PAD_FLOOR + (1.0 - PAD_FLOOR) * (1.0 - energy) if lo is None else _smoothstep(lo, hi, energy)
        return {
            'engagement': engagement, 'intensity': self.intensity, 'anticipation': self.anticipation,
            'energy': energy, 'cutoff_hz': CUT_LO * (CUT_HI / CUT_LO) ** energy, 'layers': layers,
            'swell': min(a, self.cap), 'master': self.master, 'calm': bool(over_sight),
        }
