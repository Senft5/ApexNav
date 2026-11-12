# STATE

## 2026-11-12: Download my data fits the Workers Free query limit
- `exportMyData` (backend/src/account.ts) made over 50 single D1 queries (one per table, plus sign-in), past the Workers Free limit of 50 per invocation, so GET /api/me/export would fail in production. Every list now goes out in one `env.DB.batch` (one query); the export makes about 6 queries in all. `tests/test_export_complete.py` keeps it that way.
- Next: nothing open here.

# CALL SHEET

## 2026-11-12: export lists in one batch
- What: the export's per-table SELECTs run as one D1 batch, filled into the same object shape and key order.
- Why: the per-invocation query limit; a batch counts as one query.
- Undo: revert this PR (only safe on Workers Paid, 1000 queries).
