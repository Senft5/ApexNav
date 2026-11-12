# STATE

## 2026-11-12: time attack uploads and kudos fit the query limit
- Uploading time attack runs (POST /api/ta/runs and the older /api/timeattack/runs) made two D1 queries per run (up to 20) plus one board per circuit, past Workers Free's 50 per invocation. Each now makes three batches whatever the count: the circuits, the times that count, your places. Every run is now checked before any is saved, so a bad run in an upload saves nothing (it was partial before).
- Kudos counts on friends' activity (up to 30 runs) are one batch.
- Test: twenty runs in one upload (ta_fixed.test.ts).
- Next: nothing open here.
