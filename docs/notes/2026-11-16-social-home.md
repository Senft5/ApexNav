# STATE

## 2026-11-16 Social home: the People tab is Social, Feed first
- Done: the tab is Social (home icon) with Feed | Friends | Crews; Feed opens first for a member with a friend or a crew. Rings across the top (driving now, posted today, your crews; `web/social_home.js`, `web/avatar.js`), the full Feed inline with road-first post cards (line edge to edge with Score and distance on it, keys, then the words), For you and Messages as keys in the head on every side (For you is a sheet now, New / Earlier). The Friends side loses the For you section, the Messages row and the Feed preview it used to stack. Tests: tests/test_social_home.py, e2e flows on the Social tab.
- Next: step 2 of the restructure, the Garage as your profile (header, grid of drives, Edit profile, other people's profiles), per `social/screen-inventory.md` in project files.

# CALL SHEET

## 2026-11-16 The Feed side shows only with a friend or a crew
- What: a member with no friends and no crews sees Friends | Crews as before; the Feed tab appears once there is a friend or a crew.
- Why: an empty feed as the first screen tells a newcomer nothing; Friends has the way to a first friend.
- Undo: in `renderAccount`, set `feedOn` without the `!empty` condition.

## 2026-11-16 Post cards put the words under the road
- What: drive post cards everywhere (Feed, profiles, crews) now go who, line with Score and distance on it, keys, then name and caption.
- Why: Nate's Instagram-home ask, kept car-first: the road is the picture.
- Undo: in `drive_posts.js` `card`, append `words` before the line and `stats` outside `.feed-pic`.
