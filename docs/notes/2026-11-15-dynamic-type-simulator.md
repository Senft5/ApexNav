# STATE
## Session 2026-11-15 (Dynamic Type on the simulator): the phone's real text size reaching the page is tested once (claude/project-thread-dpdmcn)
- Done: `UITests/DynamicTypeTests.swift` launches the app at the largest accessibility text size (`-UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL`), opens the Garage, and checks that its Haptics switch row is over 70 pt tall (48 pt at 1x) and on the screen. It attaches a screenshot.
- Found on the first simulator run: the real path works. At the largest size every key in the Garage was twice its height (Sign in 88 pt, Haptics 96 pt), so the large-text fixes since #752 do reach a phone. The first try went through Settings, then Units: the gear is exposed to XCUITest as "Other", not a button, so the test now reads the Garage itself.
- Why: every large-text e2e flow fakes the size in Chromium (`TYPE_AT`). The real path is iOS's content size category, then WebKit's `-apple-system-body`, then `applyTypeScale`, then the zoom. Until now it was only checked by hand, and IDEAS U-15 said "not run in the simulator".
- The simulator tests run on main only when native code changes, and on a branch by hand (workflow_dispatch). This branch's run is linked in its PR.
- Next: another roam item.
