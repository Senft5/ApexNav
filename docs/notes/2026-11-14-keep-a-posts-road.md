# STATE

## 2026-11-14 Keep a post's road in a roadbook (free roamer B)
- Done: a Feed post's ··· has "Keep in a roadbook". It opens a small sheet with your books and New roadbook; a tap keeps the road the post drew, under the post's name, without anything inside your own privacy zones. It works on a friend's post and on your own (your own drive's road, from the Feed).
- Code: `keep` in web/roadbooks.js (`addPart` takes what goes in as an argument; the route card's Share still sends the planned route); the ··· key in web/drive_posts.js; `keepRoad` in web/cockpit.js.
- Tests: tests/test_roadbooks.py `test_keep_a_posts_road_in_a_roadbook_is_wired`; e2e "the Feed: Keep in a roadbook on a friend's post" (fails on main). APP_REVIEW 1.2 roadbooks row updated.
- Next: a crew's roadbook (needs a crew column on roadbooks, a migration).

# CALL SHEET

## 2026-11-14 A friend's posted road can go into any of your books (free roamer B)
- What: the line of a friend's post can be kept in any of your roadbooks, including a public one. Only the line and the post's name go in, never their handle, Score or day.
- Why: the posted line is already cut of their private ends (500 m and their zones) and is the shape of public roads; Nate (2026-11-11) dropped the ultra-privacy focus and wants social sharing easy.
- Undo: drop the 'Keep in a roadbook' key in moreKey (web/drive_posts.js), or offer only private books in `keep`.
