# STATE
## Session 2026-11-12 (security pass, road privacy floor): a fresh account can't be the second driver (claude/project-thread-4lms1f)
- Migration 0058 `road_floor` (way_id, dir, holder): the first two established drivers of each road and direction. Holders
  are the same hmac as `rank_slots.holder`, never an id. It is backfilled from `rank_slots`, so every road shown today
  stays shown.
- backend/src/contribute.ts: each accepted chunk adds the driver's holder to `road_floor` when they are established
  (`establishedSql`: invited, or a member a week) and the road has fewer than two. A newcomer who drives the road again
  after a week is counted then.
- backend/src/roads.ts `shownSql` counts `road_floor` instead of `rank_slots`. Slots, multipliers and pioneer badges are
  unchanged (the coordinator, 2026-11-12: leave first-week points alone).
- Tests: backend/test/coverage.test.ts (+1: a fresh second driver is paid 2x but the road stays hidden until an established
  third), roads.test.ts seeds `road_floor`, helpers.ts loads 0058.
- Apply 0058 to apexnav-preview-db, then apexnav-db, each with its d1_migrations row, before merging.

# CALL SHEET
## 2026-11-12 (security pass, road privacy floor): count the privacy floor separately from the points slots (claude/project-thread-4lms1f)
Sign-up is open, so one throwaway account driving (or faking) a second pass could reveal a lone driver's lane, such as a
short road to their house. A new table was the clean fix: `rank_slots` keeps only two rows per road, so a newcomer in slot 2
would have blocked a later real driver from ever counting. Open roads (motorway to tertiary, long unclassified) are
unaffected; they show from the first pass. Undo: in shownSql, count `rank_slots` holders again (the table can stay).
