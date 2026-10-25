"""Reference for the causal, sample-by-sample pipeline the phone runs live.

`core/kinematics.py` profiles a whole recorded drive offline (zero-phase Butterworth,
batch mount solve). On the phone, every 100 Hz sample must be handled the moment it
arrives, so the live estimators are causal first-order filters. This module is their
specification: `ApexKit` (Swift, ApexKit/Sources/ApexKit) is held to it numerically by
`ApexKit/Tests/ApexKitTests` via `ApexKit/Tests/Fixtures/live_fixture.json`, which
`tools/make_live_fixture.py` generates from this file.

ISO 8855 vehicle frame, SI units, radians inside.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

G = 9.80665
SEGMENT_M = 5.0
EARTH_RADIUS_M = 6371008.8


def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _scale(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def _add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def _mag(a): return math.sqrt(max(0.0, _dot(a, a)))
def _norm(a):
    m = math.sqrt(max(1e-12, _dot(a, a)))
    return (a[0] / m, a[1] / m, a[2] / m)
def _reject(a, axis): return _sub(a, _scale(axis, _dot(a, axis)))


def alpha(dt: float, tau: float) -> float:
    """First-order low-pass gain for step dt and time constant tau."""
    return 1.0 - math.exp(-dt / tau)


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2.0 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


# ---------------------------------------------------------------------------
# Mount calibration: vertical lock from gravity, forward lock from a straight pull
# ---------------------------------------------------------------------------
@dataclass
class MountCalibrator:
    rx: tuple = (1.0, 0.0, 0.0)
    ry: tuple = (0.0, 1.0, 0.0)
    rz: tuple = (0.0, 0.0, 1.0)
    state: str = "default"              # default | awaitingPull | locked
    pull_accum: tuple = (0.0, 0.0, 0.0)
    pull_samples: int = 0

    PULL_MIN_MPS2 = 1.2
    PULL_RESET_MPS2 = 0.5
    PULL_MAX_GYRO = 0.15
    PULL_SAMPLES = 30

    def lock_vertical(self, gravity_g) -> None:
        """+Z_veh = -gravity (CoreMotion gravity points down); seed X, await the pull."""
        self.rz = _norm(_scale(gravity_g, -1.0))
        seed = (0.0, 1.0, 0.0) if abs(self.rz[1]) < 0.9 else (0.0, 0.0, -1.0)
        self.rx = _norm(_reject(seed, self.rz))
        self.ry = _norm(_cross(self.rz, self.rx))
        self.pull_accum, self.pull_samples = (0.0, 0.0, 0.0), 0
        self.state = "awaitingPull"

    def feed_pull(self, accel, gyro) -> bool:
        """Accumulate a straight forward pull; returns True on the sample that locks X."""
        h = _reject(accel, self.rz)
        consistent = self.pull_samples == 0 or _dot(h, self.pull_accum) > 0
        if _mag(h) > self.PULL_MIN_MPS2 and _mag(gyro) < self.PULL_MAX_GYRO and consistent:
            self.pull_accum = _add(self.pull_accum, h)
            self.pull_samples += 1
            if self.pull_samples >= self.PULL_SAMPLES:
                self.rx = _norm(_reject(self.pull_accum, self.rz))
                self.ry = _norm(_cross(self.rz, self.rx))
                self.state = "locked"
                self.pull_accum, self.pull_samples = (0.0, 0.0, 0.0), 0
                return True
        elif _mag(h) < self.PULL_RESET_MPS2:
            self.pull_accum, self.pull_samples = (0.0, 0.0, 0.0), 0
        return False

    def rows(self):
        return [list(self.rx), list(self.ry), list(self.rz)]


# ---------------------------------------------------------------------------
# Live IMU estimators (100 Hz)
# ---------------------------------------------------------------------------
@dataclass
class IMUPipeline:
    mount: MountCalibrator = field(default_factory=MountCalibrator)
    last_t: float | None = None
    lon_acc: float = 0.0        # +X forward, m/s^2
    lat_acc: float = 0.0        # +Y left, m/s^2
    yaw_rate: float = 0.0       # about +Z up, rad/s
    crest_acc: float = 0.0      # < 1 Hz vertical (gravity removed)
    hp_vert: float = 0.0        # > 8 Hz vertical
    last_az: float = 0.0
    rough_mean_sq: float = 0.0
    seg_rough_sum_sq: float = 0.0
    seg_rough_count: int = 0
    camber: float = 0.0         # turn-relative bank, rad
    engagement: float = 0.0

    def step(self, accel, gyro, timestamp: float, speed_mps: float) -> None:
        """accel: proper acceleration with gravity removed, phone frame, m/s^2; gyro rad/s."""
        dt = 0.01
        if self.last_t is not None:
            dt = max(0.001, min(0.1, timestamp - self.last_t))
        self.last_t = timestamp

        if self.mount.state == "awaitingPull":
            self.mount.feed_pull(accel, gyro)

        m = self.mount
        ax, ay, az = _dot(m.rx, accel), _dot(m.ry, accel), _dot(m.rz, accel)
        yaw = _dot(m.rz, gyro)

        a_h = alpha(dt, 0.15)
        self.lon_acc += a_h * (ax - self.lon_acc)
        self.lat_acc += a_h * (ay - self.lat_acc)
        self.yaw_rate += a_h * (yaw - self.yaw_rate)

        self.crest_acc += alpha(dt, 1.0 / (2.0 * math.pi * 1.0)) * (az - self.crest_acc)

        rc = 1.0 / (2.0 * math.pi * 8.0)
        beta = rc / (rc + dt)
        self.hp_vert = beta * (self.hp_vert + az - self.last_az)
        self.last_az = az
        sq = self.hp_vert * self.hp_vert
        self.rough_mean_sq += alpha(dt, 0.5) * (sq - self.rough_mean_sq)
        self.seg_rough_sum_sq += sq
        self.seg_rough_count += 1

        # a_y = v w_z cos(phi) - g sin(phi), turn-relative (same gating as core/kinematics.py)
        a_kin = speed_mps * self.yaw_rate
        if abs(a_kin) > 1.5:
            sin_phi = max(-0.5, min(0.5, (abs(a_kin) - abs(self.lat_acc)) / G))
            self.camber += alpha(dt, 0.3) * (math.asin(sin_phi) - self.camber)
        else:
            self.camber -= alpha(dt, 0.6) * self.camber

        combined_g = math.hypot(self.lat_acc, self.lon_acc) / G
        rough_g = math.sqrt(max(0.0, self.rough_mean_sq)) / G
        self.engagement = min(1.0, (combined_g / 0.75) * 0.75 + (rough_g / 0.45) * 0.25)

    def take_segment_rough_rms(self) -> float:
        rms = (math.sqrt(self.seg_rough_sum_sq / self.seg_rough_count) if self.seg_rough_count
               else math.sqrt(max(0.0, self.rough_mean_sq)))
        return rms

    def reset_segment_rough(self) -> None:
        self.seg_rough_sum_sq, self.seg_rough_count = 0.0, 0

    def outputs(self) -> list:
        return [self.lon_acc, self.lat_acc, self.yaw_rate, self.crest_acc, self.hp_vert,
                self.rough_mean_sq, self.camber, self.engagement]


# ---------------------------------------------------------------------------
# Elevation fusion and the 5 m arc-length odometer
# ---------------------------------------------------------------------------
@dataclass
class ElevationFusion:
    """Barometer gives the smooth relative shape, GPS anchors it to MSL."""
    baro_available: bool = True
    relative_baro_m: float = 0.0
    baro_offset_m: float | None = None
    gps_only_m: float | None = None

    def ingest_gps(self, altitude_m: float, vertical_accuracy_m: float) -> None:
        if vertical_accuracy_m <= 0:
            return
        anchor = altitude_m - self.relative_baro_m
        if self.baro_offset_m is None:
            self.baro_offset_m = anchor
        else:
            k = 0.02 * min(1.0, 8.0 / max(vertical_accuracy_m, 1.0))
            self.baro_offset_m += k * (anchor - self.baro_offset_m)
        self.gps_only_m = altitude_m if self.gps_only_m is None else self.gps_only_m + 0.2 * (altitude_m - self.gps_only_m)

    def elevation(self):
        if self.baro_available and self.baro_offset_m is not None:
            return self.relative_baro_m + self.baro_offset_m
        return self.gps_only_m


@dataclass
class Odometer:
    """Emits a node every 5.0 m of arc length between fixes (interpolating position and
    elevation), so 1 Hz GPS at speed still yields true 5 m bins."""
    prev_lat: float | None = None
    prev_lon: float | None = None
    prev_elev: float | None = None
    since_node_m: float = 0.0
    last_node_elev: float | None = None
    grade_pct: float = 0.0

    MAX_ACCURACY_M = 30.0
    JUMP_M = 250.0
    STATIONARY_MPS = 0.8

    def _reset(self, lat, lon, elev):
        self.prev_lat, self.prev_lon, self.prev_elev = lat, lon, elev
        self.since_node_m = 0.0
        self.last_node_elev = elev

    def feed(self, lat, lon, elev, speed_mps, accuracy_m, rough_rms) -> list:
        """Returns emitted nodes [lat, lon, elev|None, grade_pct, rough_rms]."""
        if accuracy_m > self.MAX_ACCURACY_M:
            return []
        if self.prev_lat is None:
            self._reset(lat, lon, elev)
            return []
        leg = haversine_m(self.prev_lat, self.prev_lon, lat, lon)
        if leg > self.JUMP_M:
            self._reset(lat, lon, elev)
            return []
        if 0 <= speed_mps < self.STATIONARY_MPS:
            self.prev_lat, self.prev_lon, self.prev_elev = lat, lon, elev
            return []
        nodes = []
        s = SEGMENT_M - self.since_node_m
        while s <= leg and leg > 0:
            t = s / leg
            n_lat = self.prev_lat + (lat - self.prev_lat) * t
            n_lon = self.prev_lon + (lon - self.prev_lon) * t
            if self.prev_elev is not None and elev is not None:
                n_elev = self.prev_elev + (elev - self.prev_elev) * t
            else:
                n_elev = elev
            if n_elev is not None and self.last_node_elev is not None:
                raw = max(-35.0, min(35.0, (n_elev - self.last_node_elev) / SEGMENT_M * 100.0))
                self.grade_pct = 0.6 * self.grade_pct + 0.4 * raw
            self.last_node_elev = n_elev
            nodes.append([n_lat, n_lon, n_elev, self.grade_pct, rough_rms])
            s += SEGMENT_M
        self.since_node_m = leg - (s - SEGMENT_M)
        self.prev_lat, self.prev_lon, self.prev_elev = lat, lon, elev
        return nodes
