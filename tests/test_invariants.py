import os
import numpy as np
import pandas as pd
import pytest
from scipy.spatial.transform import Rotation
from core.kinematics import (
    compute_mount_rotation_matrix,
    profile_drive_dataframe,
    ingest_sensor_logger_drive,
    G_STD,
)
from tests.synthetic import write_sensor_logger_export

# Raw Sensor Logger exports are large personal recordings and are not committed.
# Drop them in the repo root to run the real-drive invariants locally.
PEBBLE_ZIP = '10069_Pebble_Ridge_Ln-2026-10-24_19-06-33.zip'
DRY_ZIP = 'Dry_Ridge_Rd-2026-10-25_01-50-26.zip'

def test_crooked_mount_and_camber_recovery():
    true_R_veh_to_phone = Rotation.from_euler('xyz', [25, -15, 18], degrees=True).as_matrix()
    phone_static = np.tile([0.0, 0.0, G_STD], (500, 1)) @ true_R_veh_to_phone.T
    phone_pull = np.tile([0.35 * G_STD, 0.0, G_STD], (300, 1)) @ true_R_veh_to_phone.T

    solved_R = compute_mount_rotation_matrix(phone_static, phone_pull)
    np.testing.assert_allclose(solved_R @ solved_R.T, np.eye(3), atol=1e-6)
    np.testing.assert_allclose(solved_R, true_R_veh_to_phone.T, atol=1e-4)

    n = 1000
    t = np.linspace(0, 10, n)
    v_mps = np.full(n, 25.0)
    omega_z = np.full(n, 0.30)
    ay_veh = (v_mps * omega_z) - G_STD * np.sin(np.radians(6.0))
    phone_accel = np.column_stack([np.zeros(n), ay_veh, np.full(n, G_STD)]) @ true_R_veh_to_phone.T
    phone_gyro = np.column_stack([np.zeros(n), np.zeros(n), omega_z]) @ true_R_veh_to_phone.T

    df = pd.DataFrame({
        't_sec': t, 'ax': phone_accel[:, 0], 'ay': phone_accel[:, 1], 'az': phone_accel[:, 2],
        'gx': phone_gyro[:, 0], 'gy': phone_gyro[:, 1], 'gz': phone_gyro[:, 2],
        'v_mps': v_mps, 'lat': 39.1031 + t * 0.0001, 'lon': -84.5120 + t * 0.0001,
        'alt_m': 210.0 + t * 0.8
    })
    nodes = profile_drive_dataframe(df, solved_R, fs_hz=100.0)
    assert 5.8 <= nodes['camber_deg'].median() <= 6.2
    assert 'elevation_m' in nodes.columns
    assert 'grade_pct' in nodes.columns

def test_sensor_logger_ingestion_end_to_end(tmp_path):
    true_R_veh_to_phone = Rotation.from_euler('xyz', [-70, 10, 95], degrees=True).as_matrix()
    write_sensor_logger_export(str(tmp_path), true_R_veh_to_phone)
    raw_df, R, segments = ingest_sensor_logger_drive(str(tmp_path))

    np.testing.assert_allclose(R, true_R_veh_to_phone.T, atol=0.02)
    assert np.isclose(np.linalg.det(R), 1.0, atol=1e-6)
    # ~1.27 km cruise + pull -> 5 m bins, contiguous, flat & straight road
    assert 240 <= len(segments) <= 270
    assert set(np.diff(segments['segment_index'])) == {1}
    assert segments['camber_deg'].isna().all()        # straight: no cornering load, so camber is unknown, never 0.0
    assert np.abs(segments['lat_g']).max() < 0.02
    assert segments['vert_peak_g'].max() < 0.35
    assert 10.0 <= segments['elevation_m'].max() - segments['elevation_m'].min() <= 13.0


def test_real_sensor_logger_pebble_ridge_ingestion():
    if not os.path.exists(PEBBLE_ZIP):
        pytest.skip(f'raw log {PEBBLE_ZIP} not present')
    raw_df, R, segments = ingest_sensor_logger_drive(PEBBLE_ZIP)

    # Verify SO(3) orthogonality & right-handedness
    np.testing.assert_allclose(R @ R.T, np.eye(3), atol=1e-6)
    assert np.isclose(np.linalg.det(R), 1.0, atol=1e-6)

    # Verify 5m spatial binning & 3D elevation relief (>100m vertical relief in Pebble Ridge log)
    assert len(segments) > 3000
    elev_span = segments['elevation_m'].max() - segments['elevation_m'].min()
    assert elev_span > 100.0

def test_real_sensor_logger_dry_ridge_ingestion():
    if not os.path.exists(DRY_ZIP):
        pytest.skip(f'raw log {DRY_ZIP} not present')
    raw_df, R, segments = ingest_sensor_logger_drive(DRY_ZIP)
    np.testing.assert_allclose(R @ R.T, np.eye(3), atol=1e-6)
    assert np.isclose(np.linalg.det(R), 1.0, atol=1e-6)
    assert len(segments) > 10000
    elev_span = segments['elevation_m'].max() - segments['elevation_m'].min()
    assert elev_span > 110.0
