# STATE

## 2026-11-14 Who came along, on a crew post
- Done: a post to a crew now says "With you and @cara" (or "With @bob, @cara and 2 others") under its name when its author was marked at one of that crew's drives that day. The names are the others marked there in the crew drive's record (`crew_event_attendance`: "I was there", or starting or joining the drive's convoy). At most five come from the server, never anyone blocked either way with the viewer, never from a cancelled drive, and never on a post to friends. `with` on every post the Feed returns (backend/src/drive_posts.ts `WITH_SQL`), `withLine` in web/drive_posts.js. No migration. Tests: vitest "who came, on a crew post", pytest `test_with_line`, e2e "the full Feed picks".
- Next: tag friends you drove with on a post to friends still needs its own column (Nate's go).

# CALL SHEET

## 2026-11-14 "With" comes from the crew drive's record, not from tags
- What: who came is read from the attendance the crew already keeps, so nobody tags anyone and no table changes. Why: a tag needs a column (the owner's go), while the record already exists and is already visible to the crew; a post to friends goes to people outside the crew, so it shows no names. Undo: drop `with_handles` from SELECT in backend/src/drive_posts.ts and the `feed-with` line in web/drive_posts.js.

## 2026-11-14 The drive's day matches the post's within 14 hours
- What: a crew drive counts for a post when the post's day (the phone's) falls within 14 hours either side of the drive's UTC start. Why: an evening drive in Ohio starts on the next UTC day. Undo: `date(e.starts_at, '±14 hours')` in WITH_SQL.
