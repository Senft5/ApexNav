# STATE

## 2026-11-14 Your friends' roadbooks, without a link (free roamer B)
- Done: People → Roadbooks lists "From friends": your accepted friends' Friends or Public books with a road in them, newest first, the ones you already follow left out. Until now a friends book could only be opened from a link its owner sent, so "Friends" sharing reached nobody unless they also copied a link.
- Code: `booksFriends` and `GET /api/roadbooks/friends` in backend/src (no migration; the friendships and blocks rules are the existing `CAN_SEE`); `friendsBox` in web/roadbooks.js `section`.
- Tests: backend/test/roadbooks.test.ts "your friends' books with a road in them are listed…" (private, empty, strangers' and blocked books left out, cards only, signed out 401); e2e "roadbooks: a planned road goes into a new roadbook" checks From friends (fails on main). docs/BACKEND.md names the endpoint.
- Next: a crew's roadbook (needs a crew column on roadbooks, a migration).
