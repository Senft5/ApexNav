"""Deterministic synthetic road geometry and Sensor Logger exports for tests."""
from __future__ import annotations

import math
import os

import numpy as np
import pandas as pd

LAT0, LON0 = 39.2400, -84.7000


def path_from_legs(legs, step_m: float = 5.0, noise_m: float = 0.0, seed: int = 7):
    """Build a lat/lon path from legs of ('straight', length_m) or ('arc', radius_m, turn_deg).

    turn_deg > 0 turns LEFT (counter-clockwise), matching ISO 8855 curvature sign.
    """
    x, y, heading = 0.0, 0.0, math.pi / 2  # start heading North
    xs, ys = [x], [y]
    for leg in legs:
        if leg[0] == "straight":
            n = int(round(leg[1] / step_m))
            for _ in range(n):
                x += step_m * math.cos(heading)
                y += step_m * math.sin(heading)
                xs.append(x)
                ys.append(y)
        else:
            radius, turn = leg[1], math.radians(leg[2])
            n = max(1, int(round(abs(turn) * radius / step_m)))
            dpsi = turn / n
            for _ in range(n):
                heading += dpsi
                x += step_m * math.cos(heading)
                y += step_m * math.sin(heading)
                xs.append(x)
                ys.append(y)
    xs, ys = np.array(xs), np.array(ys)
    if noise_m:
        rng = np.random.default_rng(seed)
        xs = xs + rng.normal(0, noise_m, len(xs))
        ys = ys + rng.normal(0, noise_m, len(ys))
    lat = LAT0 + ys / 110540.0
    lon = LON0 + xs / (111320.0 * math.cos(math.radians(LAT0)))
    return lat, lon


def write_sensor_logger_export(out_dir: str, R_veh_to_phone: np.ndarray, fs_hz: float = 100.0) -> None:
    """A flat drive: 5 s parked, 8 s straight 3 m/s^2 pull, 60 s cruise at 20 m/s heading North.

    CSV layout and sign conventions match the iOS Sensor Logger app as read by
    core.kinematics.ingest_sensor_logger_drive (gravity points down, f = -(gravity + user)).
    """
    os.makedirs(out_dir, exist_ok=True)
    g = 9.80665
    t = np.arange(0.0, 73.0, 1.0 / fs_hz)
    ax = np.where((t >= 5.0) & (t < 11.67), 3.0, 0.0)
    v = np.clip(np.cumsum(ax) / fs_hz, 0.0, 20.0)
    ax = np.where(v >= 20.0, 0.0, ax)

    f_veh = np.column_stack([ax, np.zeros_like(t), np.full_like(t, g)])
    f_phone = f_veh @ R_veh_to_phone.T
    grav_phone = -(np.tile([0.0, 0.0, g], (len(t), 1)) @ R_veh_to_phone.T)
    user_phone = -f_phone - grav_phone
    rng = np.random.default_rng(3)
    user_phone += rng.normal(0, 0.02, user_phone.shape)

    def frame(cols):
        df = pd.DataFrame(cols)
        df.insert(0, "seconds_elapsed", t)
        return df

    frame({"z": user_phone[:, 2], "y": user_phone[:, 1], "x": user_phone[:, 0]}).to_csv(
        os.path.join(out_dir, "Accelerometer.csv"), index=False)
    frame({"z": grav_phone[:, 2], "y": grav_phone[:, 1], "x": grav_phone[:, 0]}).to_csv(
        os.path.join(out_dir, "Gravity.csv"), index=False)
    zeros = np.zeros_like(t)
    frame({"z": zeros, "y": zeros, "x": zeros}).to_csv(os.path.join(out_dir, "Gyroscope.csv"), index=False)

    t_gps = t[:: int(fs_hz)]
    v_gps = v[:: int(fs_hz)]
    north_m = np.cumsum(v) / fs_hz
    lat = LAT0 + north_m[:: int(fs_hz)] / 110540.0
    pd.DataFrame({
        "seconds_elapsed": t_gps, "latitude": lat, "longitude": np.full_like(lat, LON0),
        "altitude": np.full_like(lat, 200.0), "speed": v_gps,
    }).to_csv(os.path.join(out_dir, "Location.csv"), index=False)
    pd.DataFrame({
        "seconds_elapsed": t_gps, "relativeAltitude": np.linspace(0.0, 12.0, len(t_gps)),
        "pressure": np.full_like(t_gps, 99.0),
    }).to_csv(os.path.join(out_dir, "Barometer.csv"), index=False)
