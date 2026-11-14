# STATE
## 2026-11-14 Find people by handle as you type
- Done: on the Invite sheet, typing a handle lists matching members (handles that start with it, the exact one first,
  then friends, 8 at most). Each row has Add, or Accept when they asked you, or Friends / Sent. `GET /api/users/search`
  (`userSearch` in `backend/src/social.ts`), `finder`/`searchQ`/`stand` in `web/people_suggest.js`. No migration.
- Next: Challenge back / Rematch on a ghost duel once the analysis thread's #782 merges.

# CALL SHEET
## 2026-11-14 Search by handle prefix, members only, two characters at least
- What: any member can look up other members by the start of their handle.
- Why: handles are already shown to any member (Feed, crews, boards). Two characters and eight results keep it a way to
  find someone you know, not a directory to page through. Blocked and report-hidden people never show.
- Undo: drop the `/api/users/search` route and the `finder` call in the Invite sheet (cockpit.js).
