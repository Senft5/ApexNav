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
- **Real time (owner decision 2026-10-25):** no holding period and no nightly job. A drive streams as chunks (a run of 5 m bins on one road); each chunk is merged into `road_bins` and paid in the same request. A retried chunk is recognised and merged once.
- Client trims a random 0.5–1.5 km at each end of a trip, skips residential/service ways, spreads one trip's upload over days.
- **Small-group caveat:** with under 20 users, "at least k contributors" hides little. `min_contributors` is a setting (friends phase: 1,
  data visible to signed-in members only). Raise to 3 before any public launch.

## 4. Points ("Octane")
- **km of newly mapped road × multiplier, per road segment and direction** (one OSM way, one direction): **1st 3×, 2nd 2×, then 1×.**
- Order is by **arrival**: the first person to upload a road+direction gets 3x, the second 2x, everyone after 1x. A person earns points on their **first drive** on a road only (later drives still improve the data). All chunks of one drive keep the multiplier its first chunk earned. Points land immediately; public: totals only, never who was first. An offline phone that uploads late simply ranks later.
- Anti-cheat (no device attestation exists, so cheap checks): value ranges and contiguity checks, 600 km/day and 1,500 km/week caps, 300 uploads/hour, `driven_on` within 14 days of upload. The cross-account replay check was removed with the holding period (nothing to compare against); with an invite-only group of friends that risk is accepted. Privacy: the server keeps no coordinates, no times beyond the day, and `rank_slots`/`seen` hold only HMAC values keyed by a server secret.

## 5. Data model (backend/migrations, D1 = SQLite)
Applied to both `apexnav-db` and `apexnav-preview-db`: **0001_init.sql**, **0002_segment_sharing.sql**, **0003_camber_count.sql**, **0004_realtime_ingest.sql**.

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
- **In-app convoy invites (IDEAS S-22):** `POST /api/convoy/:id/invite-people {handles}` (leader only, up to 15) invites accepted friends and private crew-mates; anyone else, and either side of a block, is skipped silently. The room keeps `invited[userId] = {at, until}` (30 min, never past the convoy), the invitee's `ConvoyIndex` keeps `{name, from, expiresAtMs}` (newest 10). `GET /api/convoy/invites` lists them, `POST /api/convoy/:id/accept {consent:true}` joins with the same checks as a link (an invite older than a leave can't bring someone back; it is used up by the join), `DELETE /api/convoy/invites/:id` dismisses. The leader's link is not rotated. The page polls once a minute while open and toasts a new one (`backend/test/convoy_invites.test.ts`).
- **Hazard reports (IDEAS Q-15/Q-16, migration 0011):** `POST /api/hazards {kind, lat, lon, heading?}` (members; 30 a day; the same kind within 50 m of a live one confirms it instead), `GET /api/hazards?lat&lon&km` (members; live ones within `km` ≤ 50, nearest first, never the reporter), `POST /api/hazards/:id/vote {still}` (one vote per person; still pushes the expiry out by the kind's life: pothole 7 d, gravel 1 d, closure 12 h, debris 3 h, police 1 h, animal 30 min; two or more "gone" outvoting confirmations end it). Account deletion keeps a report but not who made it; the export lists your own. The daily sweep deletes reports a day after they expire (`backend/test/hazards.test.ts`).
- **Invite previews** (`POST /api/crews/invite/preview` `{token}`, `POST /api/convoy/preview` `{invite}`): members only, the same checks as a join in the same order, and nothing changes. A crew preview gives name, visibility, member count and the owner's handle; a convoy preview gives name, the leader's handle (never a real name), size and end time, never the other members. A crew invite (preview and join) answers like an unknown token across a block with the owner, either way, and for a crew that was reported or removed, so nobody learns they were blocked; a full convoy answers 409 before the block check, like a join (`backend/test/previews.test.ts`). Links never join on their own: the page asks with these.
- **Real names** (the Google display name) reach only the person and their accepted friends. Crew member lists, boards and a request you sent (before it is accepted) show the handle only: anyone can join a public crew, and anyone who knows a handle can send a request (`backend/test/names.test.ts`).
- **Rate limits** (`backend/src/ratelimit.ts`, Cloudflare rate limiting bindings in wrangler.jsonc, free): every write 60/min per session (per IP signed out), sign-in start and app code exchange 20/min per IP (not the Google callback or logout); over the limit is `429 rate_limited` with `retry-after: 60` (road uploads already retry on 429). Reads are not limited. Per-feature caps (uploads/hour, km/day, crews, highlights/day) stay on top.
- **Crash reports** (`POST /api/errors`, `backend/src/errors.ts`; client `web/errors.js`, loaded first on every page): uncaught errors and unhandled rejections, at most 5 per page load, anonymous (no cookie, no bearer; the app origin may post it signed out). Message, stack and page path are scrubbed on the phone and again in the Worker (URL queries, e-mails, precise numbers, token-like strings). Each one writes a `client_error` log line (Cloudflare → Workers → apexnav → Logs) and adds one to today's row in `error_counts` (migration 0010: day, source ios/web/server, kind, scrubbed message, page, count, first stack; no user, session or IP; 500 distinct rows a day, then one overflow row; kept 30 days). The Worker's own 500s are counted there too, under the route pattern (`GET /api/crews/:id/members`, never the concrete path). The owner reads the last 1-30 days, most frequent first, at `GET /api/ops/errors?days=7` (404 for anyone else); with D1 access alone: `SELECT * FROM error_counts ORDER BY day DESC, n DESC`.
- **Garage** (`garage.ts`, migration 0008): a car card is shown only when its owner switches `shared` on, and then only to accepted friends and
  members of the same **private** crew (anyone can join a public crew, so it doesn't count), never across a block either way, never for an owner with no
  handle. No owner id, location or drive data is in it. Ten cars at most (checked inside the insert); always exactly one primary while you have any.
- **Block and report** (`safety.ts`, `reports_sql.ts`, migration 0009): block by id or handle (unknown handles answer like real ones), list and
  unblock your own blocks (never who blocked you; unblocking restores nothing). `POST /api/reports` covers people, crews, cars and highlights, only
  ones the reporter could see (else 404), one per person per target, 20 a day (checked before any lookup, so no handle oracle). Open reports from
  three current members **invited by different people and not by one another** (one member's spare accounts count once) take a public crew off discovery and public join, a car out of
  friends' garages, a highlight off the map, until the owner (OWNER_EMAIL) decides in `GET /api/moderation` (shows reporters and who invited them).
  Dismiss closes those reports for good (the same people can't re-trigger it). Remove keeps it down (`status='removed'`; the owner of a crew or car
  can't make it public/shown again); for a person it is a ban: membership, sessions, app sign-in codes and unused invites go, their crews turn
  private and cars unshown, live convoys drop them, and no invite (nor their own) lets them back, even after deleting and re-creating the account (bans are keyed on the Google account). Export and account deletion need only sign-in.
- Invites and sessions are stored as SHA-256 hashes; an invite works once, expires after 7 days, and is redeemed atomically.
- Verified by `backend/test/*.test.ts` (76 tests; each privacy rule was checked by temporarily reintroducing the bug and seeing the test fail).

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
| Database | D1 `apexnav-db` (US East); previews use a separate empty `apexnav-preview-db` (`previews` block in wrangler.jsonc; apply every migration to both). Migrations in `backend/migrations`; applied through the Cloudflare connection; CI runs the same SQL in tests |
| Status checks | `.github/workflows/status.yml` every 30 min: site, `/api/health` (Worker + D1) and the free routing, tile and elevation services; a core failure opens an `outage` issue: docs/STATUS.md |
| Backups | D1 Time Travel (7 days) plus a monthly `wrangler d1 export` kept by the owner, restore drill every 3 months: docs/BACKUPS.md |
| Merging | In the upload request (`backend/src/contribute.ts`): one atomic SQL upsert per bin (running mean/variance), points written immediately. No cron, no nightly job. |
| Convoy (later) | Durable Objects + WebSockets |
| Photos, routing tiles, backups | R2 (free allowance, no download fees) |
| CI | `.github/workflows/core-tests.yml` job `backend`: type check, vitest, `wrangler deploy --dry-run` |
| iOS | Every main run that builds the app uploads it to TestFlight (job `testflight`, App Store Connect API key, automatic signing): docs/TESTFLIGHT.md. The unsigned sideload IPA is still built too. CarPlay needs Apple's separate CarPlay entitlement |
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
Built: migrations 0001–0005 (live; 0005 = `app_auth_codes`, applied 2026-10-26 with `wrangler d1 execute --file` to both databases, since `d1_migrations` only records 0001), auth, invites, friends, blocks, crews, grants, boards, segments (with sharing), highlights API, **real-time road-data intake** (`POST /api/contribute`, opt-in `PUT /api/me/contribute`: ranges, contiguity, km/hour caps, idempotent chunks, merge and 3x/2x/1x points in the same request) and `GET /api/points` (own weekly totals + a handle/total board), **account export + deletion** (`GET /api/me/export`, `DELETE /api/me` with `{confirm:"DELETE"}`: erases everything tied to the person, dissolves crews they own, removes what others held about them; merged road data is anonymous and stays), 76 tests, CI job, Worker wiring + cron.
Phone side: `web/contributor.js` (map-match with Valhalla, way geometry from Overpass, bin by arc length along the way; spec in section 3). Next: (1) owner sets the Google secrets, `OWNER_EMAIL` and `PEPPER`; (2) web sync (IndexedDB → `/api/segments`, `/api/board`, `/api/highlights`) and a phone-side contributor that builds bins from a profiled drive;
(3) read side: serve merged `road_bins` to the phone and feed measured data into stage scoring; (5) convoy.

## iOS app access (ios-api, 2026-10-26)
The app serves `web/` from `apexnav://app`, so `/api` is cross-origin to the Worker. `web/sync.js` `ApexSync.apiFetch` sends
`https://apexnav.senftns.workers.dev` + path with `Authorization: Bearer <session token>` in the app and the same-origin cookie on the web.
The Worker answers CORS only for `Origin: apexnav://app` (no credentials); writes from that origin need the bearer token (no cookie CSRF path).
Sign-in: Google refuses embedded web views, so the shell opens `ASWebAuthenticationSession` on `/api/auth/google/start?app_challenge=<S256 of verifier>`;
the callback redirects to `apexnav://auth?code=…` (single use, 2 min, stored hashed in `app_auth_codes`) and the shell trades
`{code, verifier}` at `POST /api/auth/app/exchange` for a session token, handed to the page (`onNative({type:'session'})`, kept in localStorage).

**Sign in with Apple (app only, IDEAS O-05):** the shell runs `ASAuthorizationAppleIDProvider` with the sha256 hex of a one-time nonce and posts `{id_token, nonce, name}` to `POST /api/auth/apple` (`backend/src/apple.ts`). The Worker verifies the RS256 signature against `https://appleid.apple.com/auth/keys` (cached an hour, refetched for an unknown kid), then `iss`, `aud` = `com.senft.ApexNav`, `exp` and the nonce, and returns a session token like the code exchange. The account is `users.google_sub = 'apple:<sub>'` (the column holds the sign-in identity, so bans apply); Apple's name arrives only on the first authorization and is kept; a hidden email is Apple's relay address. Not yet: revoking the Apple token on account deletion (needs a Sign in with Apple key from the owner, docs/OWNER_TODO.md).
