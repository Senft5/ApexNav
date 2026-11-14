# STATE

## Session 2026-11-14 (site rebuild): vettadrive.com rebuilt, night look (claude/project-thread-j3sg26)
- Done: web/about.html (the vettadrive.com front page, backend/src/hosts.ts) rebuilt from scratch on the UI thread's new Night tokens (#0A0A0B, #111214, #1B1C20, hairline #2B2D33, #F5F5F7, #A0A3AB, red #FF3341) and the app's faces. A hero ("Every corner, called.") with a drawn road and the cockpit, a facts band, four feature rows with real app screens (web/brand/site/*.webp, cut from the App Store shots of the bundled example drive; the cockpit cropped above the speed), the four promises, a closing call. No script on the page; reduced motion gets the road already drawn. Screens of it: project files site/.
- Next: when the App Store id exists, turn the "iPhone app · Beta now" pill into the App Store link with `ct=site`. When the new theme ships in the app, re-cut web/brand/site/ from fresh store shots (tools/landing_shots.js STORE=1) so the screens are dark too.

# CALL SHEET

## 2026-11-14 (site rebuild): the site leads with dark, not Roadbook paper (claude/project-thread-j3sg26)
- Why: Nate said the site "sucks so bad" and Roadbook is flat and low contrast; the UI thread's new main theme is graphite and white with one red, and the site uses its Night values.
- Undo: `git show HEAD~1:web/about.html` (the paper page).

## 2026-11-14 (site rebuild): no App Store button yet (claude/project-thread-j3sg26)
- Why: there is no App Store id before launch, and a dead badge reads broken; the pill says "Beta now · App Store soon" and the red key opens the web app.
- Undo: n/a; replace the pill at launch.
