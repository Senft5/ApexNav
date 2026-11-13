# STATE

## 2026-11-13: a crew-mate is one tap from a friend
- Done: tap a crew-mate's face on the crew page, and their sheet now has **Add friend** (or **Accept** when they asked first, or a disabled **Request sent** once asked). A friend's sheet says "your friend" on the line under the name, with no key. The foot is now Report, Block, then Done last (Done used to come first). In the crew's chat, a message's face and handle open the same sheet. It uses the request People's Invite sends (`POST /api/friends/request`); the phone keeps what you sent as Invite does, under `apex.sentRequests`. No backend change. The e2e crew page flow sends the request to @sam, sees Request sent stick, and sees @cara as a friend. APP_REVIEW 1.2 says so.
- Next: keep making social actions one tap where people already are.

# CALL SHEET

## 2026-11-13: Add friend on a crew-mate's sheet
- What: web/crew_page.js `member` shows the key; web/cockpit.js passes `friendOf` and `addFriend` to the crew page.
- Why: Nate wants social to feel like any major social app, where a person you meet in a group is one tap from a friend. Before, the sheet held only Report and Block.
- Undo: drop the `key` row in `member` and the two hooks.
