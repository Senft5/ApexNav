# STATE
## Session 2026-11-15 (Dynamic Type on the simulator): the phone's real text size reaching the page is tested once (claude/project-thread-dpdmcn)
- Done: `UITests/DynamicTypeTests.swift` launches the app at the largest accessibility text size (`-UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL`), opens Garage, then Settings, then Units, and checks that the "Kilometres and metres" key is over 70 pt tall (44 pt at 1x) and on the screen. It attaches a screenshot.
- Why: every large-text e2e flow fakes the size in Chromium (`TYPE_AT`). The real path is iOS's content size category, then WebKit's `-apple-system-body`, then `applyTypeScale`, then the zoom. Until now it was only checked by hand, and IDEAS U-15 said "not run in the simulator".
- The simulator tests run on main only when native code changes, and on a branch by hand (workflow_dispatch). This branch's run is linked in its PR.
- Next: another roam item.
