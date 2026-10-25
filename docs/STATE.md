# APEX NAV — CURRENT AGENT HANDOFF STATE

## Completed Milestones
- [x] **Co-Driver Voice & Event Extraction Overhaul (`tools/export_web_profile.py`, `web/index.html`, `ApexNavApp.swift`)**:
  - Removed the 60fps `leadRough > 0.068` auto-relay loop and excessive pothole triggers that previously spammed pothole alerts every few seconds and cut off speech mid-sentence.
  - Enforced non-interrupting speech queuing (`AVSpeechSynthesizer` on iOS and `speechSynthesis` in browser) with a strict 7.0-second spacing between automatic pace notes, and re-exported `dry_ridge.js` (`66` clean corner/hazard events across `57.25 km`) and `pebble_ridge.js` (`36` clean corner/hazard events across `28.50 km`).
- [x] **Real Destination Routing & Closed-Loop B-Road Generator (`web/index.html`)**:
  - Added **Route / Loop** navigation sheet supporting:
    1. **Destination Search & Map-Tap Routing**: Search any address/city via OpenStreetMap Nominatim or tap any road on the map to compute a real road route via OSRM (`router.project-osrm.org`), automatically extracting turn angles into live Rally Co-Driver Pace Notes (`L1`–`R6`) and target apex speeds.
    2. **Dynamic B-Road Loop Builder**: Generate `15 mi`, `28 mi`, or `45 mi` closed loops from the current position, or launch verified closed-loop stages (**Miami Whitewater Loop** and **Pebble Ridge Valley Crest Loop**).
- [x] **Responsive Instrument UI Overhaul (`web/index.html`)**:
  - Replaced the 22 cramped boxes and cut-off mobile grids with a clean, responsive layout verified at both `390×844` (iPhone portrait) and `1440×900` (Desktop).
- [x] **Headless Python Kinematics Core & Invariant Suite**: `pytest tests/test_invariants.py -v` passing 100% (3/3 tests).

## Immediate Next Tasks for Active Agent
1. **Live DeFlock / OpenStreetMap ALPR Sync**: Connect a live background fetcher to pull regional `man_made=surveillance` / `surveillance:type=ALPR` nodes into the local stage cache.
2. **CarPlay `CPMapTemplate` Instrument Extension**: Project the Co-Driver Pace-Note banner and Stage DNA ribbon onto the vehicle head-unit display.
