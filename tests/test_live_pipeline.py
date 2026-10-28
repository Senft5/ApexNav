"""The live (causal) reference and the Swift fixture generated from it."""
import json
import math
import os

import numpy as np
from scipy.spatial.transform import Rotation

from core import live_pipeline as lp
from tools import make_live_fixture as mk

FIXTURE = os.path.join("ApexKit", "Tests", "Fixtures", "live_fixture.json")


def _mount_error_deg(rows, veh_to_phone) -> float:
    """Angle between the solved mount (rows = R^T when right) and the true vehicle -> phone rotation."""
    e = np.array(rows, dtype=float).reshape(3, 3) @ np.array(veh_to_phone)
    return math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(e) - 1.0) / 2.0))))


def _drive(pipe, R, phases, t=0.0, v=0.0):
    """Feeds pipe a mounted phone (vehicle -> phone R) through phases of (seconds, accel m/s^2, yaw rad/s).
    GPS speed is held between 1 Hz fixes; gravity is CoreMotion's (points down, g). Returns (t, v, states)."""
    R = np.asarray(R)
    gravity = tuple(R @ [0.0, 0.0, -1.0])
    states = []
    v_gps = v
    for secs, a, yaw in phases:
        for _ in range(int(round(secs * 100))):
            v = max(0.0, v + a / 100.0)
            if math.floor(t + 1e-9) != math.floor(t - 0.01 + 1e-9):
                v_gps = v
            accel = tuple(R @ [a, v * yaw, 0.0])
            gyro = tuple(R @ [0.0, 0.0, yaw])
            pipe.step(accel, gyro, t, v_gps, gravity)
            states.append(pipe.mount.state)
            t += 0.01
    return t, v, states


def test_committed_fixture_matches_reference():
    fresh = mk.build()
    committed = json.load(open(FIXTURE, encoding="utf-8"))
    for key in ("outputs_every_10", "gps", "accel", "gyro", "gravity"):
        np.testing.assert_allclose(np.array(committed[key], dtype=float), np.array(fresh[key], dtype=float),
                                   rtol=1e-12, atol=1e-12, err_msg=f"{key}: run python tools/make_live_fixture.py")
    assert [m[1] for m in committed["mount_every_10"]] == [m[1] for m in fresh["mount_every_10"]]


def test_fixture_drive_calibrates_by_itself_and_relearns_after_a_remount():
    d = mk.build()
    states = {m[0]: m for m in d["mount_every_10"]}
    t_of = lambda s: [m[0] / 100 for m in d["mount_every_10"] if m[1] == s]          # noqa: E731
    assert all(m[1] == "default" for m in d["mount_every_10"] if m[0] < 300)          # handheld: unknown
    first_lock = min(t_of("locked"))
    assert 6.0 < first_lock < 12.0                                                     # from the pull/brake, no tap
    assert _mount_error_deg(states[3000][2:], d["true_veh_to_phone"]) < 1.0
    start, end = d["remount_s"]
    lost = min(x for x in t_of("default") if x > start)
    assert lost - start < 1.0                                                          # remount noticed within a second
    assert all(m[1] != "locked" for m in d["mount_every_10"] if lost * 100 <= m[0] < (end + 2.0) * 100)
    relock = min(x for x in t_of("locked") if x > lost)
    assert relock < 45.0
    assert d["mount_every_10"][-1][1] == "locked"
    assert _mount_error_deg(d["mount_every_10"][-1][2:], d["true_veh_to_phone_after_remount"]) < 1.0


def test_live_camber_reads_the_bank():
    d = mk.build()
    o = np.array(d["outputs_every_10"])
    turn = (o[:, 0] >= 1800) & (o[:, 0] < 2550)
    camber_deg = np.degrees(o[turn, d["output_fields"].index("camber")])
    assert abs(camber_deg.mean() - 4.0) < 0.3


def test_braking_alone_locks_forward_the_right_way_round():
    R = Rotation.from_euler("xyz", [-60.0, 15.0, 140.0], degrees=True).as_matrix()
    pipe = lp.IMUPipeline()
    _, _, states = _drive(pipe, R, [(3.0, 0.0, 0.0), (8.0, -2.5, 0.0)], v=25.0)
    assert states[-1] == "locked"
    assert _mount_error_deg([v for row in pipe.mount.rows() for v in row], R) < 1.0


def test_turns_alone_lock_forward():
    R = Rotation.from_euler("xyz", [80.0, -20.0, -30.0], degrees=True).as_matrix()
    pipe = lp.IMUPipeline()
    _drive(pipe, R, [(3.0, 0.0, 0.0), (6.0, 0.0, 0.2), (6.0, 0.0, -0.2)], v=15.0)
    assert pipe.mount.state == "locked"
    assert _mount_error_deg([v for row in pipe.mount.rows() for v in row], R) < 1.0


def test_phone_swivelled_about_the_vertical_is_relearned():
    # gravity cannot see a turn about the vertical; forward evidence stops agreeing and the axis is learned again
    R1 = Rotation.from_euler("xyz", [0.0, 0.0, 0.0], degrees=True)
    R2 = Rotation.from_euler("z", 120.0, degrees=True) * R1
    pipe = lp.IMUPipeline()
    t, v, _ = _drive(pipe, R1.as_matrix(), [(3.0, 0.0, 0.0), (6.0, 2.0, 0.0)], v=5.0)
    assert pipe.mount.state == "locked"
    _, _, states = _drive(pipe, R2.as_matrix(), [(8.0, -2.0, 0.0), (8.0, 2.0, 0.0), (8.0, -1.5, 0.0), (8.0, 1.5, 0.0)], t=t, v=v)
    assert "awaitingPull" in states and states[-1] == "locked"
    assert _mount_error_deg([x for row in pipe.mount.rows() for x in row], R2.as_matrix()) < 2.0


def test_a_saved_mount_is_trusted_only_when_gravity_agrees():
    R = Rotation.from_euler("xyz", [-70.0, 10.0, 95.0], degrees=True).as_matrix()
    saved = [v for row in R.T for v in row]
    same = lp.IMUPipeline()
    same.mount.restore(saved)
    _, _, states = _drive(same, R, [(2.5, 0.0, 0.0)])                                # parked: no forward evidence at all
    assert states[0] == "default" and states[-1] == "locked"
    other = lp.IMUPipeline()
    other.mount.restore(saved)
    moved = Rotation.from_euler("x", 30.0, degrees=True).as_matrix() @ R            # phone mounted differently today
    _, _, states = _drive(other, moved, [(2.5, 0.0, 0.0)])
    assert states[-1] == "awaitingPull"


def test_a_pothole_spike_shows_in_the_vertical_peak_and_each_take_starts_a_new_window():
    R = Rotation.from_euler("xyz", [-70.0, 10.0, 95.0], degrees=True).as_matrix()
    pipe = lp.IMUPipeline()
    pipe.mount.restore([v for row in R.T for v in row])
    t, v, _ = _drive(pipe, R, [(3.0, 0.0, 0.0)], v=15.0)                             # smooth road, mount locked
    assert pipe.mount.state == "locked"
    pipe.take_vert_peak()
    _drive(pipe, R, [(0.5, 0.0, 0.0)], t=t, v=v)
    smooth = pipe.take_vert_peak()
    gravity = tuple(R @ [0.0, 0.0, -1.0])
    for k, az in enumerate([0.0, 6.0, -6.0, 0.0, 0.0]):                              # a sharp 0.6 g up-down hit over 20 ms
        pipe.step(tuple(R @ [0.0, 0.0, az]), (0.0, 0.0, 0.0), t + 0.5 + k * 0.01, v, gravity)
    hit = pipe.take_vert_peak()
    assert smooth < 0.01 and hit / lp.G > 0.35                                        # above road_dna's 0.35 g spike threshold
    assert pipe.vert_peak == 0.0 and pipe.outputs()[-1] == 0.0                        # taken: the next window starts empty


def test_without_gravity_the_mount_stays_unknown():
    pipe = lp.IMUPipeline()
    for i in range(500):
        pipe.step((2.0, 0.0, 0.0), (0.0, 0.0, 0.0), i * 0.01, 10.0 + i * 0.02)
    assert pipe.mount.state == "default"


def test_odometer_emits_true_5m_bins():
    odo = lp.Odometer()
    lat0, lon0 = 39.24, -84.70
    nodes = []
    for k in range(20):                       # 20 m/s due north at 1 Hz
        nodes += odo.feed(lat0 + k * 20.0 / 111194.9, lon0, 100.0, 20.0, 5.0, 0.0)
    gaps = [lp.haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(nodes, nodes[1:])]
    assert len(nodes) == 76 and np.allclose(gaps, 5.0, atol=0.01)
