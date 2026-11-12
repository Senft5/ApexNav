# STATE
## Session 2026-11-12 (Sign in with Apple credential state): turning off Apple sign-in for Vetta signs you out (claude/project-thread-g9yher)
- Done: the shell keeps the Apple user id (UserDefaults `apex.appleUser`, cleared on any sign-in or sign-out), checks `ASAuthorizationAppleIDProvider.getCredentialState` each time the app comes to the front and on `credentialRevokedNotification`; on `.revoked` it posts /api/auth/logout, clears the Keychain and sends the page `{type:'session', signedIn:false}`, which redraws signed out with one toast.
- Checked in a browser (the page message); the Swift side compiles only in CI (build-ipa). Needs a device test: sign in with Apple, turn it off in Settings, come back to the app.

# CALL SHEET
## 2026-11-12 (Sign in with Apple credential state): act only on `.revoked`, not `.notFound` (claude/project-thread-g9yher)
`.notFound` can come back when iOS has no record yet (a fresh restore, a simulator) and would sign people out for nothing; `.revoked` is the person's own choice. Undo: drop `checkAppleCredential` from the scenePhase handler.
