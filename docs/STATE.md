# APEX NAV — CURRENT AGENT HANDOFF STATE

## Completed Milestones
- [x] Single-file iOS SwiftUI + MapKit prototype (`ApexNavApp.swift`) with 3D pitched follow camera, destination search, random backroad loop generator, spoken pace notes, live 5m road-feel trail polyline painting, G-meter HUD, and CSV drive logger.
- [x] Automated GitHub Actions macOS `.ipa` build pipeline (`.github/workflows/build.yml` + `project.yml`).
- [x] Headless Python kinematics reference core (`/core/kinematics.py`) + invariant verification test suite (`/tests/test_invariants.py`).
- [x] Subsystem JSON schema contracts (`/schemas/telemetry_contracts.json`).

## Immediate Next Tasks for Active Agent
1. **Verify Cloud `.ipa` Build**: Ensure `git push` triggers `.github/workflows/build.yml` on GitHub Actions and outputs `ApexNav-IPA` artifact cleanly. Fix any Swift compiler warnings or `xcodegen` schema issues if the action fails.
2. **Ingest First Real Drive Log**: Drop the user's real-world drive CSV from `ApexNav` or `Sensor Logger` into `/tests/fixtures/` and build an ingestion adapter in `/core/kinematics.py` to auto-solve the mount rotation matrix $\mathbf{R}$ and plot the 5m road profile.
3. **Port Full 3D Rotation Calibration to Swift**: Replace the simplified scalar smoothing in `ApexNavApp.swift` (`zeroMountCalibration()`) with the full 3x3 orthogonal matrix solver from `/core/kinematics.py`.
4. **CarPlay Dashboard Extension**: Add a `WidgetKit` / `CPTemplateApplicationScene` target to `project.yml` for head-unit projection.
