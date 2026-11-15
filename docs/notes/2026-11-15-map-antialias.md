# STATE
## Session 2026-11-15 (3D map aliasing): the tilted map draws with multisampling (claude/project-thread-ww1b81)
- Nate saw aliasing in the 3D view on TestFlight. The main map (`web/cockpit.js`) and the web car map (`web/carmap.js`)
  are pitched, but were made without `antialias`, so MapLibre's WebGL context had no MSAA: building extrusions, the 3D
  terrain mesh and other polygon edges stair-stepped (worst in a drive, where the canvas is capped at 2x). Both maps now
  turn it on when the GPU is real (`MAP_MSAA`: a WebGL probe; SwiftShader/llvmpipe, as in headless e2e, stays off,
  since software MSAA pushed the e2e plan-timing checks past 700 ms). Reproduced in headless Chromium (Cincinnati, pitch 60, with and without terrain): staircase
  edges before, smooth after.
- The slower frames exposed a race in the end-card e2e flow: the place plate's boot-time lookup, failing, emptied a plate
  that already had text. `fill()` in `web/cockpit.js` now leaves the plate as it was when nothing came back (a dropped
  signal no longer blanks the town and weather).
- Not covered: the CarPlay native map (`CarPlay/ApexCarMap.swift`, MapLibre Native) and the shimmer of far-off detail
  draped on 3D terrain (MapLibre's terrain textures have no mipmaps); look there next if Nate still sees it.

# CALL SHEET
## 2026-11-15 (3D map aliasing): MSAA on for the tilted maps (claude/project-thread-ww1b81)
Antialiasing costs some GPU memory and fill (4x samples), cheap on Apple's tile-based GPUs; the low-power and drive
pixel-ratio caps still apply. Undo: drop `antialias` and the probe (`MAP_MSAA` in cockpit.js, `msaa` in carmap.js).
