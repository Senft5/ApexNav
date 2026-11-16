# STATE

## 2026-11-16: friend requests are one row and a sheet
- On Friends, requests in are one row at the top (faces, count; with one, it names who asks). It opens a sheet with face, handle, mutual friends and Accept / Not now; the last answer closes it and redraws Friends.
- `GET /api/friends` gives `mutual` (friends in common, counted, never named) on a pending request only; no DB change.
- A failed Accept / Not now now says "Couldn’t answer that. Check signal." (the card used to redraw as if it worked).
- Tests: backend/test/friend_requests.test.ts; e2e "People: two tabs" and "For you" updated.
- Next: the inventory's remaining big piece is the Garage grid's Tagged tab.

# CALL SHEET

## 2026-11-16: mutual friends counted, never named, on requests
- What: the count of shared friends on a request in, as People you may know already does.
- Why: the inventory asks for mutual friends on the request; naming them would tell a stranger who your friends are.
- Undo: drop the `mutual` column in `friendList` (backend/src/social.ts) and the line in the sheet (web/cockpit.js requestsSheet).

## 2026-11-16: the requests sheet is a Social module
- What: the sheet's code is web/friend_requests.js in lazy.js's social group; the row stays in cockpit.js.
- Why: inline it took the launch 1,272 bytes over the startup budget.
- Undo: move `ApexFriendRequests.open` back into cockpit.js and drop the file from lazy.js.
