# STATE
## Session 2026-11-12 (Sign in with Apple revocation): account deletion now revokes the Apple token (claude/project-thread-g9yher)
- Done: the shell sends Apple's one-time `authorizationCode` with the identity token. `backend/src/apple_revoke.ts` trades it at appleid.apple.com/auth/token (ES256 client secret) and keeps the refresh token in KV `PHOTOS` under `siwa/<userId>`; `deleteAccount` revokes it at /auth/revoke and always deletes the key.
- Waiting on the owner: the Sign in with Apple key and the `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_KEY_P8` Worker secrets (OWNER_TODO). Without them the code does nothing and sign-in works as before.
- Next: people who signed in with Apple before this build have no stored token; they get one the next time they sign in.

# CALL SHEET
## 2026-11-12 (Sign in with Apple revocation): keep the refresh token in KV, not a new D1 column (claude/project-thread-g9yher)
No migration needed, and the token dies with the key on delete. A failed trade or revoke never fails sign-in or deletion (logged with serverError). Undo: drop the `revokeApple` call in account.ts and the `keepAppleRefresh` call in apple.ts.
