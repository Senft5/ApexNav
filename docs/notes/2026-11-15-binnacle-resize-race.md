# STATE

## 2026-11-15: the drive screen flow's resize race on CI
- On #900 (a router-only change), "the drive screen, Vetta Line" failed once at 320x568 with "the cluster whole on screen: fits false (px 104)". It passed on its re-run.
- Cause: the flow resizes the viewport (852x393 to 320x568) and judges the binnacle after a fixed 300 ms. The layout settles through ResizeObservers, such as the strip's height into `--notes-h` (cockpit.js). Those run on the next frames, and on a loaded runner a frame can come after 300 ms.
- Fix: after the 300 ms, the flow waits up to 3 s for the panel to settle (nothing overprints, the cluster fits), then judges it with the same checks. A real overflow still fails.

# CALL SHEET

## 2026-11-15: the binnacle shapes wait for the layout to settle
- What: e2e/smoke.js polls the same `boxes()` measure for up to 3 s after each viewport change.
- Why: the app converges through ResizeObservers, and a fixed 300 ms sleep raced them on a busy runner.
- Undo: remove the `waitForFunction` line in that loop.
