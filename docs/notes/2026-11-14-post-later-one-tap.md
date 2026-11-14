# STATE

## 2026-11-14: The one-tap Post waits for signal too
- Done: the drive card's one-tap "Post to friends" (which landed on main alongside #719) now queues with no signal the same way the Post sheet does (`drive_posts.js post` → `page.later`); the e2e "a drive posted with no signal…" covers both keys. It had gone red on main because the flow's first key had become the one-tap post.
- Next: none here.
