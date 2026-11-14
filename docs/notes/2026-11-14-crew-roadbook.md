# STATE

## 2026-11-14 A crew's roadbook: every member adds roads (free roamer B)
- Done: a roadbook can be kept with one crew its keeper is in (Edit → Crew: None / your crews; or + on the crew page's
  new Roadbooks section, which starts one with the crew). Every member of that crew opens it, adds roads from a route
  card's Share, their stages or a Feed post, sees who added each ("added by @cara"), and takes out their own (the crew's
  owner any). No Follow on your own crew's book; People → Roadbooks lists them under "Your crews'". For you tells the
  crew and the keeper when someone else adds a road (one member: named; several: "2 new roads in Crew favourites.").
- Code: migration 0063_crew_roadbooks.sql (roadbooks.crew_id, roadbook_roads.added_by, both nullable, additive);
  backend/src/roadbooks.ts (`IN_CREW` in `CAN_SEE`, `addableBook`, `wantCrew`, `booksCrew`, `addedErase`), inbox.ts
  `book_roads`, account.ts (export and delete); index.ts `GET /api/crews/:id/roadbooks`; web/roadbooks.js (`ofCrew`,
  Edit's Crew switch, byline, removeKey), crew_page.js `page.books`, cockpit.js, inbox.js.
- Tests: backend roadbooks.test.ts (crew book: open, add, remove rights, export, delete, leave) and inbox.test.ts; e2e
  "roadbooks: a crew's roadbook" (fails on main); tests/test_inbox.py. Docs: SOCIAL 2.6, BACKEND, APP_REVIEW 1.2, IDEAS S-23.
- Migration 0063 must be applied by hand to preview, then prod (with its d1_migrations row) before this merges; 0062 is
  taken by the run-splits branch.
- Next: a crew roadbook's road could be a crew drive's route in one tap (crew_events plan from a book road).

# CALL SHEET

## 2026-11-14 A crew's roadbook is one column on roadbooks, not a crew-owned book (free roamer B)
- What: a crew book stays a member's book (`owner`) with `crew_id`; the keeper alone renames, reorders, deletes or
  makes it public. Members add and remove their own roads. Unlinking keeps the roads members added.
- Why: no new table, the visibility rules, reports, stamps and follows all keep working unchanged; a crew-owned book
  would need ownership transfer when the crew's owner leaves.
- Undo: drop the two columns and the index (the migration's header says how); the web hides crew parts when `crew` is
  null.
