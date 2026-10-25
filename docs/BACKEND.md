# APEX NAV — BACKEND, DEPLOYMENT AND DISTRIBUTION

Status: **foundation built and tested; not yet serving real users.** Stack decision (owner, 2026-10-25): all-Cloudflare
(Workers + D1). Related: docs/SOCIAL.md (features and privacy model), docs/ROAD_INTELLIGENCE.md (what the road data means).

## 1. Principles
1. **Local-first.** Everything works with no account and no server: recording, scoring, segments, routing, voices.
   An account adds sync and social. A server outage never stops the cockpit.
2. **The server holds the least it can.** Merged per-road numbers, scores the user chose to share, relationships.
   Never a trace, never a raw recording, never audio of anyone's voice.
3. **Phones never talk to the database.** Only the Worker API does; there is no public database key to misconfigure.
   Authorization is code in one place (`backend/src`), covered by tests that fail the build if a privacy rule breaks.
4. **Zero budget, no lock-in.** Free tiers; D1 is SQLite and exports as plain SQL.
5. **Proprietary.** All rights reserved (LICENSE). Third-party notices in THIRD_PARTY_NOTICES.md.

## 2. Vocabulary
- **Bin**: a 5 m stretch of road, identified by (OSM way id, direction, bin index). Holds what the *road* is like (banking,
  roughness, crest). No speed, no time, nothing about the driver.
- **Trace**: the whole recorded path with timestamps and speeds. Reveals home, routine and speed. **Never uploaded.**
- **Pass**: one drive over a segment, scored (Driver Score, optional private time). Stays on the phone unless shared.
- **Segment**: a user-made stretch of road. A friend can *adopt* a shared segment; copies stay linked (`origin_id`) so boards line up.
- **Stage**: a road worth driving (web/stages.js); a route is stages plus connectors. **Highlight**: a user-added scenic point, rated by members.

## 3. Crowdsourced road data with local-first
```
drive → phone profiles it (core/ApexKit, offline) → [opt-in + online] → bin summaries, shuffled, in batches
      → Worker: validate, hold ≤14 days for ranking, nightly merge into per-bin aggregates, award points
      → phone downloads merged values for roads it drives (cached, versioned)
```
- Contributing is opt-in per account (default off). Without it nothing leaves the phone.
- Client trims a random 0.5–1.5 km at each end of a trip, skips residential/service ways, spreads one trip's upload over days.
- **Small-group caveat:** with under 20 users, "at least k contributors" hides little. `min_contributors` is a setting (friends phase: 1,
  data visible to signed-in members only). Raise to 3 before any public launch.

## 4. Points ("Octane")
- **km of newly mapped road × multiplier, per road segment and direction** (one OSM way, one direction): **1st 3×, 2nd 2×, then 1×.**
- Order is by **drive date**, so an offline phone keeps its place. Slots re-sort by `(driven_on, received_at)` for 14 days after the
  first drive, then freeze. One account, one rank per way and direction. The second contributor also verifies the first.
- Totals are published weekly (`points_ledger`); public: points only, never who was first.
- Anti-cheat (no device attestation exists, so cheap checks): per-bin curvature must correlate with the claimed OSM polyline and cover
  ≥ 60% of the way; 600 km/day and 1,500 km/week caps; 30 uploads/hour; `driven_on` within 14 days of upload; replays across accounts
  (per-bin vectors correlating > 0.98 with a pending upload) are quarantined; first place stays provisional until a different member's data agrees.

## 5. Data model (backend/migrations, D1 = SQLite)
Applied to the production database `apexnav-db`: **0001_init.sql** and **0002_segment_sharing.sql**.

| Group | Tables |
|---|---|
| Identity | `users` (Google sub, handle), `members` (let in by invite), `invites` (token hash only), `sessions` (token hash only) |
| Social | `friendships` (canonical ordered pair), `blocks`, `crews`, `crew_members`, `crew_invites` |
| Segments & boards | `segments` (+`origin_id`), `segment_shares`, `grants` (**opt-in, one row per friend or crew**), `board_entries` (+`canon_id`), `shared_routes` |
| Crowd road data | `road_bins`, `hazard_obs`, `ingest_pending`, `rank_slots`, `seen`, `points_ledger` (private tables: no API route reads or writes them directly) |
| Highlights | `highlights` (author hidden), `highlight_ratings` (1–5, `visited` proved on the phone), `reports` |

## 6. Authorization model (what the tests prove)
Implemented in `backend/src/{auth,social,segments}.ts`, one router in `index.ts`.
- **Gate**: signed in (Google) AND a member (invite or owner bootstrap). Anonymous or un-invited sessions read nothing.
- **State-changing requests** must carry our own `Origin` and an `X-ApexNav: 1` header (CSRF), on top of `SameSite=Lax`, `HttpOnly`, `__Host-` cookies.
- **Sharing is opt-in per friend and per crew**: a score reaches an audience only through `POST /api/board` and only if a grant for that
  audience exists. `GET /api/board/:canon` returns only entries published **to the viewer**, by someone who is still their friend / crew-mate, whose grant is
  still on, and not blocked either way. Times appear only with `share_times`.
- Unfriend, block, leave crew, revoke grant: the grants and published entries between those people are deleted in the same transaction.
- Friend requests answer identically for unknown, non-member and real handles (no handle enumeration). The requester cannot accept their own request.
- Invites and sessions are stored as SHA-256 hashes; an invite works once, expires after 7 days, and is redeemed atomically.
- Verified by `backend/test/*.test.ts` (36 tests; each privacy rule was checked by temporarily reintroducing the bug and seeing the test fail).

## 7. Auth: Google sign-in, no library
`/api/auth/google/start` → Google (authorization-code flow, PKCE S256, `state`, `nonce`) → `/api/auth/google/callback`: exchanges the code
server-side, checks `iss`, `aud`, `exp`, `nonce`, `email_verified`, creates a 30-day session. The first sign-in with the `OWNER_EMAIL` secret becomes the
first member; everyone else needs an invite. **Secrets** (set in the Cloudflare dashboard, never in the repo): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`OWNER_EMAIL`, `PEPPER`. Without them the sign-in routes answer 503 and the rest of the app is unaffected.
Google setup (owner, free): Google Cloud console → OAuth consent screen (External, publish "In production"; basic scopes only) → OAuth client (web) with redirect
`https://<site>/api/auth/google/callback`. The native sideloaded app must use the system browser for sign-in (Google blocks embedded web views).

## 8. Deployment and distribution
| Piece | Choice |
|---|---|
| Web app + API | One Cloudflare Worker `apexnav` (`wrangler.jsonc`): static files from `web/`, `/api/*` to `backend/src/index.ts`. Live at https://apexnav.senftns.workers.dev/ |
| Database | D1 `apexnav-db` (US East). Migrations in `backend/migrations`; applied through the Cloudflare connection; CI runs the same SQL in tests |
| Nightly job | A Worker cron trigger freezes rank slots, merges `ingest_pending` into `road_bins`, writes `points_ledger` (not built) |
| Convoy (later) | Durable Objects + WebSockets |
| Photos, routing tiles, backups | R2 (free allowance, no download fees) |
| CI | `.github/workflows/core-tests.yml` job `backend`: type check, vitest, `wrangler deploy --dry-run` |
| iOS | CI builds an unsigned app; testers sideload with AltStore/SideStore (free Apple ID, re-signs every 7 days). TestFlight/CarPlay need the paid account |
| Everyone else | The web app (installable PWA). iPhone Safari recording needs the screen on and a lower sensor rate |
| Domain | `workers.dev` now; buy a `.com` (~$10/yr) when it is rolling |

Going private (owner wants full control): the site is already served by Cloudflare, so make the GitHub repo private and turn off GitHub Pages.
On the free plan a private repo gets 2,000 Actions minutes a month and macOS counts 10x; `build.yml` skips docs/tests/tools/voice-only changes.

## 9. Highlights
User-added scenic points, rated by members, that can pull a route toward them (toggle + strength slider in the route panel).
- Lookup is a **bounding-box query** (`lat`/`lon` indexes) around the route, filtered by distance on the phone; no spatial extension needed at this scale.
  If it outgrows that, highlights is a small table to move to a PostGIS database.
- Built (`backend/src/highlights.ts`): members only; author never returned; 10 new per day and 200 per person; duplicates within 40 m refused; US coordinates only;
  score = (sum of stars + 6) / (ratings + 2) so one account cannot pin a spot at 5.0; the author cannot rate their own; three different reporters hide a spot.
- Author is never shown. Members only, rate-limited, report button. "Visited" on a rating is proved by the rater's own drive passing within ~150 m
  (decided on the phone; the server never sees the trace). Highlights at a user's own start points are never offered (home privacy).
- Routing: the loop planner (web/stages.js) adds a bonus to stages near a highlight, scaled by rating and capped by a detour limit.

## 10. Owner decisions (2026-10-25)
Licence all rights reserved; no charge yet; all-Cloudflare; Google sign-in; US only; under 20 users; web app first, sideload for iOS testers;
points 3×/2×/1× per direction of each road; time sharing opt-in per friend and per crew; highlights with ratings and a routing toggle.

## 11. Design review (Opus) — findings and where they went
- **P0** friend boards leaked across friends → published rows carry `audience_id`; read requires "published to me" + live grant (test).
- **P0** un-invited / anonymous sessions → `members` gate on every shared-data route (test).
- **P0** contribution data revealing where/when → pending table + two-slot ranking + hashed dedupe + weekly totals + client trimming (schema in 0001; job not built).
- **P1** anti-cheat, definer/service-role pitfalls → n/a (no RLS, no service role; one Worker is the only writer), anti-cheat list in section 4.
- **P2** magic-link email problems → no email at all; Google-only. Backups: nightly export to R2 (not built).
- Remaining tests to write when the pieces exist: ingest window/backdating/ranking, nightly merge, account deletion cascade + export, highlights rate limits.

## 12. Status and build order
Built: migrations 0001–0002 (live), auth, invites, friends, blocks, crews, grants, boards, segments (with sharing), highlights API (create, bbox list, rate, report, delete), 36 tests, CI job, Worker wiring.
Next: (1) owner sets the Google secrets and `OWNER_EMAIL`; (2) web account panel and sync (IndexedDB → `/api/segments`, `/api/board`); (3) web highlights sync (the planner bonus and local list are built);
(4) ingest + nightly merge + points; (5) account deletion + data export; (6) convoy.
