# STATE
## Session 2026-11-15 (launch scale): no Worker query reads a whole growing table (claude/project-thread-g9yher)
- Built: `tests/test_query_plans.py` (every `prepare(...)` in backend/src planned against the migrations' schema; a full scan fails unless allowed with a reason) and migration `0067_scale_indexes.sql`: author indexes for the crew chat, build chat and build reply rate checks (each message read the whole table), `segments(COALESCE(origin_id, id), created_at)` for the crew page's house stage, and `crew_events(route_id)`, `crews(pinned_route_id)`, `crew_invites(crew_id)` behind shared-route pruning and crew deletion.
- Next: apply 0067 to apexnav-preview-db then apexnav-db (needs Nate's go in this thread), with the d1_migrations rows. No code needs it: before it is applied, queries are only slower.

# CALL SHEET
## 2026-11-15 (launch scale): indexes for the full scans found by query planning (claude/project-thread-g9yher)
Indexes only (0067), no code change, so merging before it is applied changes nothing. Account-deletion cascades still scan a few tables (board_entries, highlight_ratings and others by user_id): rare, left as they are, listed in the test's ALLOWED where a query does it. Undo: DROP INDEX for each of the seven.
