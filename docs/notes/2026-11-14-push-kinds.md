# STATE
## 2026-11-14 A switch per notification kind
- Done: under Garage → Settings → Notifications, five switches (Friend requests, Kudos, Comments and mentions, Duels,
  Crew drives). `notify` skips a kind the person turned off. KV `pushoff/<user id>`, no migration, erased on Delete
  account. `GET/PUT /api/push/kinds`.
- Next: tag friends you drove with on a post (asked Nate for the go on its column).
