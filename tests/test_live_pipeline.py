"""The live (causal) reference and the Swift fixture generated from it."""
import json
import os

import numpy as np

from core import live_pipeline as lp
from tools import make_live_fixture as mk

FIXTURE = os.path.join("ApexKit", "Tests", "Fixtures", "live_fixture.json")


def test_committed_fixture_matches_reference():
    fresh = mk.build()
    committed = json.load(open(FIXTURE, encoding="utf-8"))
    for key in ("outputs_every_10", "gps", "accel", "gyro"):
        np.testing.assert_allclose(np.array(committed[key], dtype=float), np.array(fresh[key], dtype=float),
                                   rtol=1e-12, atol=1e-12, err_msg=f"{key}: run python tools/make_live_fixture.py")
    assert [m[1] for m in committed["mount_every_10"]] == [m[1] for m in fresh["mount_every_10"]]


def test_live_calibration_recovers_mount_like_the_batch_solver():
    from core.kinematics import compute_mount_rotation_matrix
    d = mk.build()
    live = np.array(d["mount_every_10"][-1][2:]).reshape(3, 3)
    R = np.array(d["true_veh_to_phone"])
    static = np.tile(R @ [0.0, 0.0, lp.G], (50, 1))
    pull = np.tile(R @ [3.0, 0.0, lp.G], (50, 1))
    batch = compute_mount_rotation_matrix(static, pull)
    np.testing.assert_allclose(live, batch, atol=1e-6)
    np.testing.assert_allclose(live, R.T, atol=1e-6)


def test_live_camber_reads_the_bank():
    d = mk.build()
    o = np.array(d["outputs_every_10"])
    turn = (o[:, 0] >= 1800) & (o[:, 0] < 2150)
    camber_deg = np.degrees(o[turn, d["output_fields"].index("camber")])
    assert abs(camber_deg.mean() - 4.0) < 0.3


def test_odometer_emits_true_5m_bins():
    odo = lp.Odometer()
    lat0, lon0 = 39.24, -84.70
    nodes = []
    for k in range(20):                       # 20 m/s due north at 1 Hz
        nodes += odo.feed(lat0 + k * 20.0 / 111194.9, lon0, 100.0, 20.0, 5.0, 0.0)
    gaps = [lp.haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(nodes, nodes[1:])]
    assert len(nodes) == 76 and np.allclose(gaps, 5.0, atol=0.01)
