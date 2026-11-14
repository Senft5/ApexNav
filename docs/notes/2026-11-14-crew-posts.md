# STATE
## 2026-11-14 A crew's posted drives on its page
- Done: the crew page's Drives tab lists the drives its members posted to the crew ("Posted to the crew", after
  Members, three then See all). `GET /api/feed?crew=` uses the Feed's rules, so only members see them.
  `crewDrives` in `web/drive_posts.js`, `page.posts` in `web/crew_page.js`. No migration.
- Next: Challenge back / Rematch on a ghost duel once the analysis thread's #782 merges.
