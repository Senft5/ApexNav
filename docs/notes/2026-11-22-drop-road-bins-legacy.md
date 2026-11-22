# STATE
## Session 2026-11-22 (scale): old per-bin road table dropped (claude/project-thread-g9yher)
- A week after packing (#946), prod road_chunks are healthy: 393 chunks, 62 written by uploads since, every one valid JSON, max ver 3.
- Real writes on prod, 2026-11-17: 648 D1 rows for the whole Worker on a day of 20.7 uploaded km, so at most 31 rows a km all told. Before packing, road data alone was about 210 a km.
- Migration 0070 drops road_bins_legacy. The parity and backfill tests now make their own copy of the old table.
- Next: nothing on road-data writes. Re-measure once uploads pass a few hundred km a day.

# CALL SHEET
## 2026-11-22 (scale): dropped road_bins_legacy after a week of packed uploads (claude/project-thread-g9yher)
It held a pre-packing copy that nothing reads. Undo: D1 Time Travel restores the database to before 0070 ran (30 days).
