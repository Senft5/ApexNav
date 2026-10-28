# APEX NAV — UNIVERSAL AGENT CONTEXT & OPERATING RULES

## 1. Project Mission
ApexNav is a proprietary (all rights reserved, see LICENSE), zero-subscription spirited driving navigation and crowdsourced physical road-profiling platform for iOS (CarPlay) and Android (Android Auto). Instead of relying solely on 2D map geometry splines, ApexNav turns every driver's smartphone into a 100Hz Inertial Measurement Unit (IMU) probe to map how a road physically feels (true banking/camber, vertical crest unweighting, pavement roughness, and corner flow confidence) into 5.0-meter spatial micro-segments, while dynamically syncing audio DSP parameters to driver workload and look-ahead road geometry.

## 2. Core Architectural Pattern: Headless Core + Thin Shells
- **Headless Physics & DSP Core (`/core`)**: All 3D coordinate alignment, Kalman filtering, camber extraction, frequency separation (FFT/Butterworth), and audio parameter mapping MUST live in pure, platform-agnostic code (`/core/kinematics.py` for rapid prototyping and verification; `/core/cpp` for native mobile compilation).
- **Thin Platform Shells (`ApexNavApp.swift`, `/android-shell`)**: Native GUI layers (`SwiftUI`, `MapKit`, `CPMapTemplate`, `CoreMotion`, `CoreLocation`) are strictly for hardware sensor ingestion, 60fps vector rendering, and audio playback. Never bury untestable vehicle-dynamics math inside UI view controllers.
- **Strict Data Contracts (`/schemas/telemetry_contracts.json`)**: All data passed between the sensor pipeline, road-feel engine, map renderer, and audio engine must obey `/schemas/telemetry_contracts.json`.

## 3. Coordinate Frame & Unit Laws (ISO 8855 Vehicle Axes)
Regardless of how the phone is mounted in the cabin, all aligned chassis telemetry MUST strictly follow ISO 8855 in SI units internally:
- **+X**: Longitudinal Forward (Throttle = `+`, Braking = `-`) in `m/s^2`
- **+Y**: Lateral Left (Left turn centripetal = `+`, Right turn = `-`) in `m/s^2`
- **+Z**: Vertical Up (Static gravity on flat ground = `+9.80665 m/s^2`)
- **Angles & Angular Rates**: Strictly `radians` and `rad/s` inside math functions; convert to `degrees` only at final serialization or UI display.
- **Spatial Binning**: Roads are discretized into fixed `5.0 meter` arc-length micro-segments.

## 4. Closed-Loop Agent Verification Protocol
1. Before starting any task, read `/docs/STATE.md` and `/docs/ARCHITECTURE.md`.
2. After ANY edit to `/core` math or signal processing (or `web/apex_core.js`, its parity-tested port), run the deterministic CLI test suite:
   `pytest tests -v`
   After ANY edit to an inline `<script>` in `web/*.html`, run `python tools/csp.py` (Content-Security-Policy hashes; `tests/test_csp.py` fails otherwise). A new third-party host goes in `tools/csp.py` `CONNECT`.
   After ANY edit to live sensor math (`core/live_pipeline.py` or `ApexKit/`), regenerate the fixture with `python tools/make_live_fixture.py` and run `swift test --package-path ApexKit`.
3. Never ship placeholder or synthesized road data as if it were measured. Unknown stays unknown (`null`, `--`).
4. For iOS / CarPlay changes, verify `project.yml` and `.github/workflows/build.yml` remain valid for cloud `xcodegen` compilation.
5. For anything touching the iOS shell, sign-in, social features, data collection or the store listing, check `/docs/APP_REVIEW.md` (App Store Review Guidelines) and update it in the same PR.
6. Before concluding an agent session, update `/docs/STATE.md` with completed milestones, active bugs, and the exact next task.
