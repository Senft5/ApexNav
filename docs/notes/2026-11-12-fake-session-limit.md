# STATE
## Session 2026-11-12 (security pass, fake sessions): a made-up session token no longer dodges the write limit (claude/project-thread-4lms1f)
- backend/src/ratelimit.ts: a write is keyed per session only when the session row exists and has not expired (one D1
  read per write); anything else is keyed per IP. Before, any bearer token of 20+ characters (or any cookie) got a fresh
  limiter key on each request, so the signed-out writes (/api/errors, /api/app-health, /api/feedback) had no limit.
- Tests: backend/test/ratelimit.test.ts (+1).
- Next in the pass: the anonymous counters (/api/app-health adds to the owner's daily rates with no sign-in) can still be
  skewed slowly from many IPs; the crews-near and roadbooks-near cells are public by design (noted, not changed).

# CALL SHEET
## 2026-11-12 (security pass, fake sessions): writes trust the session key only after looking the session up (claude/project-thread-4lms1f)
The write limit is per session for signed-in people (so a carrier NAT can't lock them out) and per IP otherwise. It took
the session from the token alone, so anyone could send a new fake token with each request and never be limited. Now the
session is looked up first: one extra indexed read per write, nothing for reads. Undo: revert the `live` check in rateCheck.
