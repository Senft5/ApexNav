# APEX NAV — SYSTEM ARCHITECTURE & MATH SPECIFICATION

## 1. 3D Phone Mount Auto-Alignment (`compute_mount_rotation_matrix`)
Phones are mounted at arbitrary pitch, roll, and yaw angles inside a vehicle. To transform raw phone-frame sensor vectors $\mathbf{a}_{\text{phone}}$ and $\boldsymbol{\omega}_{\text{phone}}$ into the ISO 8855 vehicle frame:
1. **Vertical Lock ($\hat{\mathbf{z}}_{\text{veh}}$)**: During stationary calibration ($v = 0, \|\boldsymbol{\omega}\| \approx 0$), the mean proper acceleration vector points directly along Earth's normal force ($+1g$ Up). Normalizing this vector defines $\hat{\mathbf{z}}_{\text{veh}}$ in phone coordinates.
2. **Forward Lock ($\hat{\mathbf{x}}_{\text{veh}}$)**: During a straight-line forward acceleration pull ($\omega_z \approx 0, \dot{v} > 0$), subtracting the static gravity vector and projecting onto the plane orthogonal to $\hat{\mathbf{z}}_{\text{veh}}$ yields $\hat{\mathbf{x}}_{\text{veh}}$.
3. **Lateral Lock ($\hat{\mathbf{y}}_{\text{veh}}$)**: Completed via right-handed cross product $\hat{\mathbf{y}}_{\text{veh}} = \hat{\mathbf{z}}_{\text{veh}} \times \hat{\mathbf{x}}_{\text{veh}}$.
4. **Real-Time Rotation**: Stacking $[\hat{\mathbf{x}}_{\text{veh}}, \hat{\mathbf{y}}_{\text{veh}}, \hat{\mathbf{z}}_{\text{veh}}]$ as rows forms the orthogonal rotation matrix $\mathbf{R} \in SO(3)$ applied to every 100Hz sample: $\mathbf{v}_{\text{veh}} = \mathbf{R}\,\mathbf{v}_{\text{phone}}$.

The above is the offline batch solve for a recorded drive. **On the phone the calibration is automatic and continuous** (`core/live_pipeline.MountCalibrator`, mirrored by `ApexKit.MountCalibrator`; no tap, no special manoeuvre), with three states sent in every live frame as `calibration`:
- `default`: no trusted rotation (app start, phone handheld, phone being moved). Camber and crest are recorded and shared as unknown.
- `awaitingPull`: vertical known. Once CoreMotion gravity has held still in the phone for 2 s (fast vs slow gravity < 3°, low-passed rotation off the vertical < 0.15 rad/s; rotation about the vertical is the car yawing), $\hat{\mathbf{z}}_{\text{veh}} = -\text{mean}(\mathbf{g})$ over that window. While mounted it follows slow trim (τ = 30 s).
- `locked`: forward known. Over each GPS speed interval (closed at the next speed change after ≥ 0.8 s, or 3 s) the mean horizontal acceleration $\bar{\mathbf{h}}$ is compared with GPS $\dot v$ on straights ($|v\omega_z| < 0.7$, $|\dot v| \ge 0.5$ m/s²: evidence $\bar{\mathbf{h}}\dot v T$, so braking counts with its sign) and with $v\omega_z$ in turns ($|\dot v| < 0.5$, $|v\omega_z| \ge 1$: evidence $(\bar{\mathbf{h}} \times \hat{\mathbf{z}})\,v\omega_z T$, since centripetal load points along $+\hat{\mathbf{y}}$ and $\hat{\mathbf{y}} \times \hat{\mathbf{z}} = \hat{\mathbf{x}}$). Weights $a_{ref}^2 T$, decay τ = 90 s, speed ≥ 3 m/s, |a| ≤ 8 m/s² (a GPS jump is not evidence). Lock and keep refining when ≥ 3 samples, weight ≥ 6 and consistency $|\mathbf{A}_h| / W \ge 0.7$.
- **Moved phone**: vertical off by > 15° or rotation off the vertical > 0.5 rad/s for 0.5 s drops to `default` (mounting after the drive starts, remounting mid-drive, picking it up). A phone turned about the vertical, invisible to gravity, is caught when 3+ consecutive evidence samples (weight ≥ 6) disagree with $\hat{\mathbf{x}}$ by > 45°, or consistency falls below 0.3: back to `awaitingPull` and relearned.
- A mount saved from an earlier drive is reused only if the settled vertical matches it within 8°.

Camber and crest are recorded and shared only while `locked`. The phone's crest is signed vertical g (− = going light); a shared bin carries its peak unweighting, max(0, −min(crest)) capped at 3 g, and the server's `crest_peak` is the mean over the passes that measured it (`crest_n`, migration 0006). Dips (+) stay on the phone for now.

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
- `core/drive_analysis.py` — private corner-by-corner pass comparison, Driver Score (0–1000) and custom
  segment passes; JS port in `web/apex_core.js` (plus `profileRecording` for app CSVs), parity-tested.
- Corner coach (`corner_phases`, `coach`; JS `cornerPhases`, `coach`): per corner, on 5 m bins, its own brake zone (the
  braking run, a_lon < -0.15 g, nearest the apex within 200 m, ignored when it ended more than 100 m before turn-in),
  trail braking (m of that run with |a_lat| >= 0.20 g), coasting (m with |a_lon| < 0.05 g from the brake point to the
  throttle point), the throttle point (first a_lon > 0.05 g from the slowest point, m from the apex) and braking after the
  apex. Each corner is matched by location in the person's other drives (same matcher as `compare`) and each other pass is
  timed over exactly this drive's stretch (`aligned_time_s`: every bin projected onto the other path, median sub-bin
  offset, fractional ends), so GPS jitter and a window one bin off do not read as time. The quickest clean pass is the
  reference, except a pass whose slowest point is over the sane corner limit (envelope use > 1.0), which never counts.
  Gains under 0.2 s are alignment noise and ignored; the rest rank "Where to find time" and sum to the ideal drive. One tip
  per corner: slower at the slowest point (>= 0.9 m/s), brake point earlier (>= 10 m), throttle later (>= 10 m), more
  coasting (>= 15 m); with no quicker pass, braking after the apex (>= 0.25 g), coasting after braking (>= 20 m) or a
  slowest point >= 15 m before an apex driven >= 0.3 m/s faster. Corners through a stop (< 2.5 m/s), blank speed, or
  unmeasured g (`g_known`) anywhere from 200 m before the apex to 100 m after the exit are left out.
- Friction circle (`gg_envelope`, `grip_use`; JS `ggEnvelope`, `gripUse`): the driver's own g-g envelope from one drive,
  16 slices of 22.5° centred on 0° = throttle, 90° = left, 180° = braking, 270° = right (so straight braking and steady
  cornering sit mid-slice), each slice's radius the nearest-rank 95th percentile of combined g (one pothole jolt does not
  set it), samples under 0.05 g (cruising) and unmeasured g left out, a slice with fewer than 8 samples unknown. Grip use
  over a stretch = mean of combined g / that slice's radius (capped at 1.5, shown capped at 100 %) over samples of at least
  0.15 g. The drive view draws it as the Grip circle; scrubbing into a corner shows its trace and grip use from 100 m
  before turn-in to the exit.
- Web shell: `web/index.html` (cockpit), `web/analysis.html` (history / segments / compare), `web/themes.js` (theme registry), `web/instruments.js` (renderers).

## 3c. Fun routing (`web/fun_route.js`)
Destination routes are chosen for fun within a time budget (Quick / Fun / Max fun): the router's route and alternates plus 1–2 corridor stage detours timed with one Valhalla matrix call, scored on map geometry (junction turns removed) and ranked by fun and corners gained against extra minutes. Details, weights and what was checked: docs/ROUTING.md.

## 4. Data Honesty
Everything the cockpit shows is measured, derived from measurements, or fetched from a named open source (OSM/DeFlock ALPR via Overpass, OSRM, Nominatim). Geometry-only routes are labelled `SIM · NOT DRIVEN` and show `--` for anything that needs an IMU. A failed ALPR fetch says so instead of implying no cameras.

## 5. Dynamic Audio DSP Bus
Maps a normalized **Driver Engagement Score** (0.0 to 1.0, derived from combined horizontal G-load $\sqrt{a_x^2 + a_y^2}$ and yaw jerk $\dot{\omega}_z$) plus a **400-meter look-ahead horizon** from the 5m road mesh to control real-time audio filters, stem crossfades, and musical build-ups timed to corner entry apexes.

## 6. iOS & CarPlay Deployment Pipeline
- **Cloud Unsigned `.ipa` Builder**: `.github/workflows/build.yml` uses `xcodegen` (`project.yml`) on `macos-15` runners to compile `ApexNav.ipa` for USB sideloading (Sideloadly / iloader).
- **CarPlay Head-Unit Path**: Uses `WidgetKit` / `LiveActivity` for un-gated CarPlay Dashboard telemetry cards on free sideloaded builds, and `CPMapTemplate` (`com.apple.developer.carplay-maps`) for full head-unit vector map projection.

## 7. App-open road learning and live convoy hazards (design draft, 2026-10-26)

Reviewer transport decision: see CONVOY_TRANSPORT.md. First isolated build uses the small
authenticated DO WebSocket relay fallback; WebRTC preference remains a future option.
Live event/path anchors stay memory-only, and actor reset forces a fresh epoch/rejoin rather
than restoring location history. This is a local implementation plan, not shipped behavior.

Status: requirements and proposed boundaries, NOT implemented or device-validated.
Road-1..4 and convoy-1..3 are coequal; convoy delivery must not wait for road-profile completion.
This reprioritization performs no merge or production deployment.

### Shared foreground acquisition, independent consumers
- One sensor owner per foreground app session; page navigation must not duplicate or destroy it.
  Personal recording, anonymous road learning and an explicitly joined convoy are separate consumers.
  Start/End drive changes personal recording only. Each sharing consumer has its own consent/state.
- Native IMU-derived observations retain source, calibration, availability, units and quality.
  GPS-only web data never becomes invented banking, roughness or vertical evidence.
  Keep unsupported measurements null; detection/filter math stays in headless core with parity tests.
- Anonymous learning branches through privacy filtering and direction-aware map matching into a
  bounded durable retry queue. Advance uploaded-distance UI only on a genuine server acknowledgment.
  Account/session identity and precise trip shape must not enter public aggregate profiles.
- Convoy observations branch immediately into a session-only provisional event stream, bypassing
  road upload batching, rewards, long-term storage and multi-pass hazard corroboration.
  A detected bump is not proof of a pothole; use provisional warning language until validated.

### Small convoy vertical slice and proposed contract
- Create -> invite/code -> authenticated join -> visible leader/follower state -> leave/revoke.
  Reuse authentication, not permanent Crew membership as implicit location-sharing consent.
- Versioned messages need random session/event IDs, authorized sender/leader epoch, sequence,
  observation time, server-bounded expiry, hazard type, evidence/source/quality and path anchor.
  Path anchor includes road/direction/progress and uncertainty; precise event/participant location
  is session-scoped and ephemeral, never written into road profiles or routine request logs.
- Publish the provisional hazard immediately. Three-second Cancel sends a retraction referring
  to the same event ID; it is never a timer before initial transmission. Retraction tombstones
  survive the event's replay lifetime so reconnect cannot resurrect cancelled warnings.
- Speak once per follower/event only while still valid and ahead on the follower's compatible
  path and direction. Proximity alone is insufficient for parallel/opposite roads or a passed event.
  Unknown/stale position must not masquerade as known relevance. Retain distinct hazard IDs.
- Server enforces joined-session authorization on transport and every event, rejects forged leader
  messages and closes/revokes streams on leave/removal/session expiry. Reconnect cannot regain
  revoked access or replay expired events. Do not persist live participant movement history.
- UI exposes leader, joined/connecting/reconnecting/offline, sensor permission/calibration and
  audio-disabled/interrupted states. Hazard speech preempts ordinary notes through the shared
  speech arbiter, with an immediate visual cue; no promise of delivery while disconnected.

### Latency target and evidence, not a shipped guarantee
- Initial connected/foreground acceptance target: p95 <= 1.5 seconds from detector emission to
  follower speech START, including speech arbitration. Detector window/group delay is measured
  separately from physical impact to emission. Target requires validation; no measurements yet.
- Instrument detector emission, leader enqueue/send, server receipt/fanout, follower receipt,
  relevance decision, speech request and actual audio start. Never label queueing as audible speech.
  Use local monotonic stage timings; raw monotonic clocks on different phones are not comparable.
  Isolated multi-client harness uses one reference clock; physical checks require synchronized
  recordings or a documented clock-offset/error bound and report percentiles, losses and reconnects.
- Tests cover one leader/multiple followers, relevant/ahead vs opposite/parallel/passed paths,
  duplicates, expiry, stale reconnect replay, retraction races, leave/revocation, missing permissions,
  speech interruption and Start/End recording with sharing still active. Synthetic events are
  isolated test/preview data only; real-phone acceptance is a separate, explicitly recorded result.

### Existing gaps confirmed by initial road audit
- Contribution payload is outside telemetry contracts; full source/confidence/grade/hazard evidence
  is not carried end to end. Curvature can become zero when missing and is not aggregated in readback.
- Current SQL catch-all can acknowledge failed ingestion as a duplicate; retry safety needs explicit
  conflict verification and isolated failure tests before an upload is considered acknowledged.
- Crest aggregation/count semantics and corroboration need a versioned, null-preserving design.
  Current measured routing is a small roughness adjustment after loop generation, not character-aware
  destination/loop/traffic candidate discovery. Preserve honest geometry fallback while fixing this.
