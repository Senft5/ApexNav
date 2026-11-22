-- The old per-bin road table goes (2026-11-22). Migration 0068 copied it into road_chunks; on prod all 25,282 bins read back
-- exactly through the road_bins view (2026-11-15), and a week of uploads has written the packed rows since. Undo: D1 Time
-- Travel restores the database to a moment before this ran (30 days on Workers Paid).
DROP TABLE road_bins_legacy;
