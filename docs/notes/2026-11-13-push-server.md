# STATE

## Push notifications, end to end (2026-11-13)
A driver can turn on Garage → Settings → Notifications and hear about a friend request, a new friend, kudos on a run,
kudos and comments on their drive post, a duel, or a crew drive the moment it happens, with the app closed. A tap
opens the post, the friend or People. Nothing comes during a drive. iOS asks only when the switch goes on.
`backend/src/push.ts` decides who is told what and keeps the tokens (KV `push/<user id>`). It sends through
`backend/src/apns.ts` (the APNs send path from the production thread's PR), so there is one implementation.
`ApexPush.swift` gets the token and opens a tap's link. The page sends the token, quiet at drive start and end, and takes the token back at
switch off and Sign out. Sending starts once the owner ticks APNs on the Sign in with Apple key (docs/OWNER_TODO.md).
Tests: `backend/test/push.test.ts` (6), e2e "push notifications: Garage > Notifications …", tests/test_push_shell.py.
Next: confirm on TestFlight that signing takes `aps-environment` and that a push arrives once APNs is on.

# CALL SHEET

## Push tokens live in KV, not D1 (2026-11-13)
What: `push/<user id>` in the PHOTOS namespace, as `siwa/<user id>` is.
Why: there is no migration, so no "go" is needed and no tokens go into the weekly D1 backups. Every lookup is by user id.
Undo: move it to a `push_tokens` table and read it with one batch per send.

## The page hands the token to the Worker, not the shell (2026-11-13)
What: the shell sends the APNs token to the page (`{type:"pushToken"}`), and the page POSTs it with its own session.
Why: sign-in stays in one place (the page's apiCall), and the shell needs no new authenticated call.
Undo: post it from the shell with the Keychain session, as ApexBuildNotifier does.

## One switch, off by default, with one offer after your first post (2026-11-13)
What: one Notifications switch for all kinds. The permission is asked at that switch. A single toast offers it after
the first drive post.
Why: the owner wants no clutter. iOS lets an app ask only once, so the ask comes when the driver wants it. Per-kind switches can follow if anyone asks.
Undo: `pushOffer` in web/cockpit.js; `state.toggles.push` default.

## aps-environment: development in the entitlements (2026-11-13)
What: project.yml adds `aps-environment: development`. The App Store export re-signs it as production.
Why: this is the standard setup for automatic signing. -allowProvisioningUpdates should enable Push on the App ID by itself.
Undo: remove the line. If TestFlight signing fails on it, the owner ticks Push Notifications on the App ID (OWNER_TODO).
