# STATE

## 2026-11-16 A friend's profile has three keys and ···
- Done: under a friend's profile head, Message, Drive with (was Convoy) and Challenge (was Challenge on a stage), then ··· (48 pt) opening a sheet with On the map, Share a route, Report, Block and Unfriend (red, last) and Cancel. The foot of Unfriend / Report / Block is gone (screen inventory, Friends row). `profile_view.js` `show()` takes `more`. e2e: the friend profile flows check the keys and the ··· sheet.
- Next: the inventory's remaining rows: Duels into the friend's profile and For you; Settings groups; signed out / offline profile skeleton.

# CALL SHEET

## 2026-11-16 Report and Block on a friend's profile move behind ···
- What: Report and Block are one tap further (··· then the key), where they were at the profile's foot.
- Why: the inventory (Nate's "Instagram profile" direction): three keys and ···, the destructive one last. 1.2 asks that blocking be available, which it is on the profile and on every post and comment; APP_REVIEW says so.
- Undo: in `web/cockpit.js` pass `foot` again (the old triples) instead of the Report / Block / Unfriend entries in `moreFor`.
