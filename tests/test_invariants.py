import numpy as np
import pandas as pd
from scipy.spatial.transform import Rotation
from core.kinematics import compute_mount_rotation_matrix, profile_drive_dataframe, G_STD

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
        'v_mps': v_mps, 'lat': 39.1031 + t * 0.0001, 'lon': -84.5120 + t * 0.0001
    })
    nodes = profile_drive_dataframe(df, solved_R, fs_hz=100.0)
    assert 5.8 <= nodes['camber_deg'].median() <= 6.2
