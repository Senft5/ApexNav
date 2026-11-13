# STATE

## 2026-11-13: every request's D1 queries are counted
- `backend/src/query_budget.ts` wraps `env.DB` for each request. A single query, or one batch, counts as one. The tests run with `QUERY_LIMIT` 50 (wrangler.test.jsonc), so any route that would go past Workers Free's limit fails in vitest. Before this, only production showed it. Checked: the old export (before #586) fails the account test with QueryLimitError. All current routes pass.
- In production, a request over 40 queries is counted in error_counts (kind `queries`, page = route), so it shows in the owner's error summary before it starts failing. It is left out of the "route keeps failing" alert. A request that goes past 50 can't record itself, because the platform blocks the insert too.
- Not covered: the cron handlers and Durable Objects (they use their own env). The sweep is one batch.
- Next: nothing open here.

# CALL SHEET

## 2026-11-13: count D1 queries per request
- What: a Proxy over `env.DB` in the Worker's fetch, which throws past `QUERY_LIMIT` (set only in tests) and records more than 40 queries in production.
- Why: the local D1 has no per-invocation limit, so loops of single queries passed every test and failed in production (#586, #589, #592).
- Undo: drop the Proxy in index.ts fetch and the `QUERY_LIMIT` var.
