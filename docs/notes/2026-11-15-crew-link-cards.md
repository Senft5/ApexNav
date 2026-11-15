# STATE

## 2026-11-15: a public crew's invite link names the crew in its card
- Pasted into Messages, Discord or a group chat, a public crew's invite link (`?crew=<token>`) shows "Ridge Runners · a crew on Vetta" and "2 drivers · Robbinsville. Sunday mornings", and the page's title takes the name (backend/src/link_preview.ts).
- Only a live invite to a public crew, sent by someone still in it, as joining would take it (social.ts CREW_INVITE_OK without the viewer's blocks). A private crew, an expired or reported link keeps the plain "A crew on Vetta" line. The card's own link is the front page, never the token.
- Tests: backend/test/link_preview.test.ts. Next: the signed-out People page could name a public crew's link the same way ("You have a crew link"), which needs a signed-out preview for public crews only.

# CALL SHEET

## 2026-11-15: public crews named in link cards, private ones not
- What: the card for a public crew's invite names it, with its member count, area and about line.
- Why: a public crew already shows exactly those to non-members (social.ts); a named card gets more taps in a group chat than "A crew on Vetta". Private crews stay unnamed: their name is for members.
- Undo: remove the `crew` branch in previewFor.
