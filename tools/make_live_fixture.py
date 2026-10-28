"""Generate ApexKit/Tests/Fixtures/live_fixture.json from core/live_pipeline.py.

A deterministic synthetic drive, with CoreMotion gravity every sample and GPS speed held between 1 Hz fixes:
the phone is handheld (wobbling) at first and then mounted crooked; a hard straight brake comes before most of
the pulling (braking must count as forward evidence with its sign, never lock the axis backwards); a 4-degree
banked left turn; rough pavement; the phone is remounted at a different angle while cruising; it relearns from
acceleration and a right turn; a crest. The Swift tests replay the exact inputs and must reproduce every
recorded output.

  python tools/make_live_fixture.py          # rewrite the fixture
  python tools/make_live_fixture.py --check  # exit 1 if the fixture is stale (CI)
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np
from scipy.spatial.transform import Rotation, Slerp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core import live_pipeline as lp  # noqa: E402

OUT = os.path.join(ROOT, "ApexKit", "Tests", "Fixtures", "live_fixture.json")
FS = 100.0
DURATION_S = 60.0
MOUNT_EULER_DEG = [-70.0, 10.0, 95.0]          # first mount (vehicle -> phone)
REMOUNT_EULER_DEG = [-85.0, -5.0, 20.0]        # after the remount
HANDHELD_UNTIL_S = 3.0
REMOUNT_S = (32.0, 33.5)
BANK_RAD = math.radians(4.0)
LAT0, LON0 = 39.2400, -84.7000


def vehicle_motion(t):
    """Longitudinal accel, speed and yaw rate of the car (ISO 8855)."""
    n = len(t)
    ax, yaw, speed = np.zeros(n), np.zeros(n), np.zeros(n)
    v = 0.0
    for i, ti in enumerate(t):
        a = 0.0
        if 5.0 <= ti < 8.0:
            a = 3.0                                            # pull away to 9 m/s
        elif 8.5 <= ti < 10.0:
            a = -3.0                                           # hard straight brake to 4.5 m/s
        elif 10.5 <= ti < 13.5:
            a = 2.5                                            # to 12 m/s
        elif 13.5 <= ti < 14.5:
            a = 2.0                                            # to 14 m/s
        elif 38.0 <= ti < 42.0:
            a = 1.5                                            # after the remount: to 20 m/s
        v = max(0.0, v + a / FS)
        ax[i], speed[i] = a, v
        if 16.0 <= ti < 26.0:
            yaw[i] = 0.25                                      # banked left turn
        elif 44.0 <= ti < 50.0:
            yaw[i] = -0.2                                      # flat right turn
    return ax, speed, yaw


def phone_rotations(t):
    """Vehicle -> phone rotation over time: handheld wobble, mount 1, remount (slerp), mount 2."""
    r1 = Rotation.from_euler("xyz", MOUNT_EULER_DEG, degrees=True)
    r2 = Rotation.from_euler("xyz", REMOUNT_EULER_DEG, degrees=True)
    slerp = Slerp([REMOUNT_S[0], REMOUNT_S[1]], Rotation.concatenate([r1, r2]))
    out = []
    for ti in t:
        if ti < HANDHELD_UNTIL_S:
            wob = Rotation.from_rotvec(math.radians(20.0) * math.sin(2 * math.pi * 0.7 * ti) * np.array([0.6, 0.8, 0.0]))
            out.append((wob * r1).as_matrix())
        elif ti < REMOUNT_S[0]:
            out.append(r1.as_matrix())
        elif ti < REMOUNT_S[1]:
            out.append(slerp([ti]).as_matrix()[0])
        else:
            out.append(r2.as_matrix())
    return np.array(out)


def build() -> dict:
    rng = np.random.default_rng(42)
    n = int(DURATION_S * FS)
    t = np.arange(n) / FS
    ax, speed_true, yaw = vehicle_motion(t)
    banked = (yaw > 0).astype(float)
    ay = speed_true * yaw * np.where(banked > 0, math.cos(BANK_RAD), 1.0) - lp.G * math.sin(BANK_RAD) * banked
    az = 0.8 * np.sin(2 * math.pi * 12.0 * t) * (t > 5) + rng.normal(0, 0.15, n) * (t > 2)
    az += np.where((t > 52) & (t < 53.5), -1.5 * np.sin(math.pi * (t - 52) / 1.5), 0.0)   # crest unweighting
    Rs = phone_rotations(t)

    accel_phone = np.einsum("nij,nj->ni", Rs, np.column_stack([ax, ay, az]))
    gyro_veh = np.einsum("nij,nj->ni", Rs, np.column_stack([np.zeros(n), np.zeros(n), yaw]))
    # the phone turning relative to the car, seen in the phone frame: omega = -rotvec(R(t+dt) R(t)^T) / dt
    rel = np.zeros((n, 3))
    for i in range(n - 1):
        rel[i] = -Rotation.from_matrix(Rs[i + 1] @ Rs[i].T).as_rotvec() * FS
    gyro_phone = gyro_veh + rel + rng.normal(0, 0.002, (n, 3)) * (t > 2)[:, None]
    gravity_g = np.einsum("nij,j->ni", Rs, np.array([0.0, 0.0, -1.0]))                    # CoreMotion gravity (points down), g
    speed_gps = speed_true[(np.floor(t) * FS).astype(int)]                                # GPS speed, held between 1 Hz fixes

    pipe = lp.IMUPipeline()
    outputs, mounts = [], []
    for i in range(n):
        pipe.step(tuple(accel_phone[i]), tuple(gyro_phone[i]), float(t[i]), float(speed_gps[i]), tuple(gravity_g[i]))
        if i % 10 == 0:
            outputs.append([i] + pipe.outputs())
            mounts.append([i, pipe.mount.state] + [v for row in pipe.mount.rows() for v in row])
        if i % 50 == 0:
            pipe.take_vert_peak()                       # a new spike window every half second, as the app does per frame

    # 1 Hz GPS along the driven path + barometer, through elevation fusion and the odometer
    heading = np.cumsum(yaw) / FS
    north = np.cumsum(speed_true * np.cos(heading)) / FS
    west = np.cumsum(speed_true * np.sin(heading)) / FS     # left turn -> heading increases -> drifts west
    fusion = lp.ElevationFusion()
    odo = lp.Odometer()
    fixes, nodes = [], []
    for k in range(0, n, int(FS)):
        lat = LAT0 + north[k] / 110540.0
        lon = LON0 - west[k] / (111320.0 * math.cos(math.radians(LAT0)))
        baro_rel = 0.12 * t[k]
        gps_alt = 200.0 + 0.12 * t[k] + float(rng.normal(0, 1.5))
        fusion.relative_baro_m = baro_rel
        fusion.ingest_gps(gps_alt, 4.0)
        elev = fusion.elevation()
        rough = pipe.take_segment_rough_rms()
        emitted = odo.feed(lat, lon, elev, float(speed_true[k]), 5.0, rough)
        fixes.append([float(t[k]), lat, lon, gps_alt, baro_rel, float(speed_true[k])])
        nodes.append(emitted)

    return {
        "about": "Generated by tools/make_live_fixture.py from core/live_pipeline.py -- do not edit.",
        "fs_hz": FS,
        "true_veh_to_phone": Rs[int(20.0 * FS)].tolist(),
        "true_veh_to_phone_after_remount": Rs[-1].tolist(),
        "remount_s": list(REMOUNT_S),
        "t": t.tolist(),
        "speed": speed_gps.tolist(),
        "accel": accel_phone.tolist(),
        "gyro": gyro_phone.tolist(),
        "gravity": gravity_g.tolist(),
        "outputs_every_10": outputs,
        "output_fields": ["index", "lon_acc", "lat_acc", "yaw_rate", "crest_acc", "hp_vert", "rough_mean_sq", "camber", "engagement"],
        "mount_every_10": mounts,
        "gps": fixes,
        "gps_fields": ["t", "lat", "lon", "gps_alt_m", "baro_rel_m", "speed_mps"],
        "gps_vertical_accuracy_m": 4.0,
        "gps_horizontal_accuracy_m": 5.0,
        "nodes_per_fix": nodes,
        "rough_rms_per_fix_note": "odometer is fed the IMU segment roughness RMS at the end of the run (constant)",
        "rough_rms_for_odometer": pipe.take_segment_rough_rms(),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    text = json.dumps(build(), separators=(",", ":"))
    if args.check:
        current = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if current != text:
            print(f"{OUT} is stale: run python tools/make_live_fixture.py")
            return 1
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"Wrote {OUT} ({len(text) / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
