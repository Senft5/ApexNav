# STATE

## Session 2026-11-13 (carplay time attack): this week's time attack loop in the car's Places (claude/project-thread-me97iw)
- Once you've entered this week's featured loop, the car's Places has it after your pinned places ("Tellico loop", "Time attack · you're 3rd of 8 · 3 days left"). A tap sends `{action:'attack', id}` and the phone drives the loop itself (cockpit `driveAttack`, the phone's own Drive it).
- The car asks with the phone's peek (time_attack.js `peek`, only the area is sent) when it connects; `page.week` hands the featured week to the cockpit.
- A loop you haven't entered stays on the phone, where entering it lives.
- Next: keep checking phone/car parity.
