# STATE

## Session 2026-11-12 (carplay report undo): a report from the car has its Undo on the car (claude/project-thread-me97iw)
- The car's Report grid used to send the report with no word back; the phone's Report key turned into Undo where the driver can't see it. Now the car shows "Gravel reported" with Undo and OK for 5 s (the offer alert, with a new optional `cancel` key name).
- Undo on either screen takes the report back and the other screen's Undo goes too; a second report sends the first at once and its car Undo goes.
- Next: keep checking phone/car parity (Where to? results, Places list, End and Undo).

# CALL SHEET

## 2026-11-12 (carplay report undo): a car report waits 5 s, not 3 s, before it is sent (claude/project-thread-me97iw)
- Why: a CarPlay navigation alert lasts at least 5 s, and the Undo on it must still work for as long as it shows. A report made on the phone keeps its 3 s.
- Undo: `CAR_HZ_UNDO_MS` in web/cockpit.js back to 3000 (the car alert then outlasts the window by 2 s), or drop the `fromCar` offer.
