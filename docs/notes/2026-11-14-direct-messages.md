# STATE
## 2026-11-14 Direct messages between friends
- Done: People → Friends has a Messages row (its count is what you haven't read, also on the People badge) that opens
  your conversations, newest first. A friend's profile has Message as its first key; a push's tap opens the conversation
  (`?chat=`). A conversation is bubbles (yours on the right), a field and Send (Return sends); it looks again every 10 s
  while open. A tap on a bubble: Unsend yours, Report theirs. Garage → Notifications has a Messages switch.
  `backend/src/messages.ts` (GET/POST `/api/messages/:handle`, GET `/api/messages`, GET `/api/me/messages/unread`,
  DELETE `/api/messages/m/:id`), `web/messages.js`, migration 0065 `direct_messages`.
- Next: Challenge back / Rematch on a ghost duel once the analysis thread's #782 merges.

# CALL SHEET
## 2026-11-14 Direct messages are friends only, kept a year, and polled
- What: only accepted friends can write to each other; unfriending keeps the history readable and stops new messages;
  a block hides the conversation both ways. Messages are swept after 365 days. An open conversation polls every 10 s
  instead of a live socket.
- Why: friends-only means no unsolicited messages from strangers (App Review 1.2, the owner's "easy as a big social
  app" without a spam surface); a year bounds what we keep; polling needs no Durable Object and costs one small read.
- Undo: `dmSend` in `backend/src/messages.ts` (drop the `friends_only` check to allow any member), `DM_KEEP_DAYS`, and
  `POLL_MS` in `web/messages.js`.

## 2026-11-14 Messages sits at the top of People → Friends
- What: the Messages row is under a waiting friend request and above You and the friend list.
- Why: it is the inbox, and that is where every social app puts it; the People badge counts its unread too.
- Undo: move the `messages.row(...)` block in `renderAccount` (web/cockpit.js) below the friend list.
