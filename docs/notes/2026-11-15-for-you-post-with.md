# STATE

## 2026-11-15 For you: "@alice posted a drive you were on"
- Done: when a crew-mate posts a drive to the crew and you were both marked at one of that crew's drives that day, For you says "@alice posted a drive you were on: Skyway run." with Open (kind `post_with`, backend/src/inbox.ts). It matches the post's own "With you" line (#885), shows only while you can see the post, never for your own post, never across a block. Tests: vitest inbox "a crew-mate's post of a crew drive", pytest test_inbox.
- Next: the same as a push (a `post_with` kind in push.ts) if For you alone is too quiet.

# CALL SHEET

## 2026-11-15 No push for "a drive you were on", for now
- What: it shows in For you (and its badge) only. Why: the post itself already pushes nothing to the crew, and a crew drive of eight would send seven pushes at once; For you is enough to start. Undo: add a `post_with` push kind in backend/src/push.ts after postCreate.
