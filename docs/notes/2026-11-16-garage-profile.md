# STATE

## 2026-11-16 The Garage is your profile
- Done: the Garage opens on a profile head (`web/profile_head.js`): face, Drives / Friends / Crews counts (each a tap), handle, daily car, Edit profile (photo and handle on one sheet) and Share profile (a friend link). Your posted drives show three across (`drive_posts.js` `grid`), each tile the road it drew with its Score; a tap opens the post. A friend's profile uses the same head (Days, Stages, Best this month, their car, a live ring) and the same grid. Tests: tests/test_profile_head.py, e2e "Garage → You is your profile", friend profile flows.
- Next: step 3, crews as groups (cover, tabs, members, invite, manage crew), per `social/screen-inventory.md` in project files.

# CALL SHEET

## 2026-11-16 No bio field on the profile
- What: Edit profile holds photo and handle only, no "about you" line.
- Why: a bio needs a migration (and moderation); the car line says who you are as a driver without one. No-DB design preferred.
- Undo: add a `bio` column and a field on the Edit profile sheet.
