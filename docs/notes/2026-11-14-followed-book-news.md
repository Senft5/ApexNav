# STATE

## 2026-11-14 For you says when a roadbook you follow gets a road (free roamer B)
- Done: For you (People → Friends) has a Roadbook row when the owner of a book you follow adds roads after you followed it: "@cara added Cherohala Skyway to Smokies classics." or "@cara added 3 roads to Smokies classics.", with Open. One row a book, the last 14 days, only while you may still open the book (made private, unfriended or blocked: nothing). Following a book used to bring stamps only; nothing told you it grew.
- Code: backend/src/inbox.ts (`book_roads`, using roadbooks.ts `CAN_SEE`, now exported); web/inbox.js `line`. No migration (roads and follows already keep when).
- Tests: backend/test/inbox.test.ts (a road before the follow isn't news, the owner gets nothing, two roads count, a private book says nothing; fails on main); tests/test_inbox.py lines for one and three roads. docs/SOCIAL.md 2.10.
- Next: push the same line when APNs pushes For you items (the push thread's list).
