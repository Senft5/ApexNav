# STATE
## Session 2026-11-12 (security pass, read limit): signed-in reads limited per session (claude/project-thread-4lms1f)
- backend/src/ratelimit.ts: a GET with a session counts against `READ_LIMIT` (600 a minute per session; wrangler.jsonc
  namespaces 1007 prod, 1008 previews), except the static map tiles (`TILE_PREFIXES`: /api/graph/, /api/ctx/v1/) and the
  relays (their own per-IP limit). Signed-out reads are not counted (they are 401s or public).
- Tests: backend/test/ratelimit.test.ts (+1).
- Next in the pass: the iOS bearer path (sessionHash on the app's token) under the same limits on a real phone; the
  crews-near and roadbooks-near cells can be walked by a member (both are public by design, noted, not changed).

# CALL SHEET
## 2026-11-12 (security pass, read limit): one account can read at most 600 times a minute (claude/project-thread-4lms1f)
Writes and sign-in were limited, reads were not, so one signed-in account could walk the API as fast as it liked to scrape
handles, crews near a point or spots. Now each session gets 600 reads a minute, then a 429 for the rest of the minute. The
phone polls a handful of endpoints a minute, and the map tiles a plan reads are not counted, so no driver gets near it.
Undo: drop `READ_LIMIT` from wrangler.jsonc (nothing is limited without it), or raise it.
