# STATE

## 2026-11-13: the Share road feel switch comes from /api/me
- The app read one flag, members.contribute, by fetching the whole export (GET /api/me/export: every table of the account, about 55 statements in one batch). It did this at every drive start, every 10 minutes for ambient sharing, before each road-data flush, and on every People/Garage render. On D1 Free that spends the daily 5M rows read for nothing. `/api/me` now returns `contribute` (the same query that reads `photo_id`), and web/sync.js `roadShare`/`contributionEnabled` and the Garage/People render read it there. The export is fetched only when you ask for your data.
- Old app builds keep working: the export still has `member.contribute`.
- Tests: test_road_carry.py fakes /api/me, and a guard checks sync.js never asks for the export. Full e2e passed; two flows failed only under 4-shard CPU load and passed alone.
- Next: nothing open here.
