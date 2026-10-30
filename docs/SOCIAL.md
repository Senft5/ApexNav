# VETTA — SOCIAL, CROWD & DRIVE ANALYSIS PLAN

The social layer exists to (1) make the road intelligence better with every drive and
(2) make driving with friends better. It must never become evidence against its users.

## 1. Privacy model (zero-snitch, enforced in code)
| Data | Stays on phone | Shared (private group) | Public crowd map |
|---|---|---|---|
| Raw IMU / GPS trace | yes | — | — |
| Absolute speeds, timestamps | yes | convoy live only, ephemeral | never |
| Your own drive analysis, corner times | yes | opt-in "ghost" to named friends | never |
| Road physics per 5 m bin (camber, roughness, crest) | — | — | yes, speed-invariant, anonymous, ≥ 3 contributors before shown |
| Corner deviation ratio `d` (ROAD_INTELLIGENCE §4.1) | — | — | yes, aggregated, ≥ 3 contributors |
| Hazard observations (hit / clean pass) | — | — | yes, bin-level, no trace |
| Trip start/end | trimmed 500 m server-side even from physics uploads | — | never |

Uploads are bin-level aggregates, never traces. Bins from one drive are uploaded unordered
and in random batches so a trace cannot be re-assembled.

## 2. Features
### 2.1 Convoy (live, private)
- Join by code/QR; group is ephemeral.
- Lead-car IMU relay (manifesto §4): severe spike (> 0.35 g, robust 50 ms measure) or
  hard mid-corner braking (< −0.55 g) → immediate geo-pinned provisional alert and spoken warning to approaching followers. Validate thresholds against live sensor evidence. The 3 s cancel window retracts an already-sent alert; it does not delay delivery. Works independently of personal drive recording and crowd-profile verification.
- Physical switches: COP, FLOCK LPR, GRAVEL, REGROUP.
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
- **Corner and segment times** are shared only by explicit opt-in, **per friend and per
  crew**, each one granted on its own. Nothing is shared by default, nothing is public, and
  revoking a grant removes your times from that board.
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
- Cost target fits the zero-subscription promise: static tiles + bin aggregates are cheap;
  no per-user trace storage.

## 5. Build order
1. Drive analysis page on local data: history, segments, compare **[built]**
2. Multi-drive local store + Bayesian hazard verification (works on-device first)
3. Garage / car profile → reference lap
4. Backend: bin upload + aggregation, road pages
5. Convoy relay
6. Octane
