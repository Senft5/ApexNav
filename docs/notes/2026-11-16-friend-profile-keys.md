# STATE

## 2026-11-16 A friend's profile has three keys and ···
- Done: under a friend's profile head, Message, Drive with (was Convoy) and Challenge (was Challenge on a stage), then ··· (48 pt) opening a sheet with On the map, Share a route, Report, Block and Unfriend (red, last) and Cancel. The foot of Unfriend / Report / Block is gone (screen inventory, Friends row). `profile_view.js` `show()` takes `more`. e2e: the friend profile flows check the keys and the ··· sheet.
- Done: duels move into the friend's profile: Friends shows only a challenge waiting on your answer; on, sent or over, the card sits on that friend's profile under the keys (`duels.cards({ with, asks })`). e2e "duels:" checks it.
- Done: Find or start a crew: a crew near you is its preview card (its mark, name, one line, Join crew, Report); no crews near says "Start one below", and no answer has Try again. e2e "People, a new account…" checks it.
- Done: the Kudos list puts Add friend beside each giver who isn't your friend yet (Asked once sent, or when a request is waiting either way); the same request the Invite sheet sends. e2e "drive posts: Post on a scored…" checks it.
- Done: a crew's Invite opens one sheet (Copy link, Show code, friends not in the crew to tick, Send to N messages each the link); `qrCanvas` in cockpit.js draws both QR codes now. e2e "one link in…" checks it.
- Next: the inventory's remaining rows: signed out / offline Garage profile skeleton; Members ··· (make admin needs a backend change: ask first); Settings is the UI thread's.

# CALL SHEET

## 2026-11-16 Report and Block on a friend's profile move behind ···
- What: Report and Block are one tap further (··· then the key), where they were at the profile's foot.
- Why: the inventory (Nate's "Instagram profile" direction): three keys and ···, the destructive one last. 1.2 asks that blocking be available, which it is on the profile and on every post and comment; APP_REVIEW says so.
- Undo: in `web/cockpit.js` pass `foot` again (the old triples) instead of the Report / Block / Unfriend entries in `moreFor`.
