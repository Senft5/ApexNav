# STATE

## 2026-11-16 Crew admins
- Done: `crew_admins` (migration 0069, applied by hand to preview then prod before merge). The owner's ··· on a member: Make admin / Remove as admin (`PUT`/`DELETE /api/crews/:id/admins/:handle`, 10 at most). Admins sit under the owner in Members, marked ADMIN; they invite even with "Who can invite: Owner" (their links survive that switch), remove plain members, delete chat messages, and change or cancel crew drives. `crewMembers` returns `admin`; the crew page returns `is_admin`. Leaving or being removed drops the role. Tests: backend crews and events; e2e "crew page: an old ?view=crew link…"; `tests/test_crew_page.py` order.
- Next: Manage crew could list the admins in one row; posts to a crew are still only their author's to delete (reports cover the rest).

# CALL SHEET

## 2026-11-16 What a crew admin can do
- What: invite (even when the owner keeps invites), remove plain members, delete chat messages, change or cancel crew drives. Not: rename, settings, livery, other admins, deleting the crew.
- Why: Nate chose "Yes, build admins" (Facebook Groups shape); these are the jobs a club crew needs help with when the owner is away. Settings stay the owner's so a crew can't be taken over.
- Undo: drop the `crew_admins` checks in `backend/src/social.ts`, `crew_page.ts`, `events.ts` (the table can stay empty).
