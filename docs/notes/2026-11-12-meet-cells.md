# STATE
## Session 2026-11-12 (security pass, crew home areas): your own square no longer counts toward the two (claude/project-thread-4lms1f)
- backend/src/crew_meet.ts: GET /api/crews/:id/meet shows the squares only once MIN_SHARING (2) members other than the
  viewer share; `need` is 3 for a viewer who shares. Before, a member who shared and one other made two, so the viewer
  could subtract their own square and read the other's outright.
- Tests: backend/test/route_context.test.ts (+1 check). docs/APP_REVIEW.md (two rows) and web/privacy.html say so.
- Left as is: someone watching the list over time still sees a new square appear when one more member switches it on.

# CALL SHEET
## 2026-11-12 (security pass, crew home areas): the two-sharing floor counts others only (claude/project-thread-4lms1f)
Fair meeting points show crew-mates' rough home squares without names once two share. Counting the viewer's own square,
two meant one other person's square handed over by subtraction. Now the viewer needs two others. A crew of two that both
share gets no Fair for the crew; they can pick a meeting point by hand. Undo: drop the `mine` term in crewMeetCells.
