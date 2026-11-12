# STATE
## Session 2026-11-11 (security pass): photos by circle, report abuse, public crews' private chat, relay limit (claude/project-thread-4lms1f)
- Took over the Worker API security pass from roam-c (its entries list what was checked: auth, CSRF, rate limits, :id
  ownership, grants on read, time attack, convoy membership, hazard and report caps; #423 and #424 were roam-c's).
- photos.ts `PHOTO_SEEN(p)` (viewer ?1): owner; else not hidden, not reported by you, no block either way, and by kind:
  profile any member, car `CAR_SEEN`, post the build's car `CAR_SEEN`, crew/crest crew members. Used by `photoServe` (the
  moderator bypasses), `photoList`, and safety.ts `resolveTarget` (you report what you see, or already reported).
- `photoHiddenSql`: the one-report day-long hide counts only reporters who pass reportedSql's gate (invited or a member 7
  days). safety.ts `fileReport`: re-filing updates the note, never `created_at` (it restarted the day forever).
- Migration 0056_crew_public_since (crews.public_since; public crews backfilled to the time it ran; applied on preview and
  prod). Set by crewCreate (public) and crewUpdate (private to public). crew_page.ts `CHAT_READABLE(c)`: hidden only when
  the crew is public, the message predates public_since and the viewer joined after it. In `chatList`, `crewFeed`, and
  the pinned message (unless the crew's owner wrote it).
- ratelimit.ts `RELAYS` (/api/ctx/osm, /api/ctx/trace, /api/ctx/workzones): `RELAY_LIMIT` per IP, 300/60 s (wrangler.jsonc
  namespaces 1005 prod, 1006 previews). `?diag=1` on /api/ctx/osm: moderator only.
- Tests: photos.test.ts (+2), crew_page.test.ts (+1), ratelimit.test.ts (+1). privacy.html, APP_REVIEW.md updated.
- Next: highlights (Spots) list ignores blocks and ratings are one-per-account (sybil); a read rate limit for member GETs.

# CALL SHEET
## 2026-11-11 (security pass): photos only to whoever sees what they belong to; a fresh account's report no longer hides one (claude/project-thread-4lms1f)
Any signed-in member could fetch any photo by its id, and list any car's or crew's gallery by its id: a car you hadn't
shown, a private crew's cover, or a photo someone kept after leaving a crew. Now a photo goes only to whoever sees the
thing it belongs to (a car's to those who see the car, a build step's to those who see the build, a crew's cover and crest
to its members); a profile photo still goes to any member, as a handle does. One report used to take a photo down for
everyone for a day, and filing it again restarted the day, so one account made a minute ago could keep any photo down for
good. Now the reporter stops seeing it at once, and everyone else only when the reporter was invited or has been a member
a week. Undo: revert photos.ts PHOTO_SEEN and photoHiddenSql, safety.ts fileReport.

## 2026-11-11 (security pass): a crew's private-days chat stays with who was there when it goes public (claude/project-thread-4lms1f)
A crew remembers when it last became public (`crews.public_since`, migration 0056); someone who joins after that reads
only what was written from then on. Members from before keep everything; a private crew is unchanged; a pinned message
the owner wrote stays. Crews public today start from the moment the migration ran. Undo: remove `CHAT_READABLE` from
crew_page.ts (the column can stay).

## 2026-11-11 (security pass): the map relays are limited per address (claude/project-thread-4lms1f)
The three relays a phone uses while planning need no account, and every miss asks a free public service (Overpass,
Valhalla, a state feed) from our Worker. Now each address gets 300 relay requests a minute (a plan asks at most 12 tiles),
and the relay's mirror check (`?diag=1`) is the owner's alone. Undo: drop `RELAY_LIMIT` from wrangler.jsonc, or raise it.
