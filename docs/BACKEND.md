# APEX NAV — BACKEND, DEPLOYMENT AND DISTRIBUTION

Status: **design, not built.** Owner decisions are recorded in section 9. Related: docs/SOCIAL.md (features and
privacy model), docs/ROAD_INTELLIGENCE.md (what the road data means).

## 1. Principles
1. **Local-first.** Everything works with no account and no server: recording, scoring, segments, routing,
   voices. An account adds sync and social. A server outage never stops the cockpit.
2. **The server holds the least it can.** Merged per-road numbers, scores the user chose to share, and
   relationships. Never a trace, never a raw recording, never audio of anyone's voice.
3. **Privacy is enforced by the database**, not by app code: row-level security (RLS) on every table, tested in CI.
4. **Zero budget, no lock-in.** Free tiers, plain Postgres (`pg_dump` moves it anywhere), static hosting.
5. **Proprietary.** All rights reserved (LICENSE). Third-party notices in THIRD_PARTY_NOTICES.md.

## 2. Vocabulary
- **Bin**: a 5 m stretch of road, identified by (OSM way id, direction, bin index). A bin record holds what the
  *road* is like: banking, roughness, crest. No speed, no time, nothing about the driver.
- **Trace**: the whole recorded path with timestamps and speeds. It reveals home, routine and speed. **Never uploaded.**
- **Pass**: one drive over a segment, scored (Driver Score, optional private time). Stays on the phone unless shared.
- **Segment**: a user-made stretch of road.
- **Stage**: a road worth driving (web/stages.js); a route is stages plus connectors.

## 3. How crowdsourced road data works with local-first
```
drive → phone profiles it (core/ApexKit, offline) → [opt-in + online] → bin summaries, shuffled, in batches
      → Edge Function: validate, merge into per-bin aggregates, award points, discard the upload
      → phone downloads merged values for roads it drives (cached, versioned)
```
- Contributing is opt-in per account (default off). Without it nothing leaves the phone.
- The first and last 500 m of every trip are cut before upload. Bins go up unordered in random batches, so the
  upload is not a route.
- **Small-group caveat:** with under 20 users, "at least k contributors" hides little because everyone knows who drives
  where. So in the friends phase the minimum contributor count is a setting (`min_contributors`, default 1) and the
  data is visible to signed-in friends only. Raise it to 3 before any public launch.

## 4. Points ("Octane")
- Points = **kilometres of newly mapped road × multiplier**, per **road segment and direction** (one OSM way, one direction):
  **1st contributor 3×, 2nd 2×, everyone after 1×.**
- Order is by **drive date** (the day the road was driven), not by upload time, so an offline phone does not lose its place.
  Rank is derived from the contributions at query time, so a late upload re-orders correctly with no stored rank to fix.
- One account, one rank per way and direction: driving it again never moves you up or earns a second rank.
- The second contributor's data is also the first independent check of the first one's (multi-pass verification).
- What is public: points totals. Who was first is not shown.
- Anti-cheat: the server rejects bins that fail physics sanity (impossible camber, roughness, crest), geometry that does
  not follow the claimed way, and more than a daily kilometre cap per user. Fake data is the obvious exploit.

## 5. Data model (Postgres, Supabase)
All tables have RLS on. `auth.uid()` is the signed-in user. Writes to aggregate tables go only through Edge Functions
using the service role; clients never write them directly.

| Table | Purpose | Who can read | Who can write |
|---|---|---|---|
| `profiles(id, handle unique, display_name, created_at)` | public-ish identity | signed-in users (handle + name only) | owner |
| `friendships(a, b, status, requested_by, created_at)` | canonical ordered pair `a < b` | the two users | requester creates; the other accepts |
| `crews(id, name, owner, created_at)`, `crew_members(crew_id, user_id, role)` | groups | members | owner/role-checked |
| `segments(id, owner, name, geom, length_m, direction, created_at)` | user-made stretches | owner (+ audiences it is shared with) | owner |
| `grants(user_id, audience_type, audience_id, share_scores, share_times)` | **opt-in per friend / per crew**, one row each | owner | owner |
| `board_entries(segment_id, user_id, audience_type, audience_id, driver_score, time_s null, driven_on)` | snapshots published to one audience | owner; the audience (accepted friend / crew member) | only via RPC that checks a `grants` row exists |
| `road_bins(way_id, dir, bin_idx, n, camber_mean, camber_m2, rough_mean, rough_m2, crest_peak, updated_at)` | merged road numbers (running mean/variance) | signed-in users | Edge Function only |
| `road_contrib(way_id, dir, user_id, first_driven_on, km)` unique `(way_id, dir, user_id)` | who contributed, for points | owner sees own rows only | Edge Function only |
| `hazard_obs(way_id, dir, bin_idx, kind, hits, passes)` | Bayesian hazard counts | signed-in users | Edge Function only |
| `shared_routes(id, owner, name, geom, visibility)` | planned routes (never a recorded drive) | owner + audience | owner |

`points` is a view over `road_contrib`: for each (way, dir), rank contributors by `first_driven_on`, multiply `km` by 3/2/1.
`passes` and raw times never exist on the server unless the owner published a `board_entries` row.

### Example policies (corrected after review; covered by pgTAP tests in CI, section 11)
```sql
alter table board_entries enable row level security;
revoke all on board_entries from anon, authenticated;   -- publish only through the grant-checking RPC
grant select, delete on board_entries to authenticated;
create policy own_read   on board_entries for select using (user_id = auth.uid());
create policy own_delete on board_entries for delete using (user_id = auth.uid());
create policy friend_read on board_entries for select using (
  private.is_member() and audience_type = 'friend' and audience_id = auth.uid()      -- published TO me, not to any friend
  and exists (select 1 from friendships f where f.status = 'accepted'
        and ((f.a = auth.uid() and f.b = board_entries.user_id) or (f.b = auth.uid() and f.a = board_entries.user_id)))
  and exists (select 1 from grants g where g.user_id = board_entries.user_id and g.audience_type = 'friend'
        and g.audience_id = auth.uid() and g.share_scores));                          -- revoke works even if a cleanup trigger fails
create policy crew_read on board_entries for select using (
  private.is_member() and audience_type = 'crew' and exists (
    select 1 from crew_members m where m.crew_id = board_entries.audience_id and m.user_id = auth.uid()));
```
Views use `with (security_invoker = true)`. Every SECURITY DEFINER function has `set search_path = ''`, fully qualified names,
and `revoke execute ... from public, anon`. All `user_id` columns `references auth.users on delete cascade`. `anon` has no rights on any table.
Tests assert, for every table: an anonymous client reads nothing; user B cannot read user A's private rows; a stranger
cannot read a friend-only entry; revoking a grant removes the entry; nobody can write `road_bins`.

## 6. Storage budget (for the 20-user friends phase)
- 1 km = 200 bins ≈ 30 KB raw; a 50 km drive ≈ 1.5 MB.
- **Do not keep raw uploads.** Merge into `road_bins` (~150 B per unique bin) and discard. 10,000 km of distinct road ≈ 300 MB.
- Segments, scores, grants, profiles: kilobytes. Voices: never on the server.
- Check Supabase's current free limits at signup (database ~500 MB, file storage ~1 GB, egress ~5 GB at the time of writing).
  Free projects pause after about a week idle: a daily GitHub Actions job pings the project.

## 7. Auth
- **Google sign-in** (Supabase OAuth, free) plus email magic link. Anonymous sessions first, upgraded when someone adds friends.
- Only the basic profile scope is requested, so Google should not require an app verification review; confirm when setting up.
- Web: standard redirect. The sideloaded native app must use the system browser (ASWebAuthenticationSession), because
  Google blocks sign-in inside embedded web views, and return via an `apexnav://` URL.
- Sign in with Apple is only required for the App Store, and comes with the paid developer account later.

## 8. Deployment and distribution
| Piece | Choice | Why |
|---|---|---|
| Web app | **Cloudflare Pages** at `apexnav.pages.dev` (free). Output directory `web/`, no build step. | Free, works with private repos, headers via `web/_headers`. GitHub Pages stops serving a private repo on the free plan. |
| Database/auth | Supabase free tier; migrations in `supabase/migrations`, applied by CI | Plain Postgres, no lock-in |
| Edge logic | Supabase Edge Functions (ingest, points) | Keeps writes server-side |
| Routing tiles (later) | Cloudflare R2 (free allowance, no download fees) | Per-state Valhalla tiles for on-device routing |
| iOS | CI builds an unsigned app; testers **sideload** with AltStore/SideStore using a free Apple ID (re-signs every 7 days, 3 apps) | No $99 account yet. TestFlight and CarPlay need the paid account. |
| Everyone else | **Web app (installable PWA).** iPhone Safari recording needs the screen on and a lower sensor rate; Android Chrome is fine | Free, instant |
| Custom domain | `apexnav.pages.dev` now; buy a `.com` (~$10/yr) when it is rolling | Truly free domains are unreliable |

### Going private (owner wants full control)
Sequence, so the site never goes down:
1. Create the Cloudflare Pages project `apexnav` from this repo (publish dir `web`). Check the site at apexnav.pages.dev.
2. Make the GitHub repo **private**; turn off GitHub Pages.
3. CI: private repos get 2,000 free Actions minutes a month and macOS counts 10x. `build.yml` already skips docs,
   tests, tools and voice-clip-only changes; use `workflow_dispatch` for the rest if minutes run short.
The published voice clips are the owner's consented voice; once private they are served only by the site.

## 9. Owner decisions (2026-10-25)
- Licence: all rights reserved; not open source; no charge yet; full ownership and control.
- Domain: `apexnav.pages.dev`. Stack: Supabase + Google sign-in. US only. Under 20 users. Web app first for everyone but the owner;
  sideloading for iOS testers. Points: 3x / 2x / 1x per direction of each road. Time sharing: opt-in per friend and per crew.

## 10. Build order (revised by section 11)
1. Cloudflare Pages + private repo (the owner creates the Cloudflare project).
2. Supabase project, migrations 0001 (profiles, friendships, crews, segments, grants, board_entries) with RLS + pgTAP tests in CI.
3. Sync layer in the web app (IndexedDB queue → Supabase), Google sign-in, segments sync.
4. Friends + crews + opt-in boards.
5. Ingest Edge Function, `road_bins`, `road_contrib`, points view; web contribute toggle.
6. Hazard verification, road pages, then convoy relay.

## 11. Design review (Opus, 2026-10-25) and what changed
Findings that change the design above. P0 = must be true before any real user touches it.

**P0 — privacy**
1. **`friend_read` leaked across friends** (fixed above): a row shared with friend X was readable by all friends. Entries must also
   be written only through an RPC that checks `grants`; clients have no insert/update on `board_entries`.
2. **"Signed-in" includes anonymous sessions** (Supabase anonymous users use the same `authenticated` role). Add `members(user_id pk)`,
   filled only by redeeming an **invite token**; every "signed-in users" policy uses `private.is_member()`, which also rejects
   `is_anonymous` JWTs. The app is invite-only.
3. **Contribution data reveals where and when each person drove.** An OSM way id *is* a location; ways chain into a route; a per-user
   `first_driven_on` per way is a dated route log. So `road_contrib` as drawn above is **replaced** by:
   - `private.ingest_pending(user_id, way_id, dir, driven_on, km, bins, received_at)`: not exposed by the API, held at most 14 days;
   - `private.rank_slots(way_id, dir, slot 1|2, user_id, driven_on)`: at most two rows per way and direction;
   - `private.seen(h)` with `h = hmac(server_pepper, user_id || way || dir)` for dedupe (the operator could still brute-force it;
     say so in the privacy page);
   - `points_ledger(user_id, iso_week, octane)`: the only thing that touches points totals; **totals change weekly**;
   - `driven_on` accepted only within `[upload − 14 days, upload]`; slots re-sort by `(driven_on, received_at)` until 14 days after
     the first drive, then freeze; a nightly job merges frozen data into `road_bins`, writes the ledger, deletes pending rows and
     nulls `rank_slots.user_id`. `road_bins` carries no `updated_at` in public reads.
   - Client: trim a random 0.5–1.5 km at each end (client-side only; server-side trimming cannot work on unordered bins), skip
     residential/service ways, spread one trip's upload over several days. Friends phase: `min_contributors` stays a setting.

**P1 — anti-cheat** (no device attestation exists, so keep it cheap)
- Upload per-bin curvature `kappa` (road data, speed-invariant) and check it correlates with the claimed OSM polyline; bins must form
  contiguous runs covering ≥ 60% of the way; camber sign must agree with turn direction.
- Caps: 600 km per `driven_on`, 1,500 km per week, 30 uploads per hour. Reject backdating beyond 14 days.
- Replay across accounts: quarantine a second contributor whose rounded per-bin vectors correlate > 0.98 with a pending upload.
- First-place points stay provisional until a different member's data agrees; the invite gate limits fake accounts.

**P1 — security plumbing**
- Prefer ingest as a SECURITY DEFINER Postgres function called with the user's own JWT (no service role). If an Edge Function is used,
  take `user_id` from the verified JWT, never the request body.
- Friendships and crews change only through RPCs + triggers (enforce `a < b`, only the other user accepts, no forged `requested_by`;
  crews join by invite token). Unfriend / leave crew / revoke grant / block deletes the matching `board_entries` and grants.
- Account deletion: `delete-account` Edge Function (verify JWT → `auth.admin.deleteUser`; cascades promote the next in `rank_slots`);
  `export_my_data()` RPC returns JSON. Merged `road_bins` remain (say so in the privacy page).

**P2 — launch gaps and platform facts**
- `blocks(blocker, blocked)` hides profiles and boards both ways and unfriends. Handle search is exact-match, members only.
- Backups: nightly `pg_dump` encrypted with `age`, stored as a private Actions artifact (verify what the free tier backs up).
- **Magic-link email fails on Supabase's default mailer** (team members only, ~2 emails/hour). Use free custom SMTP (e.g. Brevo) — or rely on Google sign-in only.
- Google OAuth: basic scopes (openid, email, profile) should skip verification and the 7-day token expiry if the app is "In production";
  the consent screen will show the Supabase project URL, not apexnav (custom auth domains are a paid add-on).
- Free-tier pause after ~7 idle days is reported by third-party sources, not confirmed in Supabase's docs; the daily ping must run a
  **database query** (REST select), not just hit a URL.
- Unconfirmed, test first: whether "disable signups" also blocks new Google users (the `members` gate covers it); anonymous→Google
  needs manual identity linking enabled.
- Auth story is Google + email link (docs/SOCIAL.md said passkeys; superseded).

**pgTAP tests that must exist (CI fails otherwise):** (1) anon and non-member read nothing from any table; (2) a friend-audience row is
invisible to the owner's other friends; (3) direct insert/update on `board_entries` fails; (4) revoke grant / unfriend / leave crew / block
removes visible entries; (5) self-accept or forged `requested_by` fails; (6) self-joining a crew fails; (7) `road_bins`, `rank_slots`,
`seen`, `ingest_pending` cannot be read or written via the API; (8) `points` exposes only `(user_id, total)`; (9) every definer function has
`search_path = ''` and no `anon` execute; (10) late upload inside the window takes first place, outside it is rejected, backdating is
rejected; (11) account deletion cascades and promotes the next contributor; (12) a view without `security_invoker` fails the build.
