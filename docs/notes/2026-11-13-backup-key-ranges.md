# STATE

## 2026-11-13: the weekly backup no longer reads the database quadratically
- `dumpStatements` (backend/src/backup.ts) paged each table with `LIMIT 1000 OFFSET ?`. SQLite reads and drops every skipped row and D1 bills them, so a table of N rows cost about N²/2000 rows read: measured 85,150 for 10,000 road bins. At 100,000 road bins (about 500 km of shared driving) one Monday backup would have read about 5 million rows, Workers Free's whole daily allowance, and every D1 query would fail from 07:00 UTC to midnight.
- Now one window query per table finds the key that starts each 1,000-row page, and the rows batch reads each page by key range (the last range open-ended, so rows that arrive in between are kept). Still one transaction and 4 queries a run. About 4 rows read per row stored; backup.test.ts asserts under 5.
- Next: the 10 ms CPU cap still stops the backup somewhere in the tens of thousands of rows (docs/BACKUPS.md); Workers Paid or R2 + a smaller dump are the owner's calls.

# CALL SHEET

## 2026-11-13: backup pages by key range, not OFFSET
- What: pages bounded by primary-key (or rowid) ranges found with row_number(); the "grew past the planned pages" error is gone because the last range is open-ended.
- Why: OFFSET paging made the backup the largest single reader of the free daily row budget as the road data grows.
- Undo: revert the PR; the dump format is unchanged.
