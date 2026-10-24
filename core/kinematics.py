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
    dist_m = np.cumsum(v_mps * dt)
    seg_idx = (dist_m // 5.0).astype(int)

    enriched = pd.DataFrame({
        'segment_index': seg_idx,
        'distance_m': seg_idx * 5.0,
        'lat': df['lat'],
        'lon': df['lon'],
        'camber_deg': camber_deg,
        'crest_vertical_g': crest_g,
        'roughness_sq': rough_g ** 2,
        'engagement_score': engagement
    })

    return enriched.groupby('segment_index', as_index=False).agg(
        distance_m=('distance_m', 'first'),
        lat=('lat', 'mean'),
        lon=('lon', 'mean'),
        camber_deg=('camber_deg', 'mean'),
        crest_vertical_g=('crest_vertical_g', 'mean'),
        roughness_rms=('roughness_sq', lambda x: np.sqrt(np.mean(x))),
        engagement_score=('engagement_score', 'mean')
    )
