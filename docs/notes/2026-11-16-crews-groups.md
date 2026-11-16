# STATE

## 2026-11-16 Crews are groups
- Done: a crew's page reads like a group: cover, name, "Private crew · 3 members", the friends of yours in it, and Joined (Manage for the owner) / Invite / Chat keys. Tabs: Posts (next drive pinned), Drives, Chat, Board, Members. Members is the full list with search; the owner removes a member from their sheet (`DELETE /api/crews/:id/members/:handle`, backend/src/social.ts `crewRemoveMember`, same cleanup as leaving). Tests: tests/test_crew_groups.py, backend/test/crews.test.ts "the owner removes a member", e2e crew page flow.
- Next: step 4, the post ready after a drive (mockup Magic in the Social design); then split the crew settings sheet into Manage crew and Your settings.

# CALL SHEET

## 2026-11-16 A drive soon opens the crew on Drives
- What: the crew page opens on Drives when the crew's next drive starts within 48 hours, else on Posts.
- Why: "knows what you want before you do": the day before and the morning of, Going is what a member came for.
- Undo: pass 'posts' as the first tab in `crew_page.js` draw.

## 2026-11-16 Owner removal reuses leaving's cleanup
- What: removing a member deletes the same rows as that member leaving (grants, board entries, drive scores, shared segments, crew links, membership).
- Why: one rule for "no longer in the crew"; no migration, no ban list (a removed person can be re-invited).
- Undo: give `crewRemoveMember` its own batch, or add a ban table if Nate wants removed people kept out.
