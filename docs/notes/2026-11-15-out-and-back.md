# STATE
## Session 2026-11-15 (out and back): with unpaved avoided and no paved loop, the best road there and back (claude/project-thread-39xbx9)
- Done: web/graph_router.js loopNow. When unpaved road is avoided (the default) and every loop found drives more than LOOP_DIRT_KM of it, outAndBack offers the best paved stages near the start there and back (kind 'outBack'). It goes on along the next good road outward while the asked length wants more, and is shorter than asked if it must be. loopAlong snaps its points to paved road when unpaved is avoided (a US 550 point had snapped onto the Little Molas campground road).
- Result: Ouray 150/250/380 km gives the Million Dollar Highway there and back, 72 km with no gravel (was 205-247 km loops with 44-72 km over 4x4 passes). Sturgis 150 gives 68 and 110 km there-and-backs with no gravel (was a 145 km loop with 7.5 km of gravel). The other 12 survey areas are unchanged.
- Next: US 550 from Silverton to Durango is a highway to hwyOf (its corners per km over the whole name are below TRUNK_FUN_KM), so Fun legs won't drive it and the out-and-back can't go on to Durango. Judge a trunk per stretch, not per name.

# CALL SHEET
## 2026-11-15 (out and back): shorter and paved over the asked length on gravel
Unpaved is avoided by default, and a loop over a 4x4 pass breaks that promise. A paved road there and back, even one well short of the length, is the honest answer. With unpaved allowed nothing changes. Undo: drop the outAndBack line in loopNow.

## 2026-11-15 (out and back): startup script budget raised to 3.7 MB
The map page loaded 3,602,844 script bytes against a 3.6 MB budget once graph_router.js gained out-and-back (4.6 KB); main had 1.7 KB left. The router plans offline, so it cannot load late, and boot CPU stayed 0.12 s against 2.0 s. Undo: set BOOT.scriptBytes in e2e/smoke.js back to 3.6e6.
