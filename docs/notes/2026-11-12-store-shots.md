# STATE
## Session 2026-11-12 (store screenshots): 2 of 5 App Store shots at 6.9" (claude/project-thread-g9yher)
- Done: `STORE=1 SHOTS_OUT=store-shots node tools/landing_shots.js` writes cockpit.png and crew.png at 1320 x 2868 (docs/LISTING.md).
- Open: the cockpit shot shows a speed (49 mph) and Sight, against the listing's "no speeds on screen" rule; the loop builder, Log corners, drive card and convoy shots are not scripted yet.
- Next: script the remaining three shots and hide the speed readout in the store cockpit shot.

# CALL SHEET
## 2026-11-12 (store screenshots): STORE=1 mode in the landing shot tool (claude/project-thread-g9yher)
One script makes both the landing page and the App Store shots, so they show the same real cockpit. The store size is 440 x 956 points at 3x (iPhone 16 Pro Max). Undo: drop the STORE branch in tools/landing_shots.js.
