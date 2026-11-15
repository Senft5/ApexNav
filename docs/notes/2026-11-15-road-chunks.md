# STATE
## Session 2026-11-15 (packed road data): uploads write a few rows a km instead of one a bin (claude/project-thread-g9yher)
- Built: migration 0068 (`road_chunks`, 128 bins a row as JSON; the old table renamed `road_bins_legacy` and copied in; `road_bins` now a view with the old columns, INSTEAD OF triggers), `backend/src/road_pack.ts` (mergeBinRow, the merge in the Worker; pack/unpack), contribute.ts `packedStmts` (one read, one write per chunk, version-checked, retried on CHUNK_CONFLICT), tests in backend/test/road_pack.test.ts (merge identical to SQL over 24 seeded runs; backfill reads back every value exactly; a 2 km upload writes under 30 rows; a racing upload retries and loses nothing).
- 0068 applied to the preview DB 2026-11-15; checked there: trigger insert/update/delete and the view read back exact values.
- Next: once a week of uploads has run on the chunks, a migration drops road_bins_legacy. Then measure real rows written per km from the usage counts (error_counts kind usage, d1_written).

# CALL SHEET
## 2026-11-15 (packed road data): a view keeps every reader as it was (claude/project-thread-g9yher)
Instead of rewriting roads.ts and road_insights.ts, `road_bins` became a view over the chunks (json_each), so their SQL is untouched. Reads may count json_each rows; they were one row per bin before too. Chunk size 128: most OSM ways are shorter, so an upload writes about one row per way. Undo: drop the view and triggers, rename road_bins_legacy back (bins uploaded since are only in road_chunks: unpack them first: `INSERT OR REPLACE INTO road_bins_legacy (way_id, dir, bin_idx, <BIN_COLUMNS>) SELECT way_id, dir, bin_idx, <BIN_COLUMNS> FROM road_bins`, columns named, since the two orders differ), and revert contribute.ts to the per-bin mergeBin.
