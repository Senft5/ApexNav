# STATE
## Session 2026-11-12 (privacy pass, Download my data): road data still tied to you is in the export (claude/project-thread-4lms1f)
- backend/src/account.ts exportMyData adds `road_data_waiting` (ingest_pending: way, direction, day, km of drives not yet
  merged, at most 14 days), `road_data_uploads_by_hour` (upload_counts), `road_first_drives_held` (rank_slots still
  holding your id) and `stage_shares` (who each of your stages is shared with, by handle or crew name). The note line
  says merged road data is anonymous once merged.
- Tests: backend/test/account.test.ts (+1 check).
- Checked: every other table holding a user id is in the export or holds no person (hmac holders, sessions, bans).

# CALL SHEET
## 2026-11-12 (privacy pass, Download my data): the export lists road data not yet anonymous (claude/project-thread-4lms1f)
The export said road data is anonymous and left it out, but drives waiting to merge (up to 14 days), the hourly upload
counts and the first-driver places still carry the person's id until they merge or freeze. They are now listed, without
the per-bin numbers of a waiting drive (way, direction, day and km say what it is). Undo: drop the four keys.
