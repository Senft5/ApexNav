# STATE

## 2026-11-16 The Garage keeps its profile head signed out and with no answer
- Done: signed out, the Garage opens on your profile still to come (a dashed face, -- Drives / Friends / Crews, "Your profile", Sign in); the empty bay under it lost its own Sign in. No answer: the same head with the handle this phone last knew (`apex.myHandle` in localStorage, cleared on sign out), offline or not answering, and Try again. `profileSkeleton()` in cockpit.js. e2e: "no connection: People…" and "the Garage on a phone…" check both.
- Done: a crew member's sheet has the friend profile's shape: Done at its head, Add friend (Accept / Request sent) and ···; behind ··· Report, Block and the owner's Remove from crew, last and red. `ApexProfileView.moreKey` is exported for it. e2e "crew page: an old ?view=crew link…" checks it.
- Next: Members admins (make admin) need a backend change and a migration: ask Nate first. Settings is the UI thread's.

# CALL SHEET

## 2026-11-16 The phone remembers your handle for the offline Garage
- What: `apex.myHandle` (localStorage) holds your handle once you're signed in, so the Garage with no answer still says @you.
- Why: the inventory's offline Garage row: the profile keeps its shape instead of becoming a paragraph. Only your own handle, removed when signed out.
- Undo: drop the two localStorage lines in `web/cockpit.js` and pass 'Your profile' as the title.

## 2026-11-16 Report and Block on a crew-mate move behind ···
- What: on a crew member's sheet, Report, Block and Remove from crew sit behind ···, where they were a row of links and a red key.
- Why: the same shape as a friend's profile (three keys and ···, the destructive one last); 1.2 blocking stays on every surface, one tap further.
- Undo: in `web/crew_page.js` `member()`, append the `more` entries as linkbtns in a foot again.
