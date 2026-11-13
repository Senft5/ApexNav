# STATE

## Session 2026-11-13 (carplay time attack): the time attacks you've entered in the car's Places (claude/project-thread-me97iw)
- The car's Places lists up to 3 of the area's time attacks you've entered, the featured one first, after your pinned places ("Tellico loop", "Time attack · you're 3rd of 8 · 3 days left"; others "Time attack · 11 mi"). A tap sends `{action:'attack', id}` and the phone drives the loop itself (cockpit `driveAttack`, the phone's own Drive it).
- The car asks with the phone's peek (time_attack.js `peek`, only the area is sent) when it connects; `enteredLoops` and `page.entered` hand the list to the cockpit.
- A time attack you haven't entered stays on the phone, where entering it lives.
- Next: keep checking phone/car parity.
