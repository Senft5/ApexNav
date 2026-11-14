# STATE

## 2026-11-14 A friend's roadbooks on their profile (free roamer B)
- Done: a friend's profile (People → a friend) lists their roadbooks you may open (Friends or Public, with a road), each a row that opens the book. Nothing shows when they have none.
- Code: `ofFriend` in web/roadbooks.js (reads GET /api/roadbooks/friends from #837, by their handle); the profile's `extra` in web/cockpit.js.
- Tests: the e2e "friend profile: a friend on People → Profile" checks only that friend's book is listed (fails on main).
- Next: a crew's roadbook (needs a crew column on roadbooks, a migration).
