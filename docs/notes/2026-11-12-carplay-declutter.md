# STATE

## Session 2026-11-12 (carplay declutter): shorter car preview and loop list (claude/project-thread-me97iw)
- The picked route's preview line names one café and one fuel stop at most (`along.short`), never the two-name `along.full` line.
- Loops from here: one section header ("Twisty loops, back where you started") instead of the same detail under all five rows.
- Next: review the car's voice prompts and glance forms, then phone/car flow parity.

# CALL SHEET

## 2026-11-12 (carplay declutter): drop the two-name places line from the car preview (claude/project-thread-me97iw)
- Why: the owner's no-walls-of-text rule; "34 corners · Café: X · Fuel: A, B +2 · Long descent…" was too much to read at a glance. The phone keeps the full list.
- Undo: put `line([o.detail, along.full, along.descent])` back first in `routeChanged` (CarPlay/ApexCarPlay.swift).
