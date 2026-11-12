# STATE
## Session 2026-11-12 (security pass, hazard votes): a fresh account's "gone" no longer counts (claude/project-thread-4lms1f)
- backend/src/hazards.ts vote(): a "gone" adds to `clears` (two outvoting the confirmations end a report) only from a
  member who was invited or has been one a week (`establishedSql`). A newcomer's vote is still stored (one a person) and
  a change of mind from it takes nothing off the clears. "Still there" counts from everyone, as before.
- Tests: backend/test/hazards.test.ts (+1). docs/BACKEND.md hazards line says so.

# CALL SHEET
## 2026-11-12 (security pass, hazard votes): newcomers can confirm a hazard but not clear one (claude/project-thread-4lms1f)
Sign-up is open, so two fresh accounts could take any warning off everyone's map in a minute: a deer, debris on a
blind corner, a police report. Clearing now needs members who were invited or have been members a week, the same bar
reports need. Confirming stays open to all, since a wrong "still there" only keeps a warning up a little longer.
Undo: count `still || true` in vote() (drop the `established` checks).
