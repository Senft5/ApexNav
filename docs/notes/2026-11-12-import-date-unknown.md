# STATE

## Session 2026-11-12 (roam-b walkthrough 3): an imported drive with no date says so (claude/project-thread-sxhrgi)

- Walked a drive's page on production as a new user: imported the demo drive as a CSV (Import), opened it from the Log.
  The page reads well (score, four parts, one thing to work on, map, grip circle, corners).
- Bug fixed: a file with no date in its name or rows is kept with `date_known: false`; the Log's index stamped it "--",
  but its page said "Today, 2:53 PM · Imported" and the Log's hero "Latest Vetta Score · Circle Freeway · Today, 2:53 PM"
  (the time it was imported). analysis.html `dateLabel` now says "Date unknown" for it (the page, a road's runs, pickers)
  and the hero names no time. e2e "import: a drive from a file…" covers it (fails before).
- Next: add a friend and join a crew as a new user (needs a signed-in account on production; stubbed Worker in e2e).

# CALL SHEET

## 2026-11-12 (roam-b walkthrough 3): an import with no date reads "Date unknown" (claude/project-thread-sxhrgi)

An imported drive whose file carries no date used to show the import time as if it were when you drove it. Its page and
a road's list of runs now say "Date unknown", and the Log's headline leaves the time out. Drives with a date are
unchanged. Undo: restore `dateLabel` in analysis.html to `ApexFormat.dateTime(d.date)`.
