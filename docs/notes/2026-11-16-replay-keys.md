# STATE

## The replay's keys on the map are one family (UI thread, 2026-11-16)
- In the main look, the three keys a replay floats over the map are now the same lifted pill, on paper, with no outline:
  - the drive's name ("Replay · Demo · Dry Ridge Rd ×")
  - Video
  - Jump to the corners
- Before, they were a square box with a hairline, a bare word, and an outlined pill.
- `web/index.html`, the `[data-theme="roadbook"]` rules for `#modePlate`, `#videoBtn` and `#jumpCorners`.

# CALL SHEET

## Replay map keys as pills
- What: `border-radius: var(--r-chip)`, `box-shadow: var(--elev-1)`, `border: 0` on the three, in the roadbook look only.
- Why: Nate (11-16) wants every screen cohesive, Apple-like. Three shapes for three keys side by side read as unfinished.
- Undo: restore the old `#videoBtn` rule (`border: 0; box-shadow: none; padding: 0 6px`) and the `#modePlate` box-shadow with no radius.
