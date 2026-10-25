import os
import zipfile
import numpy as np
import pandas as pd
from scipy.signal import butter, filtfilt

G_STD = 9.80665

def compute_mount_rotation_matrix(static_accel_xyz: np.ndarray, pull_accel_xyz: np.ndarray) -> np.ndarray:
    g_vec = np.mean(static_accel_xyz, axis=0)
    z_veh = g_vec / np.linalg.norm(g_vec)
    net_pull = np.mean(pull_accel_xyz, axis=0) - g_vec
    x_proj = net_pull - np.dot(net_pull, z_veh) * z_veh
    norm_x = np.linalg.norm(x_proj)
    if norm_x < 1e-3:
        raise ValueError("Forward pull magnitude too small to lock X-axis.")
    x_veh = x_proj / norm_x
    y_veh = np.cross(z_veh, x_veh)
    return np.vstack([x_veh, y_veh, z_veh])

def profile_drive_dataframe(df: pd.DataFrame, R: np.ndarray, fs_hz: float = 100.0) -> pd.DataFrame:
    veh_accel = df[['ax', 'ay', 'az']].to_numpy() @ R.T
    veh_gyro = df[['gx', 'gy', 'gz']].to_numpy() @ R.T
    ax_v, ay_v, az_v = veh_accel[:, 0], veh_accel[:, 1], veh_accel[:, 2] - G_STD
    omega_z = veh_gyro[:, 2]
    v_mps = df['v_mps'].to_numpy()

    a_kin_y = v_mps * omega_z
    sin_camber = np.clip((np.abs(a_kin_y) - np.abs(ay_v)) / G_STD, -0.5, 0.5)
    camber_deg = np.where(np.abs(a_kin_y) > 1.5, np.degrees(np.arcsin(sin_camber)), 0.0)

    nyq = 0.5 * fs_hz
    b_low, a_low = butter(2, 1.0 / nyq, btype='low')
    b_high, a_high = butter(2, 8.0 / nyq, btype='high')
    crest_g = filtfilt(b_low, a_low, az_v) / G_STD
    rough_g = filtfilt(b_high, a_high, az_v) / G_STD

    horiz_g = np.hypot(ax_v, ay_v) / G_STD
    yaw_jerk = np.abs(np.gradient(omega_z, 1.0 / fs_hz))
    engagement = np.clip(0.7 * (horiz_g / 0.8) + 0.3 * (yaw_jerk / 1.5), 0.0, 1.0)

    dt = np.gradient(df['t_sec'].to_numpy())
    dist_m = np.cumsum(v_mps * np.clip(dt, 0.0, 1.0))
    seg_idx = (dist_m // 5.0).astype(int)
    alt_m = df['alt_m'].to_numpy() if 'alt_m' in df.columns else np.zeros(len(df))

    enriched = pd.DataFrame({
        'segment_index': seg_idx,
        'distance_m': seg_idx * 5.0,
        'lat': df['lat'],
        'lon': df['lon'],
        'elevation_m': alt_m,
        'speed_mph': v_mps * 2.236936,
        'lon_g': ax_v / G_STD,
        'lat_g': ay_v / G_STD,
        'camber_deg': camber_deg,
        'crest_vertical_g': crest_g,
        'roughness_sq': rough_g ** 2,
        'engagement_score': engagement
    })

    grouped = enriched.groupby('segment_index', as_index=False).agg(
        distance_m=('distance_m', 'first'),
        lat=('lat', 'mean'),
        lon=('lon', 'mean'),
        elevation_m=('elevation_m', 'mean'),
        speed_mph=('speed_mph', 'mean'),
        lon_g=('lon_g', 'mean'),
        lat_g=('lat_g', 'mean'),
        camber_deg=('camber_deg', 'mean'),
        crest_vertical_g=('crest_vertical_g', 'mean'),
        roughness_rms=('roughness_sq', lambda x: float(np.sqrt(np.mean(x)))),
        engagement_score=('engagement_score', 'mean')
    )

    if len(grouped) > 1:
        d_elev = np.gradient(grouped['elevation_m'].to_numpy())
        d_dist = np.maximum(5.0, np.gradient(grouped['distance_m'].to_numpy()))
        grouped['grade_pct'] = np.clip((d_elev / d_dist) * 100.0, -35.0, 35.0)
    else:
        grouped['grade_pct'] = 0.0

    return grouped

def _read_csv_from_source(source_path: str, filename: str) -> pd.DataFrame:
    if zipfile.is_zipfile(source_path):
        with zipfile.ZipFile(source_path, 'r') as zf:
            with zf.open(filename) as f:
                return pd.read_csv(f)
    return pd.read_csv(os.path.join(source_path, filename))

def ingest_sensor_logger_drive(source_path: str):
    acc = _read_csv_from_source(source_path, 'Accelerometer.csv').sort_values('seconds_elapsed')
    grav = _read_csv_from_source(source_path, 'Gravity.csv').sort_values('seconds_elapsed')
    gyro = _read_csv_from_source(source_path, 'Gyroscope.csv').sort_values('seconds_elapsed')
    loc = _read_csv_from_source(source_path, 'Location.csv').sort_values('seconds_elapsed')
    baro = _read_csv_from_source(source_path, 'Barometer.csv').sort_values('seconds_elapsed')

    t = acc['seconds_elapsed'].to_numpy()
    gx = np.interp(t, gyro['seconds_elapsed'], gyro['x'])
    gy = np.interp(t, gyro['seconds_elapsed'], gyro['y'])
    gz = np.interp(t, gyro['seconds_elapsed'], gyro['z'])

    grav_x = np.interp(t, grav['seconds_elapsed'], grav['x'])
    grav_y = np.interp(t, grav['seconds_elapsed'], grav['y'])
    grav_z = np.interp(t, grav['seconds_elapsed'], grav['z'])

    # iOS CoreMotion proper acceleration f_proper = -(gravity + userAcceleration)
    f_static = -np.column_stack([grav_x, grav_y, grav_z])
    f_total = -(np.column_stack([grav_x, grav_y, grav_z]) + acc[['x', 'y', 'z']].to_numpy())
    w_vec = np.column_stack([gx, gy, gz])
    w_mag = np.linalg.norm(w_vec, axis=1)

    v_mps = np.interp(t, loc['seconds_elapsed'], np.clip(loc['speed'], 0.0, None))
    lat = np.interp(t, loc['seconds_elapsed'], loc['latitude'])
    lon = np.interp(t, loc['seconds_elapsed'], loc['longitude'])

    # Fuse initial GPS altitude with high-precision Barometer relativeAltitude for 3D elevation
    base_alt_m = float(loc['altitude'].iloc[:5].median())
    rel_alt_m = np.interp(t, baro['seconds_elapsed'], baro['relativeAltitude'])
    alt_m = base_alt_m + rel_alt_m

    dv_dt = np.gradient(v_mps, t)
    stat_mask = (v_mps < 0.3) & (w_mag < 0.05)
    pull_mask = (v_mps > 3.0) & (dv_dt > 0.8) & (w_mag < 0.08)

    R = compute_mount_rotation_matrix(f_static[stat_mask], f_total[pull_mask])

    dt_mean = float(np.median(np.diff(t)))
    fs_hz = round(1.0 / dt_mean, 1) if dt_mean > 0 else 100.0

    raw_df = pd.DataFrame({
        't_sec': t,
        'ax': f_total[:, 0],
        'ay': f_total[:, 1],
        'az': f_total[:, 2],
        'gx': gx,
        'gy': gy,
        'gz': gz,
        'v_mps': v_mps,
        'lat': lat,
        'lon': lon,
        'alt_m': alt_m
    })

    segments_5m = profile_drive_dataframe(raw_df, R, fs_hz=fs_hz)
    return raw_df, R, segments_5m
