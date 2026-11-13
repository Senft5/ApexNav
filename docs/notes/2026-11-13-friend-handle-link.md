# STATE

## 2026-11-13: a friend's handle on the Log opens their profile
- Done: on the Log's Friends lately, each friend's handle is now a link (`index.html?view=friends&friend=bob`). Inside the Log frame, ApexLogHost.load closes the Log onto People and draws it again, open on that friend's profile, so the map page never reloads. Opened on its own, the map page reads `?friend=` and opens the profile once the list is drawn. The e2e friend profile flow covers both paths.
- Done: on a crew's Board, a crew-mate's row now opens their sheet (Add friend, Report, Block), as their face does. Your own row is not a key. The e2e crew page flow checks it.
- Next: keep making social actions one tap where people meet.

# CALL SHEET

## 2026-11-13: ?friend= on the map page
- What: web/cockpit.js `openFriendHandle` (from `?friend=` or `window.apexOpenFriend`), matched against the friend list as People draws; web/analysis_page.js makes the handle an `a.friend-link`.
- Why: Nate wants social to be as easy as any major app, where a name is always a way to the person.
- Undo: make the handle a `<b>` again and drop `openFriendHandle`, `apexOpenFriend` and the `friend` branch in ApexLogHost.load.
