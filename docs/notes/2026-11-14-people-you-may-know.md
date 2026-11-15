# STATE
## 2026-11-14 People you may know
- Done: People → Friends shows up to 8 suggestions (crew-mates, friends of 2+ of your friends) with Add and ×.
  `GET /api/friends/suggested`, `web/people_suggest.js` (lazy, social group). No migration.
- Next: Challenge back / Rematch key in #dvGhostActs once the analysis thread's #782 merges.

# CALL SHEET
## 2026-11-14 Friends of friends are suggested by count only
- What: a friend-of-friends suggestion says "2 friends in common", never which friends; it needs two in common, so one
  friendship alone never surfaces a stranger. Crew-mates are named by the crew (its members see each other already).
- Why: Nate dropped the ultra-privacy focus and wants social as easy as big apps; this keeps the graph itself unshown.
- Undo: drop the `fof` branch in `friendSuggestions` (backend/src/social.ts) to suggest crew-mates only.
