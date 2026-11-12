# STATE

## Session 2026-11-12 (roam-b walkthrough 3): an imported drive with no date says so (claude/project-thread-sxhrgi)

- Walked a drive's page on production as a new user: imported the demo drive as a CSV (Import), opened it from the Log.
  The page reads well (score, four parts, one thing to work on, map, grip circle, corners).
- Bug fixed: a file with no date in its name or rows is kept with `date_known: false`; the Log's index stamped it "--",
  but its page said "Today, 2:53 PM · Imported" and the Log's hero "Latest Vetta Score · Circle Freeway · Today, 2:53 PM"
  (the time it was imported). analysis.html `dateLabel` now says "Date unknown" for it (the page, a road's runs, pickers)
  and the hero names no time. e2e "import: a drive from a file…" covers it (fails before).
- Drive it again from that drive on production: the route card's map had two LPR stamps and a CAFÉ stamp piled on one
  junction. The pins' declutter (scenic.js) now takes the route notes' stamps (`pins`: LPR, SPD, hazards) as `fixed`: always
  shown, placed first, the same word twice on one spot shown once, the café / fuel / viewpoint pins kept off them.
  tests/test_scenic.py covers it.
- Next: add a friend and join a crew as a new user (needs a signed-in account on production; stubbed Worker in e2e).

# CALL SHEET

## 2026-11-12 (roam-b walkthrough 3): an import with no date reads "Date unknown" (claude/project-thread-sxhrgi)

An imported drive whose file carries no date used to show the import time as if it were when you drove it. Its page and
a road's list of runs now say "Date unknown", and the Log's headline leaves the time out. Drives with a date are
unchanged. Undo: restore `dateLabel` in analysis.html to `ApexFormat.dateTime(d.date)`.

## 2026-11-12 (roam-b walkthrough 3): camera and hazard stamps win the map's space over café and fuel pins (claude/project-thread-sxhrgi)

Where a camera's stamp and a café's sat on the same spot, both were drawn on top of each other. The camera (a route note)
now always shows and the café hides until there is room; two stamps of the same camera word on one spot show once.
Undo: drop `fixed` from the pins in cockpit.js `declutterPois` and scenic.js `declutter`.
