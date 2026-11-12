# STATE
## Session 2026-11-12 (security pass, iOS shell): the web view drops WebKit's private file-URL switches (claude/project-thread-4lms1f)
- ApexNavApp.swift: `enableLocalFileAccess` is removed. It set `allowFileAccessFromFileURLs` and
  `allowUniversalAccessFromFileURLs` through key-value coding on private setters. The cockpit is served as `apexnav://`
  (ApexBundleSchemeHandler), the navigation policy cancels any file:// page, and the CarPlay web view never set them.
  docs/APP_REVIEW.md gains a 2.5.1 row.
- Also checked, nothing to change:
  - the Keychain session: this device only, after first unlock, token shape checked.
  - ApexApiBridge: main frame and `apexnav:` origin only, `/api/` paths on our host, only two headers passed through.
  - the `apex` bridge: same frame check.
  - `apexnav://open` links: seven known keys with a strict character set. Friend, crew and convoy links all ask before acting.
  - `apexnav://auth`: only the ASWebAuthenticationSession callback, with a PKCE verifier the shell holds.
  - the bundle scheme handler: paths are standardized and kept under web/.
- Next: Swift compiles only in CI, so the build-ipa check on this PR is the proof. Then on with the pass.

# CALL SHEET
## 2026-11-12 (security pass, iOS shell): remove unused private WebKit settings (claude/project-thread-4lms1f)
They were left from when the cockpit loaded from file://. Now they only widened what a file page could read, and they used
private selectors, which App Review's 2.5.1 can flag. Removed rather than kept "just in case". Undo: restore
`enableLocalFileAccess` and its call in `makeWebView`.
