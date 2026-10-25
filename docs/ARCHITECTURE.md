# APEX NAV — SYSTEM ARCHITECTURE & MATH SPECIFICATION

## 1. 3D Phone Mount Auto-Alignment (`compute_mount_rotation_matrix`)
Phones are mounted at arbitrary pitch, roll, and yaw angles inside a vehicle. To transform raw phone-frame sensor vectors $\mathbf{a}_{\text{phone}}$ and $\boldsymbol{\omega}_{\text{phone}}$ into the ISO 8855 vehicle frame:
1. **Vertical Lock ($\hat{\mathbf{z}}_{\text{veh}}$)**: During stationary calibration ($v = 0, \|\boldsymbol{\omega}\| \approx 0$), the mean proper acceleration vector points directly along Earth's normal force ($+1g$ Up). Normalizing this vector defines $\hat{\mathbf{z}}_{\text{veh}}$ in phone coordinates.
2. **Forward Lock ($\hat{\mathbf{x}}_{\text{veh}}$)**: During a straight-line forward acceleration pull ($\omega_z \approx 0, \dot{v} > 0$), subtracting the static gravity vector and projecting onto the plane orthogonal to $\hat{\mathbf{z}}_{\text{veh}}$ yields $\hat{\mathbf{x}}_{\text{veh}}$.
3. **Lateral Lock ($\hat{\mathbf{y}}_{\text{veh}}$)**: Completed via right-handed cross product $\hat{\mathbf{y}}_{\text{veh}} = \hat{\mathbf{z}}_{\text{veh}} \times \hat{\mathbf{x}}_{\text{veh}}$.
4. **Real-Time Rotation**: Stacking $[\hat{\mathbf{x}}_{\text{veh}}, \hat{\mathbf{y}}_{\text{veh}}, \hat{\mathbf{z}}_{\text{veh}}]$ as rows forms the orthogonal rotation matrix $\mathbf{R} \in SO(3)$ applied to every 100Hz sample: $\mathbf{v}_{\text{veh}} = \mathbf{R}\,\mathbf{v}_{\text{phone}}$.

## 2. Physical Road Profiling (Decoupling Car/Driver from Asphalt)
- **True Camber / Banking Extraction ($\phi$)** — stored *turn-relative* (`camber_deg` + = banked into the corner, − = off-camber; only observable while cornering, bins on straights read 0): Compares kinematic centripetal acceleration ($v \cdot \omega_z$) against measured lateral accelerometer load ($a_{y,\text{veh}}$):
  $$a_{y,\text{veh}} = v \cdot \omega_z \cos(\phi) - g \sin(\phi)$$
  Positive banking ($\phi > 0$) reduces lateral acceleration felt inside the cabin relative to flat-road kinematics; off-camber corners ($\phi < 0$) increase it. Because velocity scales $v \cdot \omega_z$ directly, $\phi$ is invariant to how fast different users drive the corner.
- **Vertical Frequency Separation**:
  - **Low-Pass (< 1.0 Hz)**: Isolates road elevation compression (dips) and unweighting over blind crests where tire normal load drops.
  - **High-Pass (> 8.0 Hz)**: Isolates pavement roughness, washboard ripples, and mid-corner expansion joints (computed as RMS energy per 5m slice).
- **Confidence & Flow Index**: Compares entry-to-apex speed stability and mid-corner braking ($a_x < 0$) against geometric curve radius to flag blind/decreasing-radius hazards vs. high-flow sweepers.

## 3. Road DNA Engine (`core/road_dna.py`, ported to `web/apex_core.js`)
The JS file is a line-for-line port used by the browser/iOS cockpit for live OSRM routes; `tests/test_web_core_parity.py` runs both on the same input (synthetic + a real logged drive) and requires identical results. Change both or neither.
- **Curvature**: lat/lon → local metres → 25 m moving average → heading $\psi$ (unwrapped) → $\kappa = d\psi/ds$, smoothed again. Signed per ISO 8855: $\kappa > 0$ = left. Path ends are zeroed (one-sided differences turn GPS noise into phantom corners).
- **Corners / pace notes**: runs of $|\kappa| > 1/300$ m⁻¹ of one sign (gaps ≤ 3 samples merge), total turn ≥ 20°. Radius = 1 / mean $|\kappa|$ over ±2 samples of the apex (errs tight under noise). Severity by radius: 1 < 25 m, 2 < 40, 3 < 65, 4 < 100, 5 < 160, 6 < 260, else not called; hairpin = turn ≥ 135° and R < 30 m; R < 8 m is GPS jitter and dropped. Modifiers: `tightens`/`opens` (half-corner radius ratio < 0.7), `long` (≥ 100°), `banked`/`off-camber` (±2°), `over crest` (crest < −0.08 g).
- **Apex speed**: $v = \sqrt{R\,g\,(\mu_{\text{eff}} + \tan\phi)}$ with $\mu_{\text{eff}} = 0.60$ derated up to 30 % on rough pavement (5 m RMS 0.08 → 0.38 g).
- **Braking envelope** (`target_mph`, the PACE bug and the speed-aware ribbon): local apex limit per sample, capped at 31.3 m/s (70 mph), then a backward pass $v_i \le \sqrt{v_{i+1}^2 + 2\,a\,ds}$ with $a = 0.5g$. Ribbon: vermilion where current speed > envelope + 0.5 m/s, amber within 3 m/s.
- **Hazards** (recorded drives only): bump = per-bin peak > 0.35 g (or 5 m RMS > 0.25 g for older exports without a peak), crest < −0.08 g, dip > +0.10 g; clusters ≥ 150 m apart.
- **Stage DNA** per 500 m sector, 0–100: TECH (corner density, $\sigma(\kappa)$, tight corners/hairpins, grade variation), FLOW (speed continuity, sweeper share, banked share), SURF (mean roughness, hazard count), CLEAR (−45 per OSM ALPR camera within 60 m; **null when no ALPR data** — unknown is never shown as clear).

## 3b. Reference Lap, Live Pipeline, Analysis
- `core/reference_lap.py` — simulated sane driver per car profile; all TECH/FLOW features and archetypes are read from it (docs/ROAD_INTELLIGENCE.md).
- `core/live_pipeline.py` — causal 100 Hz pipeline the phone runs; Swift `ApexKit` is held to it by a generated fixture.
- `core/drive_analysis.py` — private corner-by-corner pass comparison; JS port in `web/apex_core.js`.
- Web shell: `web/index.html` (cockpit), `web/analysis.html`, `web/themes.js` (theme registry), `web/instruments.js` (renderers).

## 4. Data Honesty
Everything the cockpit shows is measured, derived from measurements, or fetched from a named open source (OSM/DeFlock ALPR via Overpass, OSRM, Nominatim). Geometry-only routes are labelled `SIM · NOT DRIVEN` and show `--` for anything that needs an IMU. A failed ALPR fetch says so instead of implying no cameras.

## 5. Dynamic Audio DSP Bus
Maps a normalized **Driver Engagement Score** (0.0 to 1.0, derived from combined horizontal G-load $\sqrt{a_x^2 + a_y^2}$ and yaw jerk $\dot{\omega}_z$) plus a **400-meter look-ahead horizon** from the 5m road mesh to control real-time audio filters, stem crossfades, and musical build-ups timed to corner entry apexes.

## 6. iOS & CarPlay Deployment Pipeline
- **Cloud Unsigned `.ipa` Builder**: `.github/workflows/build.yml` uses `xcodegen` (`project.yml`) on `macos-15` runners to compile `ApexNav.ipa` for USB sideloading (Sideloadly / iloader).
- **CarPlay Head-Unit Path**: Uses `WidgetKit` / `LiveActivity` for un-gated CarPlay Dashboard telemetry cards on free sideloaded builds, and `CPMapTemplate` (`com.apple.developer.carplay-maps`) for full head-unit vector map projection.
