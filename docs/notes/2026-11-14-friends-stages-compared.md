# STATE

## 2026-11-14 Friends' posted stages compared without Drive it (free roamer B)
- Done: the end card's "Skyway summit: 780, 21 under @bob's 801." now also comes for any friend's posted stage the Feed has shown you that the drive went over, not only after Drive it. The Feed keeps those stages on the phone (`keepStages` in web/drive_posts.js, key `apex.friendStages`: at most 40, 21 days, your own posts left out). Sign-out and account deletion clear it (cockpit.js `clearCrowd`), and Erase everything does too (an apex.* key). docs/APP_REVIEW.md says so.
- Tests: tests/test_drive_posts.py `test_the_feed_keeps_friends_stages_for_the_end_card`; the e2e "drive posts: after you drive a friend's posted stage" flow now checks a drive without Drive it, and one elsewhere.
- Next: none queued here.

# CALL SHEET

## 2026-11-14 Friends' stages kept on the phone, from the Feed only (free roamer B)
- What: no new server call. The comparison uses only posts the Feed already loaded, so a friend whose post you never scrolled to isn't compared.
- Why: no backend change or migration, and nothing the member hasn't already been shown.
- Undo: drop `keep(rows)` in drive_posts.js and the `theirs` pool in cockpit.js `endCardScored`.

## 2026-11-14 The Garage shelf's swipe rests before it lifts (free roamer B)
- What: e2e `swipe()` takes a `holdMs`; the Garage shelf flow's two swipes rest 250 ms before the finger lifts, so there is no fling.
- Why: ten touch moves sent back to back are a flick whose speed depends on how loaded the runner is. After certain flows (it reproduced on main after "drive posts: Drive it on a friend's post"), the flick flung the shelf past the next look (scrollLeft 612) and failed CI on #811 and #817. A drag that rests then lifts snaps to the next look every time (4 of 4 runs of the failing pair, and shard 3/4 in full).
- Undo: drop the `250` arguments in that flow.
