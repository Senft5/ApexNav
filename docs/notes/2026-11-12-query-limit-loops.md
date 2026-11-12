# STATE

## 2026-11-12: four loops kept inside the Workers Free query limit
- Workers Free allows 50 D1 queries per invocation and a batch counts as one. Four places made one query (or more) per row and could pass it: the duels list (four per duel, page of 50), publishing a result (one check per grant; sharing with friends is on by default, so many friends meant many checks), friends' activity (one board per stage, up to 30) and planning recurring meets (two per drive, up to 50, in the daily sweep).
- Now: duels and activity read in one batch; publish checks friendship and crew membership inside the grants query; recurring meets claim and plan in one batch (one transaction: a failure rolls back every claim and the next run retries).
- Tests: a stale grant publishes nothing (privacy.test.ts), six repeats due at once each planned once (event_repeat.test.ts).
- Next: nothing open here.

# CALL SHEET

## 2026-11-12: recurring meets plan in one transaction
- What: `rollRepeats` claims and inserts every due drive in one D1 batch, using `WHERE changes() = 1` so a drive another request already planned is skipped.
- Why: two queries per drive went past the per-invocation limit; one transaction also means a failed insert no longer loses a claimed series.
- Undo: revert this PR.
