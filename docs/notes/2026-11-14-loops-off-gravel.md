# STATE
## Session 2026-11-14 (loops off gravel): loops keep off unpaved road when it's avoided (claude/project-thread-39xbx9)
- Done: web/graph_router.js. With unpaved avoided, which is the app's default (objective noDirt), each loop leg first searches with unpaved edges banned, plus the highways at Fun and Long way (hwyDirtOf). Only when that finds nothing does the leg search as before. loopNow then drops loops with more than K.LOOP_DIRT_KM (2 km) of unpaved road when at least one loop stays under it.
- Survey of rider towns, Fun, top loop's unpaved km before → after: Stowe 120 km 20 → 0; Tellico Plains 120 km 4.1 → 0; Logan 60 km 4.3 → 0; Hayward 60 km 6.9 → 0; Boone 120 km 3.3 → 0. Sturgis (15 to 27 km), Ouray (70 km) and Red Lodge (57 km) are unchanged: every loop found there needs the gravel.
- Next: Moab 60 km, Big Sur 60/120 km and Ouray 60 km find no loop at all. Their roads are out-and-back. Offer a clearly labelled there-and-back on the best road when no loop exists?

# CALL SHEET
## 2026-11-14 (loops off gravel): a gravel loop is shown only when no paved one exists (claude/project-thread-39xbx9)
Where every loop needs unpaved road (the Black Hills, the San Juans), the loops are still returned, with their unpaved km on the card, rather than none. Undo: drop the LOOP_DIRT_KM filter in loopNow and the obj.noDirt branch in loopLeg.
