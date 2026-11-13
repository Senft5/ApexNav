# STATE

## 2026-11-13: the $5 guard for D1 and KV (Spend Management doesn't cover them)
- Nate turned on Workers Paid, R2 and Spend Management's block. The block stops Workers requests and CPU and Durable Objects past the plan, not D1, KV or R2 (developers.cloudflare.com billing docs, 2026-11-13).
- backend/src/usage.ts meters every D1 result's rows read and written (the counted DB, src/query_budget.ts) and every KV call, flushes them every 30 s into error_counts (kind `usage`), and at 80% of any included amount this month pauses road uploads and photos (503 service_unavailable, scope `uploads`, until the 1st) and the weekly backup. The app says so once; the Service check shows each metric's share. Tests: backend/test/usage.test.ts, tests/test_server_down.py.
- The daily-limit 503 now also says `until`, and the app uses the server's time when given.
- R2 buckets `apexnav-archive` and `apexnav-archive-preview` exist (created 2026-11-13). Next: weekly backups into R2 (ARCHIVE binding), then R2 class A/B in this meter, then map data from R2.

# CALL SHEET

## 2026-11-13: what pauses near the monthly limit
- What: only road uploads, photos and the weekly backup pause at 80% of a D1 or KV included amount; reads, sign-in, friends, crews and driving never do.
- Why: they are the heavy optional writes and the app keeps them for later; cutting reads would break the app for a few cents. The line sits at 80% because the count is a floor and the billing period may not start on the 1st.
- Undo: empty SHED_ROUTES and drop the usageState check in index.ts scheduled(); the meter alone costs one small write per isolate per 30 s.

## 2026-11-13: first() reads through all()
- What: the counted DB answers first() by running all() and taking the first row.
- Why: only all() and run() hand back meta (rows read); workerd's first() fetches every row anyway, so nothing changes in cost.
- Undo: restore the plain first() passthrough in src/query_budget.ts (first() reads then go unmetered).
