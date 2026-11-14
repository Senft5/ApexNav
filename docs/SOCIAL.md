# VETTA — SOCIAL, CROWD & DRIVE ANALYSIS PLAN

The social layer exists to (1) make the road intelligence better with every drive and
(2) make driving with friends better. It must never become evidence against its users.

## 1. Privacy model (never evidence against you, enforced in code)
| Data | Stays on phone | Shared (private group) | Public crowd map |
|---|---|---|---|
| Raw IMU / GPS trace | yes | — | — |
| Absolute speeds, timestamps | yes | convoy live only, ephemeral | never |
| Your own drive analysis, corner times | yes | opt-in "ghost" to named friends | never |
| Road physics per 5 m bin (camber, roughness, crest) | — | — | yes, speed-invariant, anonymous; shown under docs/ROAD_DATA.md §2: open roads (and unclassified roads of 1.5 km or more) from the first pass, every other road only after two different drivers |
| Corner deviation ratio `d` (ROAD_INTELLIGENCE §4.1) | — | — | yes, aggregated, under the same rule as road physics (docs/ROAD_DATA.md §2) |
| Hazard observations (hit / clean pass) | — | — | yes, bin-level, no trace |
| Trip start/end | trimmed 500 m server-side even from physics uploads | — | never |

Uploads are bin-level aggregates, never traces. Bins from one drive are uploaded unordered
and in random batches so a trace cannot be re-assembled.

## 2. Features
### 2.1 Convoy (live, private)
- Join by code/QR; group is ephemeral.
- Lead-car IMU relay: severe spike (> 0.35 g, robust 50 ms measure) or
  hard mid-corner braking (< −0.55 g) → immediate geo-pinned provisional alert and spoken warning to approaching followers. Validate thresholds against live sensor evidence. The 3 s cancel window retracts an already-sent alert; it does not delay delivery. Works independently of personal drive recording and crowd-profile verification.
- Leader calls (one tap, relayed to followers): web/convoy_ui.js `LEADER_CALLS`. Regroup.
- Gap display in time, not distance. Regroup points suggested at stage ends.
- Transport: peer-to-peer where possible (WebRTC), tiny relay otherwise; nothing stored.

### 2.2 Road pages
- Each stage gets a page: archetype, four axes, confidence level (L0/L1/L2), elevation
  profile, pace notes, verified hazards, best direction, best season.
- Reviews are structured, not free text first: "Which was better, A or B?" pairwise
  prompts after a drive feed preference learning (ROAD_INTELLIGENCE §6).

### 2.3 Crowd verification & Octane
- Octane: 1×/km for any profiled drive; 3× Pioneer for unprofiled roads (L0 → L1),
  multi-pass verification (L1 → L2), and confirming or clearing hazards / ALPR.
- Octane buys nothing that affects safety or other users; cosmetic + early features.

### 2.4 Garage
- Car profile: mass, power, tyres (μ), ride height / suspension class, width.
  Feeds the reference lap, so every score is per car.
- Shareable car cards (no location data).

### 2.5 Shared routes
- Share a planned route (geometry + pace notes) to friends or publish a stage list.
  Never a recorded drive.

### 2.6 Roadbooks (built 2026-11-10)
- A roadbook is a member's named collection of roads: each a planned shape with a name and a note, never a recorded
  drive. Private by default; Friends; or Public (opens by its link with no account, found near its roads, signed with
  the owner's handle). Followed by other members; every road has Drive it.
- A road enters a book from a route card's Share box, without the route's first 400 m, a loop's last 400 m, or anything
  inside a privacy zone.
- **Stamps are found, not tapped**: the phone marks a road driven when a drive in its own Log covers 85% of it within
  45 m (web/roadbooks.js `coverage`). The server learns only that this member drove this road, stored under a keyed
  hash (no user id in `roadbook_stamps`); it shows each road's count and the member's own progress through a book.
- Which of your books' roads a new drive might cover is decided on the phone from each road's box, so the server is
  never asked "what is near where I just drove".
- Reports and blocks as for public crews (kind `roadbook`).
### 2.7 Duels (friends, Scores only)
- Challenge a friend on one of your stages for 3, 7 or 14 days; the higher Vetta Score on it in that window wins.
  Accepting copies the stage to them. Won by the higher Score, or in a time duel (migration 0048) the quicker time;
  times count only where that side shares times with the other.
- Reads only Scores each already shows the other (grants + board entries); the card says in words when one side's
  don't reach the other. Friends only; a block or unfriend hides it. Kept 60 days after it ends. `web/duels.js`,
  `backend/src/duels.ts`, migration 0047.
### 2.8 Crew drive results (crew members)
- A remembered crew drive folds out its results: an overall, then each stage as SS1, SS2…, each driver's best Vetta
  Score that day and a place. Overall ranks by stages driven, then the mean Score. Share sends it as text.
- Only Scores already shared with the crew, among those who came; a time and its gap to the quickest only where that
  driver shares times with the crew, and the overall's total time when every stage has one. `resultsSheet` in `backend/src/events.ts`.

### 2.9 Weekly time attack (members; owner 2026-11-11)
- An area is a quarter-degree square (about 28 by 22 km, the router's road tile; a 1-degree square until the owner's
  TestFlight note 2026-11-12, "literally like an hour away from me and goes only through a neighborhood"). Each Monday (UTC) its circuit is a small loop (8 to 16 km asked, 5 to 25 km accepted) over
  the area's best roads, picked at random, never a member's stage (the owner, 2026-11-11: "autogenerated in any area we
  have users weekly, not based on user stages ... the best loops roads in the area chosen at random. Possibly small
  loops"). The server can't route, so the first phone in the area that week is handed the week's seed and builds it with
  our own router (`web/time_attack.js` makeLoop): up to six starts drawn from the seed in the middle half of the area, each
  put on the nearest through road (graph_router.js loop `through`), the router's best loops from there, one of the best
  three drawn from the seed, named by its main road. A loop with more than 500 m or 5 % of neighbourhood street
  (graph_router.js `streetM`, `streetShare`: residential streets in built-up frontage, or any residential or service road
  where that isn't known) is never picked.
  The server checks it (closed within 250 m, starts in the area, no 2 km jumps, its own length) and keeps the first; every
  other phone gets that one. Nobody's name is on it and who built it isn't kept. An area our road tiles don't reach yet
  (outside Ohio, Kentucky and Indiana today) has none. A loop taken down by a moderator is built again from the next seed.
- Enter (Where to? → Time attack this week) copies it into your Stages. The Log sends your quickest timed run on it that
  week; the board shows every entrant by handle, quickest first, with the gap and that run's Vetta Score, plus last week's
  podium. Entering is the opt-in: only entrants' times are on it, and Take my time off removes yours.
- Where it shows (built 2026-11-11): the Where to? row names the week's loop and your place before it is opened ("Time
  attack: Dry Ridge loop · you're 3rd of 12 · 3 days left"; time_attack.js summaryLine, asked when Where to? opens, at
  most every 5 minutes, never from inside a privacy zone). Drive it plans the loop itself as the route. After a drive the
  Log says your place under the board ("you're 3rd of 12 this week, 1:02 off the lead"; POST /api/timeattack/runs
  returns `places`). Someone passing you shows in For you, named by the loop. The home deck's suggestion is separate
  (Roamer C).
- The phone sends only the middle of the area, never where it is. Blocks hide people both ways. A time faster than 60 m/s
  (216 km/h) average over the stage is refused. Times are kept eight weeks. `backend/src/time_attack.ts`, `web/time_attack.js`.
- It is a public time board on public roads, which the guardrails ruled out before the owner's call; the risk and the copy
  rules are in docs/APP_REVIEW.md (1.4).
- **Challenge a friend** on the loop (entered weeks): a duel on your copy of the loop (2.7), won by time unless you pick
  Score, 3, 7 or 14 days. The friend gets the loop in their Stages on Accept; it counts on the week's board only if they enter.

### 2.10 For you (members; built 2026-11-11)
- One list on People → Friends of what happened to you, newest first, each a sentence with at most one key: a friend or
  crew-mate topped your best Score on one of your stages this week (Drive it), someone went quicker than you in this
  week's time attack (See the board), kudos on your runs, a duel accepted or decided, new followers of your roadbooks
  (counted, never named: a public book's followers may be strangers), a crew drive you haven't answered (Answer), and
  kudos and comments on your drive posts, or a new comment after yours on someone else's post, one row per post with the
  newest name and how many others (Open: the post and its comments; 2026-11-14). A comment that @mentions you on a post
  you can see shows as a Mention instead.
- The People tab's badge counts what is new since you last had People → Friends on screen, plus what waits on you
  (friend requests, duels asked of you, a crew link, convoy invites). Asked when the app opens, comes to the front, and
  every five minutes while it is in front, never while driving.
- Made only from what each part already shows you (the same grants, blocks and friendships), so it shares nothing new
  and has no table: what you've seen is kept on the phone (`apex.inboxSeen`). `backend/src/inbox.ts` (`GET /api/inbox`),
  `web/inbox.js`. There are no push notifications yet; this is what a push would say.
### 2.11 Recurring meets (crews; built 2026-11-11)
- A crew drive can repeat weekly, every 2 weeks or every 4 weeks (the plan form's Repeats, or the card's Set it up). Only
  the series' latest drive carries the repeat; once it starts, the next is planned at the same time with the same title,
  meet, route, notes, listing and regroup points, the planner going and nobody else's answers or roles carried. Cards and
  Meets near you say "Every Saturday"; Add to calendar puts the series in the calendar once (RRULE).
- Cancelling the latest, setting it to Once, or its planner leaving the crew ends the series. Planned on read
  (`rollRepeats` in `backend/src/events.ts`) and by the daily sweep before old drives are deleted. Migration 0053.
- **Meets on the map** (Layers → Meets, off by default, members): the same public meets as Meets near you, pinned at
  their meeting points with the day on the pin ("Sat", "Today", "+1" when several meet at one place). A tap opens the meet
  cards; your own crew's listed drive says to answer on the crew page instead of Join. Asked by the map centre's 0.1-degree
  cell, never from a privacy zone, at most once per cell every 5 minutes. `web/meets_map.js`, no migration.

### 2.12 Push notifications (built 2026-11-13; sends once APNs is on the owner's key)
- What For you says, told to the phone the moment it happens: a friend request, a new friend, kudos on a run (once
  per run), kudos and comments on your drive post (and a new comment on a post you commented on, to the earlier
  commenters who can still see it and aren't blocked either way, 2026-11-14; and "@bob mentioned you" to whoever a
  comment @mentions, if they can see the post, five handles at most, one push per person), a duel asked of you or taken, a crew drive planned in your crew.
  Never to or from someone blocked; the words are the server's own (a handle, a stage or crew name, a drive's title),
  never a comment's text. A tap opens what it is about: the post with its comments, the friend, or People.
- Garage → Settings → **Notifications**: one switch, off until turned on, and only then does iOS ask. In the
  foreground a push goes to the list only (the page is open). Nothing while you drive: the page turns
  `PUT /api/push/quiet` on at a drive's start (three hours at most) and off at its end. After your first post, one offer.
- `backend/src/push.ts` (who is told what, the tokens) on `backend/src/apns.ts` (the send path): `POST/DELETE
  /api/push/token`; tokens in KV `push/<user id>` (no table, so no migration and nothing in backups), at most three
  phones, a sandbox flag for builds from Xcode; a token Apple calls gone is dropped. Sent in `waitUntil` after the write,
  so a push never slows or fails the request. `ApexPush.swift`: the token, the tap. Shell: `aps-environment`.
- Next: a switch per kind, if anyone asks for one.

### 2.13 Drive posts and the Feed (built 2026-11-13; big bet #4)
- After a drive with a Score, a member taps **Post** on the drive's card (the solid key; Share card, the picture for
  other apps, beside it): Friends or one of their crews on a slide switch, an optional line, Post. The card carries the
  drive's name, the day, length, Score, roads and a line of its shape with both ends cut (privacy zones and 500 m on the
  phone, 500 m again on the server, 600 points at most). Never a time along it or a speed.
- **Feed** on People → Friends: the newest three posts from friends and your crews (a friend's only while they share with
  you; a crew's only while its author is still in it) (See all for the rest), each with
  kudos (one tap, counted at once) and comments (one tap opens the post with them and a line to add one). Report and
  Block are behind ··· on a post or comment, never on its face; the author deletes a post, and a comment's author or
  the post's author deletes a comment. Blocks hide both ways; three established reports hide; the owner's queue removes.
- `backend/src/drive_posts.ts` (migration 0059: `drive_posts`, `drive_post_kudos`, `drive_comments`), `web/drive_posts.js`.
  10 posts a day, 30 comments an hour, 200 comments a post. In Download my data; gone with the account.
- A clip or a photo on a post (built 2026-11-13, `backend/src/post_media.ts`, migration 0061): Add a photo on the Post
  sheet (redrawn as a JPEG on the phone, so no EXIF), or the corner clip a drive's page hands over; in R2 (`MEDIA`,
  `post/<id>`), seen by exactly who sees the post, gone with it. In the Feed a clip plays muted and looping, a tap stops it.
- Stages on a post (built 2026-11-14): the stages you saved in the Log that the drive went over (at most three, in the
  order driven) go on its post, each with its Vetta Score there (`--` when too few clean corners); never a time.
- A friend's drives on their profile (built 2026-11-14): their newest posts you can see (`GET /api/feed?author=`, the
  Feed's own rules), with kudos and comments, between what to do with them and what they see of you. Your own posts
  sit under You in the Garage the same way, each with ··· to delete it (2026-11-14). Three show, then See all.
- Next: "Post to crew" from a corner clip on the drive's page (analysis thread adds the key, `page.post(blob, meta)`).
  Kudos and comments push (2.12).

## 3. Drive analysis (private)
Compare passes of the same road — yours, or a friend's ghost they chose to send you.

Per corner (matched across drives by location, ROAD_INTELLIGENCE corner detection):
- **Time through**: corner start → end, from 5 m bins (`dt = 5 / v`).
- **Entry / minimum / exit speed** and where the minimum happened relative to the
  geometric apex (early apex vs late apex).
- **Brake point**: distance before apex where `a_lon < −0.15 g` began; peak braking.
- **Peak lateral g** and **% of envelope used** (`v_min / v_corner_limit`).
- **Smoothness**: RMS lateral jerk through the corner.
- **Delta**: per-corner time gained/lost vs the other pass, and cumulative delta along
  the road (the classic lap-analysis chart).

### Leaderboards (decided)
- **Segments** are user-made stretches (built: `web/analysis.html` SEGMENTS). Passes are
  ranked by **Driver Score**: technique only (pace as a share of the corner's grip limit,
  smoothness, braking, consistency). Speed limits and legality never enter it. A perfect
  score means driving at each corner's limit, which is a closed-track figure, not a goal for
  public roads.
- **Scores and stage times are shared with friends and private crews by default** (the owner,
  2026-11-11: away from the ultra-privacy focus), **switched off per friend and per crew**, each
  on its own. A public crew starts with nothing shared and asks once on joining (Share Scores and
  times, Scores only, or Cancel); a private crew made public turns its members' sharing back off and asks them. A switch you set, on or off, is never changed by a default, and
  switching off removes your Scores and times from that board. Live position, cars and road data
  keep their own switches and defaults (`backend/src/share_defaults.ts`).
- No public time leaderboards. Strava has faced exactly this with downhill road segments.

## 4. Backend (zero budget)
**Recommendation: Supabase free tier.** It is hosted Postgres with PostGIS, auth and
row-level security in one place, with no server for us to keep patched.
- Security comes from **row-level security on every table**: a row of times is readable
  only by its owner and the friends or crews in its grant list. The app holds only the
  public anon key, and the policies do the enforcing. Policies are versioned SQL in the
  repo with tests.
- Auth: Google sign-in + email link (docs/BACKEND.md; supersedes passkeys). Open to anyone who signs in since 2026-10-30
  (REVIEW_PEOPLE P-02); an invite is a friend link or a crew link, never a way in. Sign in with Apple waits for a
  developer account.
- The free tier pauses a project after a week with no traffic. A free scheduled GitHub
  Action pings it daily. Check the current free-tier limits when signing up, since they
  change.
- Exit plan: it is plain Postgres, so `pg_dump` moves it anywhere (self-hosted, Neon).
- Fallback if Supabase stops being free: Cloudflare Workers + D1 (free tier, no PostGIS;
  spatial lookup through H3 cell ids stored as columns).
- Store: road bins keyed by (OSM way id, direction, 5 m index), with
  H3 cells for spatial lookup.
- Store: Postgres + PostGIS; road bins keyed by (OSM way id, direction, 5 m index), with
  H3 cells for spatial lookup.
- Aggregation jobs: Bayesian hazard posteriors, corner deviation medians, roughness spectra.
- Cost target fits free-to-drive (no part of driving needs a subscription): static tiles + bin aggregates are cheap;
  no per-user trace storage.

## 5. Build order
1. Drive analysis page on local data: history, segments, compare **[built]**
2. Multi-drive local store + Bayesian hazard verification (works on-device first)
3. Garage / car profile → reference lap
4. Backend: bin upload + aggregation, road pages
5. Convoy relay
6. Octane
