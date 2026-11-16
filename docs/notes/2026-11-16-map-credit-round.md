# STATE

## The map's credit key is round (UI thread, 2026-11-16)
- In the Roadbook look, the map's "i" credit key was a square ink-ruled box, the last one on the map once the toasts were rounded (#1022). It is now a small lifted round plate (radius 12, `--elev-1`, no outline), still a 44 pt key. `web/system.css`; the design pass 2 e2e check follows it.

# CALL SHEET

## Round credit key in the main look
- What: `#map .maplibregl-ctrl-attrib.maplibregl-compact` loses its 1.5 px ink border and gets radius 12 and the lift, in the Roadbook look only. Other looks keep the square plate.
- Why: everything else floating on the map is round and lifted; a square box drew the eye.
- Undo: delete the two `maplibregl-ctrl-attrib` rules at the foot of `web/system.css` and restore the e2e check's `radius === '0px'`.
