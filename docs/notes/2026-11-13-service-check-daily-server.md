# STATE

## Service check: the Worker checks its own side every day, no phone needed (2026-11-13)
- Done: `dailyServerCheck` (backend/src/service_check.ts) runs with the daily sweep cron and keeps `serverSide()` as `error_counts` rows (kind 'service', source 'server', ids srv_db, srv_config, srv_graph_data, srv_overpass_de/kumi/coffee/vk). health.test.ts and sweep.test.ts stub fetch for the scheduled handler, since it now asks upstreams. Why: until now there was only a row when Nate opened Settings, so an outage of our upstreams between his runs left nothing behind.
- Next: once a few days have built up, compare srv_overpass_* (from Cloudflare) with the phone's overpass_* rows, to see whether the camera servers fail everywhere or only from the phone.

# CALL SHEET

## The server-side check rides on the daily sweep cron, not a new trigger (2026-11-13)
- What: `ctx.waitUntil(dailyServerCheck(env))` sits next to the sweep in `scheduled`, and it never throws, so it can't mark the sweep as failed. Why: no new cron trigger to manage, and about 5 subrequests plus 2 D1 calls fit the free tier's limits. Undo: delete that line in backend/src/index.ts.
