# VETTA — UNIVERSAL AGENT CONTEXT & OPERATING RULES

## 1. Project Mission
Vetta (the product name since 2026-10-28; the repo, bundle id, `apexnav://` scheme and code keep the working name ApexNav) is a proprietary (all rights reserved, see LICENSE) co-driver for spirited driving on public roads, for iOS and CarPlay: it finds good roads, reads the road ahead as rally pace notes, scores how cleanly you drove it, and keeps a shared road book with your friends. It turns the driver's phone into a 100 Hz IMU probe to measure how a road physically feels (banking/camber, crest unweighting, pavement roughness) in 5.0-metre micro-segments, shared anonymously. It is free to drive: driving, notes, routes, safety, privacy controls, your drives and your exports never sit behind a paywall; Vetta Pro is optional (what it holds: `docs/MONETIZATION.md`, `web/pro.js`, `tests/test_pro.py`). Product principles and what was dropped from the old manifesto: `/docs/PHILOSOPHY.md`. Look and words: `/docs/BRAND.md`.

## 2. Core Architectural Pattern: Pure Core + Web Cockpit + Native Shells (what is actually built)
- **Pure math core (`/core`, Python)**: mount alignment, camber extraction, Butterworth frequency separation (`core/kinematics.py`, offline), the streaming live pipeline (`core/live_pipeline.py`), Road DNA and drive scoring. It is the reference: `web/apex_core.js` / `web/live_pipeline.js` (JS) and `ApexKit/` (Swift) are parity-tested ports. Change the reference and its ports together.
- **Web cockpit (`/web`)**: the whole app UI in plain JS, the same page on the website and inside the iOS app's WKWebView. Keep vehicle-dynamics math in the pure modules (`apex_core.js`, `live_pipeline.js`, small pure files with tests), never inside `cockpit.js` UI code.
- **Native shells**: `ApexNavApp.swift` (iOS: CoreMotion, CoreLocation, audio, sign-in, StoreKit, the WKWebView), `CarPlay/` (CarPlay templates and a MapLibre Native car map), `ApexKit/` (Swift sensor pipeline). Shells ingest sensors, render and play audio; they do not invent road data.
- **Backend**: a Cloudflare Worker + D1 (`/backend`, `docs/BACKEND.md`).
- **Not built (do not describe as existing)**: a C++ core, an Android app or Android Auto, a Kalman filter, FFT analysis. They are ideas, not architecture.
- **Audio bus (built 2026-11-10, the Soundtrack)**: `core/audio_bus.py` and its parity-tested port `web/audio_bus.js` turn the road ahead and the driver's workload (calibrated g, speed, corners within 400 m, Sight, the co-driver speaking) into an `AudioBusFrame` (schemas/telemetry_contracts.json); `web/soundtrack.js` plays it. Unknown inputs give no workload, and the music rests on its pad.
- **Strict Data Contracts (`/schemas/telemetry_contracts.json`)**: data passed between the sensor pipeline, road-feel engine, map renderer and audio must obey `/schemas/telemetry_contracts.json`.

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
6. Make the judgment calls yourself instead of asking, and log each one at the top of `/docs/CALL_SHEET.md` (what, why, how to undo). Money, legal and account actions stay with the owner (`/docs/OWNER_TODO.md`).
7. Before concluding an agent session, update `/docs/STATE.md` with completed milestones, active bugs, and the exact next task.
