# STATE

## 2026-11-13: A saved route keeps the reports along it
- Done: saving a route for offline asks, as a member with signal, for the reported hazards in the cells it runs through (`askCellsAlong`, the same `routeCells` lookups as a drive's start) and keeps them on the phone with the route (`web/route_reports.js`, localStorage `apex.routeReports`, ten routes at most). Opened again with no signal, its card names them with their age ("as of 2:15 PM"), expired ones dropped; a drive started with no signal on it seeds the dead-zone cache from them. Unsaving, Delete offline data and Erase drop them. Privacy page and APP_REVIEW 5.1.2 say so.
- Next: none here.

# CALL SHEET

## 2026-11-13: Reports kept at save time, shown with their age
- What: the reports are asked once, when the route is saved, and shown offline with "as of" the time they were asked.
- Why: reports expire within hours; the age keeps an old list honest, and asking again needs signal anyway.
- Undo: drop `keepReportsAlong(t)` from the Save button and the `kept` branch in `paintRouteReports`.
