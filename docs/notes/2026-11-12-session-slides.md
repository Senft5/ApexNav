# STATE
## Session 2026-11-12 (stay signed in): a session in use slides instead of ending 30 days after sign-in (claude/project-thread-g9yher)
- Done: sessions had a fixed 30 days from sign-in, so everyone, however often they drove, was signed out on day 30 (TestFlight testers who signed in in late October would have hit it around 24 November). `viewer()` (backend/src/auth.ts) now pushes a session back out to 30 days when it is a day or more into its life, so at most one write a day per session; `/api/me` sets the website's cookie again (`sessionCookie`), since the cookie's own Max-Age would otherwise end it. The app's bearer token needs nothing more: the Keychain keeps it.
- A session left alone for 30 days still ends, and an expired one never comes back (backend/test/auth.test.ts).
- Privacy page, BACKEND.md and APP_REVIEW.md (5.1.1 row) say "30 days without use".

# CALL SHEET
## 2026-11-12: sliding 30-day sessions
- What: renew when a session is a day or more into its 30 days; no change to the 30.
- Why: being signed out mid-month for using the app is a bug, not security; a lost phone is handled by sign-out, account deletion and the Apple credential check (#514).
- Undo: drop the `stale` column and the UPDATE in `viewer()`, and the `sessionCookie` header in `/api/me`.
