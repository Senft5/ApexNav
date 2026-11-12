# STATE
## Session 2026-11-12 (security pass, read limit): signed-out reads and made-up tokens limited per IP (claude/project-thread-4lms1f)
- backend/src/ratelimit.ts: a GET with no session token now counts against `READ_LIMIT` per IP (600 a minute), the same
  limit a session gets. The map tiles and relays stay out of it, as before.
- backend/src/auth.ts viewer(): a GET whose token has no live session behind it is also counted per IP. Otherwise a fresh
  made-up token on each request got a fresh key in rateCheck and read without limit (the read side of #486). This costs
  no extra D1 query: the session lookup already ran.
- Tests: backend/test/ratelimit.test.ts (+1, and the signed-out case of the signed-in test moved into it).
- Next: the iOS side (keychain, URL schemes, WebView bridge).

# CALL SHEET
## 2026-11-12 (security pass, read limit): signed-out reads get the same 600 a minute, per IP (claude/project-thread-4lms1f)
The public reads (road books near a point, a road book, a shared ETA, flags, health) each cost D1 reads, and nothing
limited them. So anyone could hammer them without signing in, or by sending a made-up token. They now share the
read limit, keyed by IP. A website visitor makes a few reads a page, far under 600 a minute, even behind a shared address.
Undo: in rateCheck, put back `if (s && …)` for reads, and drop the 429 in viewer()'s no-row branch.
