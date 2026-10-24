# APEX NAV — SYSTEM ARCHITECTURE & MATH SPECIFICATION

## 1. 3D Phone Mount Auto-Alignment (`compute_mount_rotation_matrix`)
Phones are mounted at arbitrary pitch, roll, and yaw angles inside a vehicle. To transform raw phone-frame sensor vectors $\mathbf{a}_{\text{phone}}$ and $\boldsymbol{\omega}_{\text{phone}}$ into the ISO 8855 vehicle frame:
1. **Vertical Lock ($\hat{\mathbf{z}}_{\text{veh}}$)**: During stationary calibration ($v = 0, \|\boldsymbol{\omega}\| \approx 0$), the mean proper acceleration vector points directly along Earth's normal force ($+1g$ Up). Normalizing this vector defines $\hat{\mathbf{z}}_{\text{veh}}$ in phone coordinates.
2. **Forward Lock ($\hat{\mathbf{x}}_{\text{veh}}$)**: During a straight-line forward acceleration pull ($\omega_z \approx 0, \dot{v} > 0$), subtracting the static gravity vector and projecting onto the plane orthogonal to $\hat{\mathbf{z}}_{\text{veh}}$ yields $\hat{\mathbf{x}}_{\text{veh}}$.
3. **Lateral Lock ($\hat{\mathbf{y}}_{\text{veh}}$)**: Completed via right-handed cross product $\hat{\mathbf{y}}_{\text{veh}} = \hat{\mathbf{z}}_{\text{veh}} \times \hat{\mathbf{x}}_{\text{veh}}$.
4. **Real-Time Rotation**: Stacking $[\hat{\mathbf{x}}_{\text{veh}}, \hat{\mathbf{y}}_{\text{veh}}, \hat{\mathbf{z}}_{\text{veh}}]$ as rows forms the orthogonal rotation matrix $\mathbf{R} \in SO(3)$ applied to every 100Hz sample: $\mathbf{v}_{\text{veh}} = \mathbf{R}\,\mathbf{v}_{\text{phone}}$.

## 2. Physical Road Profiling (Decoupling Car/Driver from Asphalt)
- **True Camber / Banking Extraction ($\phi$)**: Compares kinematic centripetal acceleration ($v \cdot \omega_z$) against measured lateral accelerometer load ($a_{y,\text{veh}}$):
  $$a_{y,\text{veh}} = v \cdot \omega_z \cos(\phi) - g \sin(\phi)$$
  Positive banking ($\phi > 0$) reduces lateral acceleration felt inside the cabin relative to flat-road kinematics; off-camber corners ($\phi < 0$) increase it. Because velocity scales $v \cdot \omega_z$ directly, $\phi$ is invariant to how fast different users drive the corner.
- **Vertical Frequency Separation**:
  - **Low-Pass (< 1.0 Hz)**: Isolates road elevation compression (dips) and unweighting over blind crests where tire normal load drops.
  - **High-Pass (> 8.0 Hz)**: Isolates pavement roughness, washboard ripples, and mid-corner expansion joints (computed as RMS energy per 5m slice).
- **Confidence & Flow Index**: Compares entry-to-apex speed stability and mid-corner braking ($a_x < 0$) against geometric curve radius to flag blind/decreasing-radius hazards vs. high-flow sweepers.

## 3. Dynamic Audio DSP Bus
Maps a normalized **Driver Engagement Score** (0.0 to 1.0, derived from combined horizontal G-load $\sqrt{a_x^2 + a_y^2}$ and yaw jerk $\dot{\omega}_z$) plus a **400-meter look-ahead horizon** from the 5m road mesh to control real-time audio filters, stem crossfades, and musical build-ups timed to corner entry apexes.

## 4. iOS & CarPlay Deployment Pipeline
- **Cloud Unsigned `.ipa` Builder**: `.github/workflows/build.yml` uses `xcodegen` (`project.yml`) on `macos-15` runners to compile `ApexNav.ipa` for USB sideloading (Sideloadly / iloader).
- **CarPlay Head-Unit Path**: Uses `WidgetKit` / `LiveActivity` for un-gated CarPlay Dashboard telemetry cards on free sideloaded builds, and `CPMapTemplate` (`com.apple.developer.carplay-maps`) for full head-unit vector map projection.
