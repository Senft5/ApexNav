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


def _angle(a, b) -> float:
    """Angle between two (not necessarily unit) vectors, radians."""
    return math.atan2(_mag(_cross(a, b)), _dot(a, b))


# ---------------------------------------------------------------------------
# Mount calibration: automatic and continuous
#
#   default       no trusted phone-to-car rotation (start, handheld, remounting): outputs are unknown
#   awaitingPull  vertical known (from steady gravity), forward not yet
#   locked        vertical and forward known
#
# Vertical: once CoreMotion gravity has held still in the phone for SETTLE_S (no rotation other than about
# the vertical, which is the car yawing), +Z_veh = -mean(gravity) over that window; while mounted it follows
# slow trim changes. A sustained gravity swing or off-vertical rotation means the phone was moved: back to
# default until it settles again. Forward: over each GPS speed interval the mean horizontal acceleration is
# compared with GPS dv/dt (straight lines: throttle and braking both count, with their sign) and with v * yaw
# (turns: centripetal acceleration points left of forward). Consistent evidence locks X and keeps refining it;
# evidence that stops agreeing (a phone turned about the vertical) drops back to awaitingPull.
# ---------------------------------------------------------------------------
@dataclass
class MountCalibrator:
    rx: tuple = (1.0, 0.0, 0.0)
    ry: tuple = (0.0, 1.0, 0.0)
    rz: tuple = (0.0, 0.0, 1.0)
    state: str = "default"              # default | awaitingPull | locked
    persisted: bool = False             # rows came from a saved mount: reuse them if gravity agrees
    g_fast: tuple | None = None         # gravity, phone frame, g (points down)
    g_slow: tuple | None = None
    off_axis_rate: float = 0.0          # low-passed |gyro| not about the vertical, rad/s
    settled_s: float = 0.0
    settled_sum: tuple = (0.0, 0.0, 0.0)
    moved_s: float = 0.0
    iv_t: float = 0.0                   # current GPS speed interval
    iv_h: tuple = (0.0, 0.0, 0.0)
    iv_yaw: float = 0.0
    iv_v0: float | None = None
    ev_a: tuple = (0.0, 0.0, 0.0)       # forward evidence: sum of (a_ref * horizontal accel) * T
    ev_w: float = 0.0                   # sum of a_ref^2 * T
    ev_n: int = 0
    dis_w: float = 0.0                  # consecutive evidence disagreeing with the locked X
    dis_n: int = 0

    G_FAST_TAU = 0.1
    G_SLOW_TAU = 0.8
    OFF_AXIS_TAU = 0.2
    SETTLE_ANGLE = math.radians(3.0)
    SETTLE_RATE = 0.15
    SETTLE_S = 2.0
    REMOUNT_ANGLE = math.radians(15.0)
    REMOUNT_RATE = 0.5
    REMOUNT_S = 0.5
    TRIM_TAU = 30.0
    PERSIST_MATCH = math.radians(8.0)
    IV_MIN_S = 0.8
    IV_MAX_S = 3.0
    EV_TAU = 90.0
    MIN_SPEED = 3.0
    LON_MIN = 0.5
    LAT_MIN = 1.0
    LON_GATE = 0.5                      # |dv/dt| below this for turn evidence
    LAT_GATE = 0.7                      # |v * yaw| below this for straight-line evidence
    A_MAX = 8.0                         # beyond what a car does: a GPS speed jump after a dropout, not evidence
    W_LOCK = 6.0
    N_LOCK = 3
    Q_LOCK = 0.7
    Q_LOST = 0.3
    DISAGREE_COS = math.cos(math.radians(45.0))

    def restore(self, rows) -> None:
        """A mount saved from an earlier drive: used as the starting frame, trusted only once gravity confirms it."""
        self.rx, self.ry, self.rz = tuple(rows[0:3]), tuple(rows[3:6]), tuple(rows[6:9])
        self.state, self.persisted = "default", True

    def lock_vertical(self, gravity_g) -> None:
        """Manual vertical lock (+Z_veh = -gravity) now; forward follows from driving."""
        self._set_vertical(_norm(_scale(gravity_g, -1.0)))
        self.persisted = False
        self._reset_evidence()

    def _set_vertical(self, up) -> None:
        self.rz = up
        seed = (0.0, 1.0, 0.0) if abs(self.rz[1]) < 0.9 else (0.0, 0.0, -1.0)
        self.rx = _norm(_reject(seed, self.rz))
        self.ry = _norm(_cross(self.rz, self.rx))
        self.state = "awaitingPull"

    def _reset_evidence(self) -> None:
        self.ev_a, self.ev_w, self.ev_n = (0.0, 0.0, 0.0), 0.0, 0
        self.dis_w, self.dis_n = 0.0, 0
        self.iv_t, self.iv_h, self.iv_yaw, self.iv_v0 = 0.0, (0.0, 0.0, 0.0), 0.0, None

    def observe(self, accel, gyro, gravity_g, dt: float, speed_mps: float) -> None:
        """One 100 Hz sample. gravity_g None (no attitude) leaves the vertical as it is."""
        if gravity_g is not None:
            self._track_gravity(gyro, gravity_g, dt)
        if self.state != "default":
            self._forward_evidence(accel, gyro, dt, speed_mps)

    def _track_gravity(self, gyro, g, dt: float) -> None:
        if self.g_fast is None:
            self.g_fast, self.g_slow = g, g
        self.g_fast = _add(self.g_fast, _scale(_sub(g, self.g_fast), alpha(dt, self.G_FAST_TAU)))
        self.g_slow = _add(self.g_slow, _scale(_sub(g, self.g_slow), alpha(dt, self.G_SLOW_TAU)))
        up = _norm(_scale(self.g_fast, -1.0))
        self.off_axis_rate += alpha(dt, self.OFF_AXIS_TAU) * (_mag(_reject(gyro, up)) - self.off_axis_rate)
        steady = _angle(self.g_fast, self.g_slow) < self.SETTLE_ANGLE and self.off_axis_rate < self.SETTLE_RATE
        if steady:
            self.settled_s += dt
            self.settled_sum = _add(self.settled_sum, _scale(g, dt))
        else:
            self.settled_s, self.settled_sum = 0.0, (0.0, 0.0, 0.0)
        if self.state == "default":
            if self.settled_s >= self.SETTLE_S:
                self._settle_vertical()
            return
        moved = _angle(up, self.rz) > self.REMOUNT_ANGLE or self.off_axis_rate > self.REMOUNT_RATE
        self.moved_s = self.moved_s + dt if moved else 0.0
        if self.moved_s >= self.REMOUNT_S:
            self.state, self.persisted, self.moved_s = "default", False, 0.0
            self._reset_evidence()
            return
        if steady:                                   # follow slow trim of the mount (and of the road on average)
            self.rz = _norm(_add(self.rz, _scale(_sub(up, self.rz), alpha(dt, self.TRIM_TAU))))
            self.rx = _norm(_reject(self.rx, self.rz))
            self.ry = _norm(_cross(self.rz, self.rx))

    def _settle_vertical(self) -> None:
        up = _norm(_scale(self.settled_sum, -1.0))
        if self.persisted and _angle(up, self.rz) < self.PERSIST_MATCH:
            self.rz = up
            self.rx = _norm(_reject(self.rx, up))
            self.ry = _norm(_cross(up, self.rx))
            self.state = "locked"
        else:
            self._set_vertical(up)
        self.persisted, self.moved_s = False, 0.0
        self._reset_evidence()

    def _forward_evidence(self, accel, gyro, dt: float, v: float) -> None:
        if self.iv_v0 is None:
            self.iv_v0 = v
        self.iv_h = _add(self.iv_h, _scale(_reject(accel, self.rz), dt))
        self.iv_yaw += _dot(self.rz, gyro) * dt
        self.iv_t += dt
        if not ((v != self.iv_v0 and self.iv_t >= self.IV_MIN_S) or self.iv_t >= self.IV_MAX_S):
            return
        T, v0 = self.iv_t, self.iv_v0
        h = _scale(self.iv_h, 1.0 / T)
        a_lon = (v - v0) / T
        v_bar = 0.5 * (v + v0)
        a_lat = v_bar * (self.iv_yaw / T)
        self.iv_t, self.iv_h, self.iv_yaw, self.iv_v0 = 0.0, (0.0, 0.0, 0.0), 0.0, v
        if not (v_bar >= self.MIN_SPEED and abs(a_lon) <= self.A_MAX and abs(a_lat) <= self.A_MAX):
            return
        if abs(a_lon) >= self.LON_MIN and abs(a_lat) < self.LAT_GATE:
            sample, weight = _scale(h, a_lon * T), a_lon * a_lon * T
        elif abs(a_lat) >= self.LAT_MIN and abs(a_lon) < self.LON_GATE:
            sample, weight = _scale(_cross(h, self.rz), a_lat * T), a_lat * a_lat * T     # h ~ a_lat * Y, Y x Z = X
        else:
            return
        if self.state == "locked":                   # a phone turned about the vertical: gravity cannot see it, the evidence can
            s_h = _reject(sample, self.rz)
            if _dot(s_h, self.rx) >= self.DISAGREE_COS * _mag(s_h):
                self.dis_w, self.dis_n = 0.0, 0
            else:
                self.dis_w += weight
                self.dis_n += 1
                if self.dis_n >= self.N_LOCK and self.dis_w >= self.W_LOCK:
                    self.state = "awaitingPull"
                    self._reset_evidence()
        decay = math.exp(-T / self.EV_TAU)
        self.ev_a = _add(_scale(self.ev_a, decay), sample)
        self.ev_w = self.ev_w * decay + weight
        self.ev_n += 1
        if self.ev_n < self.N_LOCK or self.ev_w < self.W_LOCK:
            return
        a_h = _reject(self.ev_a, self.rz)
        q = _mag(a_h) / self.ev_w
        if q >= self.Q_LOCK:
            self.rx = _norm(a_h)
            self.ry = _norm(_cross(self.rz, self.rx))
            self.state = "locked"
        elif q < self.Q_LOST and self.state == "locked":
            self.state = "awaitingPull"
            self._reset_evidence()

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

    def step(self, accel, gyro, timestamp: float, speed_mps: float, gravity_g=None) -> None:
        """accel: proper acceleration with gravity removed, phone frame, m/s^2; gyro rad/s; gravity_g: CoreMotion
        gravity, phone frame, g (points down), or None; speed_mps: latest GPS speed (held between fixes)."""
        dt = 0.01
        if self.last_t is not None:
            dt = max(0.001, min(0.1, timestamp - self.last_t))
        self.last_t = timestamp

        self.mount.observe(accel, gyro, gravity_g, dt, speed_mps)

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
