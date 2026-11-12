# STATE
## Session 2026-11-12 (backend resilience): the friends-on-map poll no longer scans everyone sharing (claude/project-thread-g9yher)
- Done: `GET /api/presence` (polled every minute by each phone with the layer on) started from `SCAN presence_settings`, every user sharing, with five correlated lookups each, so rows read grew with users squared now that sharing is on by default. It now starts from your own accepted friends and private-crew mates (`PRESENCE_VIEW`, a `cand` CTE); the WHERE that decides who may see you is unchanged. A test checks the query plan has no full scan.
- Sweep of all 572 SQL statements in backend/src (EXPLAIN on the migrated schema): the other full scans are daily sweeps, account deletion or rare owner pages. Candidates for an index later (a D1 migration, needs the owner's go): `segment_shares(audience_type, audience_id)` for "shared with me" and crew pages, `highlights(author_id)` for the daily cap.
- Next: synthetic load against a preview build.
