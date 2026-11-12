# STATE
## Session 2026-11-12 (Download my data): the export names every table that holds your data (claude/project-thread-g9yher)
- Done: `exportMyData` (backend/src/account.ts) left out eight tables: your recent positions kept for friends on the map, builds you follow, kudos given and received, your Still there / Gone answers, account and crew invites you made, ETA shares and livery grants. All eight are in it now (no secret token, and other people only as what the app already shows you).
- New guard: `tests/test_export_complete.py` fails when a table with a column pointing at a user is in neither the export nor its short TECHNICAL list (sessions, sign-in codes, upload caps, the road-data queue, rank slots, pioneer hours), each with why.
- All eight were already deleted with the account (foreign keys cascade).
