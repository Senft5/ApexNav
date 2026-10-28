# APEX NAV — CURRENT AGENT HANDOFF STATE

## Session 2026-10-28 (midday)
- Merged through #207: Q-09 sight offsets, Y-17 route latency, review fixes (migrations 0021–0022 applied to both D1).
- Merged #208: R-21 forecast costs in fun-route ranking (difference from the driest, all-or-nothing), R-22 "Route around it" for conditional closures (exclude_locations).
- Merged #209 Q-14 coverage map (migration 0023 `road_ways`; privacy page says the road's public map line is sent).
- This PR: R-12 set list, R-20 car-aware routing (migration 0024 cars.clearance/width_cm applied to both D1).
- #210 also: Z-11 Content-Security-Policy on every page (tools/csp.py; rerun it after editing an inline script, CLAUDE.md says so).
- Merged #215 also: Q-04 crowd curvature (migration 0027 applied), Q-03 asked of the owner, R-35 speed traps and S-07 comments dropped with reasons.
- Next PR: D-11 dashcam overlay (web/dashcam.js); blocked IDEAS rows marked owner/parked with reasons.
- This PR: F-02 offline map areas (web/offline_tiles.js, apexc:// protocol, IndexedDB).
- Merged #222: D-10 flyover video (web/flyover_video.js) + in-app file saving through the share sheet (shareFile bridge; GPX and Download my data were silently doing nothing in the app).
- Merged #221: Y-06 feature flags (/api/flags, web/flags.js, FLAGS variable; kill switches for track mode, taste, crowd curvature).
- Merged #220: S-10 Octane accents (migration 0028 applied), V-06 parked, R-36 asked of the owner.
- Merged #219 also: D-15 track day mode (raceway-only lap timing, web/track_mode.js).
- Merged #219: Q-05 adaptive sectors + route character line.
- Merged #218: R-33 per-user taste from road votes (web/taste.js; ±8 fun points, 5+ answers).
- Merged #217: Q-13 road pages (reference lap ported to JS, parity-tested; Explore → About).
- Merged #216: R-32/Q-19 benchmark roads in CI (tests/benchmarks.js, fixtures from tools/make_benchmark_fixture.js). Known gap: dense hairpin sequences (Stelvio) are under-counted by stroke joining or corner detection; zoom-14 tiles do not fix it.
- Merged #215: S-11 pioneer km + crew-vs-crew km, S-08 smoothest crew (migration 0026 member_months + board_entries.smoothness, applied to both D1).
- Merged #214: V-07 Siri next/skip stage (FunRoute.stageSpans), U-22 driving side in sight distance (NEAR_SIDE_M 0.8, a first estimate).
- Merged #213: P-05 route analysis in a Web Worker (web/analysis_worker.js + analysis_client.js; inline fallback); D-19 scores per car (only ever gentler than the street default).
- Merged #212: Z-10 session token in the iOS Keychain, API calls through the shell (ApexApiBridge). Needs the iOS CI build to compile it; check sign-in on TestFlight.
- Merged #211: Q-12 freshness (migration 0025 applied to both D1); CSP names apexnav: too; the Where to? e2e flow waited on a toast the closure replan can overwrite (fixed; FLOW=, REPEAT= in e2e/smoke.js).
- Exact next task: remaining IDEAS todo rows (R-04, D-10–D-15, Q-03–Q-20, S-10, S-18, U-12, P-01/P-03/P-05 ...).

## Session 2026-10-28 (late morning)
- Merged: #193 F-06 offline data, D-23 drive tags, V-08 ducking, S-20 flyby; #194 S-11 monthly challenges, R-18 drag to reshape.
- This PR: Y-14 segment ids that can't collide (and a taken old id resent under a new one), R-34 ramps are Connectors, A-03 PWA (manifest + network-first service worker, websites only), R-35 avoid cameras, D-20 your week, L-05 feedback (migration 0017 applied to both D1), Z-08 k-anonymity for road data, R-14 drop stage plans the router shortcut, S-08 local legends (days driven this month), U-16 landscape cockpit, S-15 friend profiles, S-07 kudos (migration 0018 applied to both D1), U-22 km or miles everywhere (Settings → Units), V-07 Siri shortcuts (start, report, end), U-21 route climb and hills in Preview, U-20 pinned places (phone only), S-17 which road was better (phone only), S-09 pioneer badges (migration 0019 applied to both D1), R-17 stops of the day, U-14 3D terrain, R-21 forecast along the route, R-22 conditional closures on the route card, U-19 search knows your stages and skips bike paths, O-07 referral Octane (migration 0020 applied to both D1), A-05 desk layout, V-09 recce notes, Q-09 sight lines from landcover, Y-17 server latency in D1 (migration 0021 applied to both D1), and fixes from a review of today's work (migration 0022).
- Exact next task: small IDEAS rows: S-17 which road was better, Q-14 coverage map; then U-22 left-hand traffic notes, Q-14 coverage, P-05 analysis in a Web Worker.

## Session 2026-10-28 (morning)
- Merged: #191 R-25/R-26 GPX in/out and maps links, #192 R-37 home by + R-11 which way round a stage + S-12 spots near you.
- This PR: F-06 offline data in Settings (size and delete), D-23 drive tags and notes with a Log filter, V-08 ducking by note priority (shell `duck` flag; `.mixWithOthers` for cruise chatter), S-20 flyby on a drive's page, S-11 monthly challenges (personal part), R-18 drag the route to reshape it.
- Exact next task: IDEAS M rows: S-15 profiles, A-05 desktop planner, S-07 kudos, S-11 crew-vs-crew; widgets with data need an App Group (U-10).

## Session 2026-10-28 (early morning): more of IDEAS, all through TestFlight
- Merged since: #184 Y-03 app health counts (migration 0014), #185 U-10 Start-a-drive widget + Control Center button, #186 S-13 public meets (migration 0015) + R-19 corners you like + D-24 year so far, #187 O-08 landing page (web/about.html), #188 Q-17 closures routed around, #189 R-24/R-23 viewpoints, cafés and fuel along a route, #190 S-19 share your ETA (migration 0016).
- Open: #191 R-25/R-26 GPX in/out, maps links, Open in ApexNav (iOS document type). Next PR: R-37 home by, R-11 which way round a stage (DEM climb), S-12 spots near you in Crew.
- Every main merge uploads to TestFlight on the ad-hoc archive path; builds 377.1–384.1 VALID.
- Migrations 0013–0016 were applied by hand to both D1 databases before their PRs merged (BACKUPS.md log).
- Exact next task: merge #191 and the R-37 PR; then IDEAS M rows: S-15 profiles, A-05 desktop planner, R-18 drag to reshape; widgets with data need an App Group (U-10).

## Session 2026-10-28 (night, later): TestFlight fixed, more of IDEAS
- TestFlight works again: #181's ad-hoc archive + cloud signing at export uploaded build 377.1 (VALID in App Store Connect, entitlements intact, no new certificate). Revoking the 10 old CI certificates is now optional (OWNER_TODO).
- Merged: #181 F-05 + O-09 + signing fix, #182 V-04 directions, D-05 stage delta, S-06 crew drives (migration 0013 applied), F-03 saved routes, S-03 friends' activity, O-10 what's new; #183 L-03 licences page, no downloaded code in the app (2.5.2), junction tulips in the strip.
- This PR: Y-03 app health counts (migration 0014 applied to both D1 before merge).
- Parked: D-04 ghost car (races the clock on public roads); Q-13 road pages need the reference-lap features ported to JS (L); U-10 widgets need an App Group capability (do it now that signing is proven).
- Exact next task: U-10 widgets (App Group `group.com.senft.ApexNav` on both bundle IDs, shared UserDefaults for last drive score and next crew drive); then D-19, R-19, S-13 public meets.

## Session 2026-10-28 (night, continued): drive features, offline, TestFlight signing
- Merged: #174 V-02, #175 U-09, #176 S-05 (migration 0012 applied by hand), #177 Z-03/Z-04 Your data, #178 Y-16/Y-18, #179 U-11 Live Activity (widget extension ApexNavLive), #180 D-17 crash check (impact_g in native and web frames).
- #181 (open): F-05 hazard reports queue with no signal (web/outbox.js, `age_s`), O-09 listing draft (docs/LISTING.md), and the TestFlight fix below.
- **TestFlight is blocked** since build 372.1: "Your account has reached the maximum number of certificates". Each automatic-signing archive made an "Apple Development: Created via API" certificate on a throwaway runner (10 exist). #181 archives ad hoc and signs at export (fallback: the old path). Revoking the 10 through the API was blocked as an irreversible action; the owner revokes them (docs/OWNER_TODO.md top row). Check the first main run after #181: if the ad-hoc export works, the step summary says "Signed at export from an ad-hoc archive".
- Next PR from the f05 chain: D-05 stage delta (web/stage_delta.js, ApexCore.techniqueScore), S-03 friends' activity (GET /api/board/activity), V-04 spoken directions (web/directions.js; the app had no turn-by-turn before), O-10 what's new (web/whats_new.js; edit NEWS per release), F-03 saved routes (web/saved_routes.js; planned route kept 12 h).
- Decisions: D-04 ghost car parked (a ghost that moves by time races the clock on public roads); D-05 compares technique only.
- Exact next task: merge #181, push the f05 chain as one PR, confirm TestFlight uploads; then IDEAS H/M rows: Q-13 road pages (needs the archetype rules ported from core/reference_lap.py), R-19, D-19, S-13, Y-03 (needs a switch and an App Privacy update).

## Session 2026-10-28 (night, autonomous): App Store readiness and IDEAS
- TestFlight works end to end: every app-changing merge uploads (Xcode 26 on macos-26); internal group "First Testers" gets all builds. The session can read App Store Connect through `ASC_*` secrets (docs/APP_REVIEW.md).
- Merged tonight: #160 Z-13, #161 Y-13/Y-15 (+ backend-only merges skip iOS), #162 Z-15, #163 V-03, #164 Z-02, #165 note timing at corner entry (owner report), #166 Sign in with Apple + privacy/terms + APP_REVIEW.md + OWNER_TODO.md, #167 S-21 garage lookup, #168 S-22 convoy invites + QR, #169 O-12 review code, #170 D-09 drive card, #171 Z-12, #172 Q-15/Q-16 hazard reports (migration 0011 applied by hand to both D1), #173 V-01 note lead from speed/reaction/braking. Open: #174 V-02 plain words; this PR U-09 haptics.
- Owner items: docs/OWNER_TODO.md (legal text approval, SIWA key for token revocation, CarPlay entitlement, App Review notes paste, routing server decision).
- Exact next task: keep working IDEAS by impact/effort (H/M next: D-04 ghost car, D-05 live delta, Q-13 road pages, S-05 share planned route, U-19 search roads, Z-03 privacy dashboard).

## Session 2026-10-28: TestFlight live; open PRs merged; audit leftovers
- First TestFlight upload succeeded: build 342.1 (Xcode 26 on macos-26), processing in App Store Connect. The owner adds an Internal Testing group once.
- Merged the other session's open PRs (#143, #152, #154, #155, #156, #157) after merging main into #154; #159 fixed a 1-in-64 convoy test flake.
- #160 Z-13: convoy members see handles only. This PR: Y-13 daily sweep of expired sessions, app codes, unused invites and crew invites (cron `23 6 * * *`); Y-15 sign-in refreshes email and name; backend/ and e2e/ no longer trigger the iOS build or a TestFlight upload.
- Exact next task: Z-12, Z-15, then IDEAS H/S rows (V-03, Z-02, D-09).

## Session 2026-10-28: live time left and arrival
- #136 merged (avoid towns). #154: eta-1 / R-07, the drive bar shows "N min left · h:mm" on a planned route, from the router's maneuver times ahead scaled by your pace on this route (web/eta.js, docs/ROUTING.md "Time left while driving"). Checked in a desktop browser with fake GPS; not on a phone or CarPlay.
- West Knoxville → Townsend on Fun (no stage detour) checked: the best stage plans route at 91–92 min against an 89 min budget (quickest is a 63 min highway alternate); not a bug. The matrix plan estimate ran ~9 min short of the routed time there.
- Exact next task: R-11 stage direction by climb/descent; or show the ETA on CarPlay.

## Session 2026-10-28: web inspector off in release (Z-09)
- #143: the iOS web view is inspectable only in DEBUG builds (Safari's Web Inspector could read the session token from a release IPA). The CI IPA is Release, so a phone trace through Web Inspector now needs a Debug build. (Q-23 landed separately in #147.)
- Exact next task: the remaining audit rows (Z-10, Z-11, Z-15, Y-13 to Y-15).

## Session 2026-10-28: TestFlight uploads from CI
- `build.yml` jobs `testflight-gate` + `testflight`: on main, after ApexKit and simulator tests pass, archive with automatic signing through an App Store Connect API key and upload (docs/TESTFLIGHT.md). Skipped with a run-summary note while any of `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID` is missing. Build number = run number.attempt; `MARKETING_VERSION` 1.0 in project.yml; iPhone only; `ITSAppUsesNonExemptEncryption` NO. `build-ipa` unchanged.
- First signed run (run 339, build 339.1): all four secrets present, archive with automatic signing succeeded, export failed with "Error Downloading App Information" (App Store Connect returned no app record for com.senft.ApexNav, or the key can't see it). A failed export now prints the IDEDistribution log's error lines.
- Re-run (339.2) after the owner re-made the App ID: Apple took the key and app record, analysed the build and refused it: built with the iOS 18.5 SDK, uploads need the iOS 26 SDK (Xcode 26). The `testflight` job now runs on `macos-26`, selects the newest Xcode 26+ and fails early if the iOS SDK is under 26. The other macOS jobs stay on macos-15.
- Exact next task: merge #158, let the main run upload, confirm the build in TestFlight (fix any Xcode 26 compile errors first).

## Session 2026-10-28: avoid towns
- #129 merged (Explore). #136: a Towns chip under Avoid; candidates are ranked on km near cities, towns and villages from the map tiles (3 points a km, max 30) and the card says "Through towns ~N mi" (docs/ROUTING.md, Avoid). Not checked on a phone.
- Seen while checking: west Knoxville → Townsend on Fun found no stage plans (router routes only); worth a look.
- Exact next task: R-11 stage direction by climb/descent, or that Knoxville → Townsend case.

## Session 2026-10-28: production crash and error review
- Cloudflare connector checked: it reaches D1 SQL and the deployed Worker code, not Workers Logs, analytics or latency (table in docs/BACKUPS.md 6a). So no crash report or server error from production could be read; there was nothing else to review.
- Production D1 looked healthy: 3 users, 909 road bins, no expired sessions or stale sign-in codes left, empty ingest queue.
- Crash reports and the Worker's own 500s are now counted per day in D1 `error_counts` (migration 0010, anonymous, capped at 500 rows a day, kept 30 days); owner view `GET /api/ops/errors?days=7` (docs/BACKEND.md). Unfixed follow-ups: IDEAS Y-16 to Y-18.
- Exact next task: once some counts exist, `SELECT * FROM error_counts ORDER BY day DESC, n DESC` on apexnav-db and fix the top entries; Y-17 for latency.

## Session 2026-10-28: production-readiness audit
- Read the whole backend, the iOS shell's web view and bridge, the live contributor, kinematics.py and sun.js. SQL is all bound parameters; auth, CSRF, invites, export/delete and the board/grant rules hold. pytest 253 green, vitest 169 green.
- #132: real names (Google display name) only to yourself and accepted friends (public crews and pending friend requests leaked them); app sign-in code consumed atomically; expired sessions swept on sign-in; crew invite links respect the 10-crew cap.
- #135: the iOS web view loads only apexnav:// pages; http(s) links open in Safari; the native bridge answers only the app's own top-level page.
- #139: crew discovery without lat/lon is a 400 (was a search around 0,0); client segment ids must be URL-safe; live road sharing keeps a random 0.5–1.5 km private at each end of a trip (was a fixed 1 km, which pointed exactly 1 km back to home).
- Not fixed, logged in docs/IDEAS.md: Z-09 to Z-15, Y-13 to Y-15, Q-23. Not reviewed in depth: convoy.ts transport (it has its own doc and tests), fun_route.js and stages.js scoring (routing threads are active there).
- Exact next task: Z-09 (inspector off in release) and Q-23 (demo drives export null camber), both small.

## Session 2026-10-28: first database backup
- First export of `apexnav-db` and `apexnav-preview-db` taken and verified (docs/BACKUPS.md section 3 and log). No Cloudflare API token is set in Claude's environment; it went through the Cloudflare connector's read-only SELECTs, rebuilt as a `.sql` file, loaded into a local SQLite and fingerprint-matched against live D1 on every table. Files are in the project files `backups/d1/`, not the repo.
- The connector can query D1 and read Worker code; it cannot export, use Time Travel, or read Workers Logs/analytics (table in BACKUPS.md section 3).
- `d1_migrations` was empty on prod and missing on preview; backfilled 0001–0009 on both (BACKUPS.md log). Hand-applied migrations must now add their row too (Y-08 drift check in CI still todo).
- Y-12 weekly automatic backup: `backend/src/backup.ts` + cron `0 7 * * 1` writes `d1/apexnav-db/YYYY-MM-DD.sql` to KV `apexnav-backups` (R2 isn't enabled on the account), keeps 8; a test restores the dump into a second D1 and compares every row and index. Deleted accounts linger in copies for up to 8 weeks (BACKUPS.md 3a; the privacy policy must say so).
- Exact next task: confirm the first Monday run (a `backup` log line and the KV key); restore drill once the owner has a wrangler login or token.

## Session 2026-10-28: Explore
- #126 merged (route options). #129: Explore 15/30 min lists the best roads you can reach in that time (real drive times from one matrix call), named from the map tiles, drawn on the map; one tap routes through the whole stage (docs/ROUTING.md, Explore). Checked in a desktop browser around Maryville TN. Not checked on a phone.
- Exact next task: R-15 remainder (avoid towns, repeated roads), then R-11 stage direction.

## Session 2026-10-28: route options side by side
- #123 merged (sun glare). #126: a planned route offers up to 3 distinct options (`FunRoute.distinctOptions`: same within 30 s and 1 fun point counts once) as chips on the route card ("Fun 79 · 128 min") and dashed lines on the map; tapping either re-plans on that option with its own why line, glare and avoid notes. Hidden while driving. Knoxville → Maryville on Fun: 79/128, 51/98, 61/127. Not checked on a phone.
- Exact next task: R-10 Explore, or the R-15 remainder.

## Session 2026-10-28: sun glare in routing
- #122 merged (loops by drive time). #123: `ApexSun.sunPosition` (altitude/azimuth, tested against Cincinnati solstice values) and `FunRoute.glare`: minutes heading within 20° of a sun 0–15° up cost 1 fun point each (max 20) in A→B ranking and loops; the route card warns "Low sun ahead for ~N min" (docs/ROUTING.md, Sun glare). Not checked on a phone.
- Exact next task: R-30 route options side by side, or R-10 Explore.

## Session 2026-10-28: loops by drive time
- #118 merged (avoid options). #122: 1 h / 2 h loop chips plan on drive time (docs/ROUTING.md, Loops "By time"). Knoxville 2 h → 119 min, 1 h → 75 min (nearest good roads are far). Loop cards now carry their real name ("119 min loop", "27 mi loop"; it used to keep the asked distance). Not checked on a phone.
- Exact next task: R-30 route options side by side, or R-10 Explore.

## Session 2026-10-28: avoid highways, tolls, ferries, unpaved
- #115 merged (why this route). #118: Avoid row on the Plan sheet (docs/ROUTING.md, Avoid); unpaved avoided by default; Valhalla summary flags make it honest ("Couldn't avoid tolls" on Virginia Beach → Cape Charles, checked against the public server). Not checked on a phone.
- Exact next task: R-15 remainder (avoid towns, repeated roads), or R-13 sun glare.

## Session 2026-10-28: reliability (rate limits, crash reports)
- #112 merged (IDEAS Y-10): Cloudflare rate limiting bindings, every write 60/min per session (per IP signed out), sign-in 20/min per IP, `429 rate_limited` + `retry-after: 60`.
- Y-02 crash reports: `web/errors.js` (first script on index and analysis pages) sends uncaught errors and rejections, scrubbed, anonymous, max 5 per page, to `POST /api/errors`; the Worker scrubs again and logs one `client_error` line (nothing stored). Read them in Cloudflare Workers Logs. `body()` now checks the 64 KB cap on what arrived, not on Content-Length. Not checked from the iOS app yet (cross-origin post from apexnav://app, same CORS path as ApexSync).
- F-03 (offline planned route) looked at: there is no service worker, map tiles always come from the network, and CacheStorage on the custom scheme is unproven. Needs a phone to test; not started.
- C-07 / C-08 in-car mode: `web/in_car.js` MotionGate (moving after 3 s at >= 10 mph, stopped after 5 s under 1.5 m/s or 10 s with no speed; unknown speed never counts as moving) sets `body.moving`. Every button grows to >= 60 px and text fields won't take focus; a tap explains and offers "I'm a passenger", which unlocks typing until the car next stops. Fed by the app's frames and the browser's GPS. Checked in headless Chromium (drive cockpit, While-you-drive panel, Plan sheet); not on a phone.
- Y-09 backups: docs/BACKUPS.md (Time Travel restore, note a bookmark before every hand-applied migration, monthly export kept off-repo, quarterly restore drill into a throwaway database), `tools/d1_rowcounts.sql` (checked on the live database: 26 tables + d1_migrations), `tests/test_backups.py` keeps it in step with migrations. The first export and drill need the owner's `wrangler login`.
- P-06 start-up: the two bundled demo drives (1.8 MB of the 3.1 MB a cold start fetched) now load only for Watch a replay or a `?drive=` link (`loadDemos()` in web/index.html). Headless Chromium at 4x CPU: DOMContentLoaded about 1.2-1.6 s with them, 1.0-1.2 s without. P-04 was already true (voice models load only when used).
- Y-07: docs/VERIFY.md section 0 is the 40-minute real-phone run before every IPA/TestFlight build (parked, passenger-operated drive, after), with a result table; it gathers every "not checked on a phone" item above, and battery %/hour for P-01.
- P-07 thermal guard: `ApexKit/ThermalGuard.swift` (critical pauses, back to fair or nominal resumes after 3 s settle). While paused the app stops CoreMotion, sends `calibration: "paused"` with g, camber, crest and roughness null (so nothing is recorded or contributed as measured), and the cockpit warns "Phone is hot". Frames carry `thermal` (0-3). Not checked on a hot phone.
- P-02 low-power cockpit: `web/power.js` PowerSaver. A serious or critical thermal state, iOS Low Power Mode (frames now carry `low_power_mode`) or a browser battery at <= 20 % not charging (off at 25 % or charging) drops the chase cam to 30 fps with no road shake, the map to 2x pixels, and hides hillshade and contours, with a one-line toast each way. Checked in headless Chromium; not on a phone.
- Y-05 status checks: `.github/workflows/status.yml` runs `tools/status_check.py` every 30 min (site, `/api/health` now runs `SELECT 1` on D1, and the free Valhalla/OSRM/OpenFreeMap/DEM/Overpass services). A core failure opens one `outage` issue assigned to the owner and the next all-clear closes it; dependencies only show in the run summary (evidence for Y-04). Runbook: docs/STATUS.md. C-06 parked: the app sends no notifications to hold back yet.
- Y-11 end-to-end tests: `e2e/smoke.js` (run `node e2e/smoke.js` with Playwright installed; CI job `e2e` in core-tests.yml) serves web/ and blocks every other host, then drives its flows in headless Chromium and fails on any page error: first run → Watch a replay → Play, live frames → cockpit + big targets + typing lock, hot phone → battery saver on/off, Where to? with search offline, the Log page. A sixth flow plans a route with Photon and Valhalla stubbed (suggestion → route card → Start). Next: stub the Worker API for Crew.
- C-05 auto-start: when the audio route gains a CarPlay output (`AVAudioSession` route change, `.carAudio`) and no drive is running, the cockpit offers "CarPlay connected · Start drive" for 10 s. `apexnav://open?go=drive` (and `?go=drive` on the web) starts a drive directly, so an iOS Shortcuts automation "When CarPlay connects → Open URL apexnav://open?go=drive" auto-starts. An e2e flow covers the toast and the link; not yet checked in a car.
- Exact next task: owner's first real-phone run (VERIFY.md section 0); P-06 next: the 241 KB index.html inline script and MapLibre's 800 KB are the rest of the start-up.

## Session 2026-10-28: "why this route" on the route card
- #111 merged (loops on the fun score). #115: a fun route slower than the quickest says why under the bars, from Valhalla's road names (`FunRoute.why`, `whyText`): Knoxville→Maryville on Fun reads "For SR 360 13 mi, Cold Spring Road 8.2 mi, Doublecamp Creek Road 6.2 mi · 167 more good corners, +30 min". Kept across a page change (sessionStorage). OSRM fallback routes have no names, so only corners and minutes show. Not checked on a phone.
- R-14 (reject routes that shortcut a stage) is mostly covered already: every candidate is scored on the router's returned geometry, so a shortcut route can't win on corners it didn't drive.
- Exact next task: R-13 sun glare penalty, or R-15 avoid options (highways, tolls, unpaved).

## Session 2026-10-28: one fun score for loops and A→B
- #96 merged (long trips in sections). #111: loops are now ranked by `FunRoute.loopValue` (Fun − 200 x retraced share − 80 x length error) instead of raw corners per km, so router junction turns no longer count as loop corners and the measured adjustment (fun points) is on the same scale. Knoxville 30 mi: a clean 43 km loop (Fun 75) beat a 47 km one with more corners but 9 % retraced. Not driven on a phone.
- Exact next task: next routing rows in docs/IDEAS.md (R-14 reject routes that shortcut a stage, R-31 "why this route", R-13 sun glare).

## Session 2026-10-28: social: convoys and the garage (thread "Make ApexNav's social features best in class")
- #84 convoy backend: `ConvoyRoom` Durable Object per drive (ticketed WebSocket, 16 cars, 2 h, 30-min invites, leader-only hazard calls / shared route / regroup point, retract with tombstones, replay after reconnect, restart epochs, positions never stored) and `ConvoyIndex` per user (2 led at once, 10 created per hour; blocks, logout and account deletion reach live convoys). Deviations from docs/CONVOY_TRANSPORT.md are listed in its "As built" section. Reviewed by code-review and security subagents (all findings fixed, re-verified). 32 tests in backend/test/convoy.test.ts.
- #89 convoy app (web/convoy.js, web/convoy_ui.js): start/join by link, crew bar with gaps to leader and last car, leader call buttons with 3 s undo, spoken calls for hazards ahead on the shared route (or a heading cone), map markers and dashed route, reconnect with backoff, offline queue, "Use it here" when a second device takes over. tests/test_convoy_client.py; Playwright check as leader and member.
- Garage (migration 0008, applied by hand to both D1 databases on 2026-10-28): up to 10 cars with power, weight (lb in the UI, kg stored), lb/hp, drive, gearbox, tyres, mods; one primary ("daily"); "Show to my friends and private crews" (public crews don't count, anyone can join them). Rules in docs/BACKEND.md section 6. Reviewed by code-review and security subagents; cap/primary races, multi-line mods, zero-width/bidi text, public-crew exposure, null-handle grouping all fixed with tests.
- The iOS confirm() fix landed separately (WKUIDelegate in ApexNavApp.swift).
- #120 block, report and moderation (IDEAS S-16; migration 0009 applied by hand to both D1 databases on 2026-10-28): block from any social surface, one report sheet (friends, crew members, public crews, friends' cars, spots), 3 reports from distinct members (invite chains count once) hide the item, owner queue in Account with Dismiss / Remove; Remove bans by Google account (survives account deletion), makes a crew private, unshares a car or hides a spot, and the owner can't switch it back. Reviewed twice by code-review and security subagents. backend/test/safety.test.ts.
- Convoy members show their daily car (from /api/garage/people, so the garage's own audience rules hold: friends and private crew-mates, shown cars only, never across a block). No backend change.
- Links that open the app (IDEAS S-14): apexnav://open?invite|crew|add|convoy (ApexNavApp.swift `linkItems`), handed to the running cockpit page without a reload; iPhone Safari shows "Have the app? Open it there". Crew links now ask before joining and invite links wait for Join (before, opening a link joined on its own); link parameters leave the address bar once read.
- Not verified on a phone: the report sheet and moderation queue in the app; opening apexnav:// links (cold start and while running, and from Log/Stages); the Safari bar without the app installed shows Safari's own "address is invalid" alert.
- Known open: apexnav:// is a custom scheme another installed app could also claim; Universal Links (applinks: entitlement + apple-app-site-association) would close that and need a provisioning change. Crew and convoy prompts don't name the crew/convoy yet (needs a read-only preview endpoint).
- Crew and convoy invite previews: the join prompts name the crew (size, owner) and the convoy (leader, size, end time). Crew invites no longer work across a block with the owner or for a reported/removed crew (private-invite joins skipped both checks before).
- Exact next task: convoy drive recaps (who drove, hazards called) and a real two-phone convoy test.

## Session 2026-10-28: long trips planned in sections
- Trips over 22 km crow fly are cut into ~24 km sections along the quickest route (2 on Fun, 3 on Max fun); each section gets its own stage search, and the best per section (plus one-swap variants, max 4 stages) compete with the single-corridor plans (#96, `ApexFunRoute.sectionCount/sectionPoints/combineSections`). Knoxville→Asheville Fun: Fun 47 for +17 min (was no fun option); Knoxville→Maryville unchanged (79 @ 128 min). Not driven on a phone.
- Exact next task: use measured data during stage discovery (road-3 remainder); unify loop ranking with the fun score.

## Session 2026-10-28: traffic as a fun penalty (traffic-1, iOS only)
- `web/traffic.js` (pure, `tests/test_traffic.py`): route ahead in 4 km chunks; Apple's time now vs at 3 am per chunk, counted only when Apple's path follows ours; slow ≥ 1.2x, jam ≥ 1.5x and ≥ 60 s. Traffic lowers route fun even with no delay: the Plan card's fun score (web/fun_route.js) times sum(len/r)/sum(len·r) over 500 m pieces. On a jam: Valhalla alternates + `exclude_polygons` around the jam, best more-fun detour within max(10 min, 25 %) offered for 6 s with Cancel and voiced; else "Traffic ahead · N min". Design in docs/ARCHITECTURE.md section 8.
- `ApexNavApp.swift`: `trafficProbe` bridge command (MKDirections now + 3 am, both paths, stops on MapKit throttling). Swift compiled only by CI.
- Not verified on a phone or in real traffic. Web/Android: no traffic source (keyed provider needs owner approval, not built).
- Exact next task: owner drives a planned route in the IPA through known traffic and checks the announcement and the switch; then eta-1 (live ETA) so +N min uses the live estimate.

## Session 2026-10-28: idea backlog (thread "Build the best-in-class idea backlog")
- New docs/IDEAS.md: ~190 ideas in 14 areas (routing, analysis, road intelligence, co-driver, social, UI, onboarding, in-car, offline, reliability, performance, privacy, Android/web, launch), each with impact, effort, status and source (repo docs, owner asks, competitors such as Waze, Strava, Calimoto, Kurviger, Roadtrippers, REVER, Relive, Dragy). Statuses checked against this file and main as of #88. Includes "How to pick next" and the decided guardrails. Threads claim a row as `active`, then mark it `done (#N)`.
- Exact next task: each area thread picks its next row by the pick rules (owner reports first, then WORKER_QUEUE top priorities, then H/S → H/M → M/S → H/L).

## Session 2026-10-28: measured roads count in routing
- #85 merged (loops sized with real road distances).
- Measured road data now moves route choice for members (docs/ROUTING.md, Measured roads): `measuredAdjust` −8 rough … +3 smooth, +2 banked, weighted by coverage and passes; readings whose passes disagree (#87 spreads, `agreement() === 'differ'`) are ignored; unmeasured stays neutral. `measuredAlong`/`measuredSeries` look up to 150 ways in batches of 50 (long routes used to see only their first 50 ways). Route card shows a Surface bar once a fifth of the route is measured. Production has very little measured data yet (909 bins, no camber as of 2026-10-26), so the effect in the field will be small until people drive with sharing on.
- Exact next task: stage discovery that also covers the ends of long A→B trips (multi-centre search), and using measured data during stage discovery (road-3 remainder).

## Session 2026-10-28: driver and road analysis (thread "Deepen driver and road analysis")
- #80 corner coach (core/drive_analysis `corner_phases`/`coach`, JS parity): per corner its own brake zone, trail braking, coasting and throttle point; each corner matched in your other drives and timed over exactly the same stretch (sub-bin alignment, so GPS jitter is not "time"); overdriven passes never count as best; gains under 0.2 s ignored. Drive view: "Ideal drive N s quicker", "Where to find time" (top 3 with one tip each), a tip on corner cards. Unmeasured g anywhere from 200 m before the apex to 100 m after the exit leaves the corner out.
- #86 grip circle (`gg_envelope`/`grip_use`): the driver's own g-g envelope (16 slices centred on the axes, 95th percentile), every sample as a dot, the scrubbed corner's trace and its grip use.
- #87 road feel confidence: `GET /api/roads` adds `cn`, `csd`, `rsd` (sample SD from the Welford sums road_bins already keeps; no migration); readout says "1 run", "N runs agree" (camber within 1.5°, roughness within 0.05 g) or "runs differ ±x"; faint bars for single/disagreeing passes. Older server payloads read with agreement unknown.
- Reviewed by code-review subagents (phantom gains from GPS alignment, tips from zero-filled g, braking from the previous corner, skewed slices: all fixed with tests). Checked in headless Chromium at 390 px with the shipped drives stored as recordings.
- Not verified on a phone: any of the above with real drives; the coach needs two or more drives of the same road to show an ideal drive. Road-feel confidence needs a signed-in member and real multi-pass data, so it has only been checked with stubbed data in tests.
- Pothole evidence on phone drives: the live pipeline keeps the largest >8 Hz vertical spike (`vert_peak`, Swift `vertPeakMps2`, fixture regenerated); the app sends it per frame as `vert_peak_g` and its own CSV writes it per node (blank unless locked and rolling); the web Recorder places each frame's spike on its 5 m sample (column `vert_peak_g`). Not yet used for detection.
- Pothole confirmation: phone drives now get bump/crest/dip calls from what they measured (`detectHazards`, parity with road_dna; no roughness-only bumps), and each hazard is labelled from your other drives of the same spot and direction: "Confirmed on N of M drives", "Seen on 1 of M drives", "Driven once". Analysis page and the route toast count only corners as corners.
- Spoken coaching on roads you have driven (`web/road_memory.js`): approaching a corner where the coach found something last time, with full notes on, the co-driver says it once before the corner call ("Last time, coasting here. Brake, then straight back to throttle."). Technique tips only; speed-pushing tips are never spoken. The latest pass of each corner decides, so a fixed corner goes quiet.
- Plain-words coach (IDEAS D-21): the drive page opens with one sentence a non-racer understands: what went well, then the one habit to work on (from the coach's own-pass technique tips seen in two or more corners, else the weakest of smoothness, braking and rhythm). Never a nudge to go faster.
- The app's own CSV export now leaves g, camber, crest and engagement blank while the mount is unsolved, and elevation blank without altitude (it wrote 0 before) (IDEAS D-22).
- Bump ahead on any road (IDEAS Q-22): bumps your own drives confirmed (two or more passes, same direction) are called "Bump ahead" at the call distance on a live drive, with or without a route, unless a route bump that will be called is near. Quiet mode calls only bumps of 0.45 g or more, as on a route; the call never pushes a queued pace note out, and the same bump may be called again after 5 minutes.
- Smoothness map (IDEAS D-06): `core/drive_analysis.abrupt_moments` (JS `abruptMoments`, parity-tested) gives the rate of change of the combined g in g/s per 5 m sample (unknown where g is unmeasured or under 5 m/s) and the three most abrupt moments 200 m apart over 0.3 g/s. The drive page's map switches between Speed and Smoothness, the moments are lettered on it (over the corner marks) and listed under "Most abrupt moments", each with advice from what changed most (steering, brake on or off, throttle on or lift). The elevation profile is faint again (it was filled solid ink).
- How repeatable your corners are (IDEAS D-07, partial): the coach gives each corner how much your braking point and slowest point move across your clean passes, measured on this drive's road with noise-robust marks and a median-based spread (Python and JS, parity-tested, including passes on their own GPS traces). The drive page shows your typical braking-point spread, your steadiest corners (braked clearly on every pass), and, with five or more passes, any corner whose braking point moves 10 m or more and twice your usual ("if it was not traffic or the weather, pick an early, comfortable braking marker"). Identical driving seen through realistic sensor noise is never flagged (tested). A gentle driver who never brakes at 0.2 g or more gets no braking spread. Checked in Chromium with four seeded passes of dry_ridge. A trend over weeks is still todo.
- Fatigue cues (IDEAS D-16): on a drive of an hour's moving time or more, the drive page compares the corners of the first and last thirds (`core/drive_analysis.fatigue`, JS `fatigue`, parity-tested): mid-corner steering corrections (reversals of the lateral-g trend, which a tighter road barely changes) and braking past the middle of corners. It says in plain words when either faded, that the road may have changed or you may be tiring, or that there was no clear fade. Corners with unmeasured g are left out (zero-filled g would read as perfect). Moving time cannot see rest stops (no timestamps in a recording). Post-drive only; a live cue is the follow-up. Tested on dry_ridge driven twice (no cue), with chatter and late braking added late (both cues), and with 60 % harder but smooth late corners (no cue). Driver Score now leaves out a corner with NaN g instead of raising.
- Not verified on a phone: the vertical spike, hazards on phone drives, confirmation labels and spoken coaching all need real drives (two or more of the same road for confirmation and coaching).
- Your records on the Log (IDEAS D-08): the best Score on each road driven twice or more (matched by name, the six most recently driven), marked "a new best" when your latest drive there set it, and this month's smoothest drive and best braking (two or more dated drives this month). Technique only, never speed, time or pace. Rows open the drive. Checked in headless Chromium at phone width with ten seeded drives.
- Unknown camber stays unknown in the bundled drives (IDEAS Q-23): `profile_drive_dataframe` no longer fills bins without cornering load with camber 0.0, `tools/export_web_profile.py` keeps that column's NaN as null, and web/data was repaired without the raw logs (they are not in the repo): every camber of exactly 0 became null (9,610 of 11,451 bins on Dry Ridge, 2,180 of 5,701 on Pebble Ridge): a genuine reading rounding to 0.0 is rare (12 of 1,841 measured bins are within 0.1 degrees), so nearly all zeros were the fill, and blanking a real one only loses a reading. A test keeps any 0 out of the files; when the raw logs turn up, re-export them with tools/export_web_profile.py instead. Events and envelopes are unchanged (unknown camber was already treated as flat); the BANK readout now hides on straights instead of showing +0.0 degrees.
- Line analysis (IDEAS D-18): the coach reads each pass's turn-in from the lateral g (walking back from the corner's peak load, the first bin at 40 % of it; GPS cannot see the car's place in the lane) and projects it onto the drive's road. Turning in 20 m or more sooner than your quicker pass gives "Turned in N m earlier than your best pass: wait for the corner". Unknown, never guessed, in chicanes and linked corners (load building again on the way back), with unknown lateral g, or a run reaching over 40 m before the corner. Checked on both shipped drives with 0.03-0.04 g noise on both passes (3 trials each): identical steering differs by at most 10 m and never tips; 10 m sooner never tips; 25 m sooner tips on 26 of 30 and 9 of 13 corners. Not tried in a car.
- Live break cue (IDEAS D-16): on a live drive, once an hour has passed since the last stop (15 min of frames standing still under 0.5 m/s, or a 15 min gap with no frames that ends within 200 m of where they stopped, or the start; a crawl in a queue or a tunnel does not count), the cockpit reads the driving since that stop every 10 min with `Core.fatigue` in a Web Worker (`web/break_worker.js`, the slice rebased to 0 m). A worker that fails or takes over 30 s counts as unknown and is replaced, so the time cue still comes. It shows "Steering is getting busier. Time for a break?", "Braking is getting later. Time for a break?", or after two hours with no fade "Two hours on the road. Time for a break?" (once a stretch); at most every 45 min. Each kind is spoken once a stretch, from the notes loop, only with a fresh fix, a free voice and no spoken route call or remembered bump within the distance the line takes to say plus 2 s (`ApexRoadMemory.restTick`/`breakCue`, tested). Checked in headless Chromium as the app shell with dry_ridge driven twice on a fast clock: chatter added late gives the steering cue, a steady drive none, and a worker that fails to load raises no error. Not tried in a car.
- Braking consistency by month (IDEAS D-07 trend): the coach lists each pass's braking marks per corner, and `spread_by` (JS `spreadBy`, parity-tested) gives the robust spread of a corner's marks inside each month with five or more passes (three let two passes in one 5 m bin read as 0 m). The Log plots the median over a month's corners (three or more; under 3 m shown as the floor), spaced by real dates, dot size by corners, and only claims steadier or less steady at 5 m or more with five or more corners on both ends. Imports without a date stamp are left out (`date_known`, and older imports stored with the import time). Runs one drive per tick. Checked in Chromium with seeded drives.
- Shipped in this thread since: #101 (D-21, D-22), #104 (Q-22 bump ahead on any road, D-06 Smoothness map), #108 (D-16 fatigue cues, post-drive), #114 (D-07 corner repeatability). None verified on a phone.
- Exact next task: crowd confirmation of hazards across members (backend `hazard_obs` table exists, unused); then a live "time for a break" cue from the D-16 numbers, the weekly trend half of D-07, and D-18 line analysis. Agreement-weighted routing belongs to the routing thread.

## Session 2026-10-28: loops the length you asked for
- #82 merged (fun A→B routing, see the entry below and docs/ROUTING.md).
- Loops: stage plans were sized with crow-fly connectors x 1.6, so in hills they routed 40–75 % long (Knoxville 45 mi request → 99–102 km, ~3.5 h). Now the best 6 reachable stages get one road-distance matrix (`valhallaMatrix` splits it into calls of ≤100 pairs and returns times and km) and `ApexFunRoute.loopPlansFromMatrix` chains 1–3 within 25 % of the target; crow-fly plans stay as the fallback. In Chromium against the public servers, loops land within ~15 % (docs/ROUTING.md, Loops). Not driven on a phone.
- Exact next task: measured road character (surface, camber, crest, passes) as a real routing input for destination routes and loops (WORKER_QUEUE road-3); long A→B trips only get stages around their midpoint (multi-centre search would cover the ends).

## Session 2026-10-28: fun routing from A to B (thread "Make fun-driving routing best in class")
- Audit: destination routes had no fun optimisation at all (one Valhalla call with highways de-prioritised); the route card's Twist/Flow/Surface were always `--` for planned routes (no sectors); every 45 mi loop (and some 30 mi ones) silently fell back to a circle because stage discovery threw "area too large" above 64 tiles (a 14 km radius is 81 tiles at 39°N).
- New web/fun_route.js + `funRoute` in web/index.html (docs/ROUTING.md): Quick / Fun / Max fun level on the Plan sheet and route card; candidates = Valhalla route + 2 alternates + 1–2 corridor stage detours timed with one `sources_to_targets` call; map-only fun score (Twist, Flow, Dull; junction maneuvers removed); ranked by fun + corners gained − time cost within the level's budget; stage points kept as shaping vias so reroutes still drive them. Route card shows Fun/Twist/Flow and "N min (+M for fun)". Stage search now shrinks to 64 tiles instead of failing.
- Tests: tests/test_fun_route.py (new), tests/test_route_loading.py updated for the new router functions. Checked in desktop Chromium against the public servers (Knoxville→Maryville: Fun picks a +30 min stage detour, Fun 79 vs 51). Not driven on a phone.
- Exact next task: make measured road character (surface, camber, crest, flow confidence) a real routing input for destination routes and loops (WORKER_QUEUE road-3), then unify the loop ranking with the fun score.

## Session 2026-10-28: UI polish (owner goal: best-in-class UI)
- Audit method: Playwright at 390×844 (iPhone size), day and night, every tab, empty and with an imported drive (Dry Ridge rows exported to CSV). Map tiles load; the server API is unreachable from the sandbox, so Crew was only seen offline.
- #79: Log has a page title like Stages; empty Log shows one empty state (Go to the map / Watch a replay) instead of blank Latest/Best tiles; no "No drives yet" flash before IndexedDB answers; empty Stages hides the drive picker, New stage and Share older drives until there is a drive; tab bar sets aria-current.
- #81: switches in the While you drive panel and Settings lists use a 44×24 track and report role=switch + aria-checked (repainted on every tap); panel label sentence case; Crew no longer repeats "Crew" (offline: Can't reach ApexNav + Try again; signed out: Drive with friends; no invite: Join with an invite); :focus-visible ring, prefers-reduced-motion, toasts aria-live.
- #83: drive detail leads with the drive's name as the title, date and source ("Recorded on this phone", was "recorded in the web app (GPS)" even in the iPhone app), then Replay · Compare · Share on one row, then the score.
- Not verified on a phone or with VoiceOver: all of the above. Web-only PRs skip the iOS CI jobs; main's run after merge builds the IPA.
- Next UI candidates seen in the audit: the Where to? / Start bar stays over the cluster during a replay; Crew sheet draws two rules under its title; imported drives are named after the file (web_20261027_080000); the live drive cockpit was not exercised (needs real GPS frames).
- Round 2 (all merged): #90 Where to? hides during a replay; #93 account headings, imported drives named "Drive 10/27/2026 8:00 AM"; #94 dial spacing; #97 loops named by real length; #99 main's iOS runs are not cancelled by the next merge; #102 iOS app: confirm/prompt/alert dialogs work (WKUIDelegate; Unfriend, Leave crew, Delete account did nothing before); #103 plain-language errors, "Recenter in 6s" with a 44 px target; #105 drive bar shows big "● Rec 0.46 mi" with only problems below, and only that line is aria-live; #106 every text token holds 4.5:1 (axe-core pass on map, replay, Crew, Settings, Log, Stages; tests/test_themes.py enforces it).
- Not verified on a phone: the iOS dialogs (simulator tests and IPA build passed), the drive bar with real GPS, VoiceOver, sunlight. Crew signed in was not seen (sandbox can't reach the API).
- (round 2) Next UI task was: docs/IDEAS.md U-18 (native-looking selects in Compare and voice), U-15 Dynamic Type/VoiceOver in the simulator, U-07 rest (one note readable at arm's length).
- Round 3 (all merged): #109 selects drawn the same on both pages (no iOS gloss), drives named "Name · date" in pickers; #110 onboarding takes focus, voice buttons report aria-pressed, plainer sign-in copy; #113 mount row in the permissions sheet (app only) and a "Mount set" toast when calibration locks; #116 recorded drives named after the road that carried a third of them, from the map's own tiles (web/road_names.js, nothing leaves the phone); #130 pace notes slide on when the lead note is passed (off under reduced motion).
- Not verified on a phone: the calibration toast and road naming with native frames, the select look in iOS WebKit, the pace note slide at 60 fps.
- Exact next UI task: docs/IDEAS.md U-13 road character layer on the map, U-15 Dynamic Type/VoiceOver in the simulator, U-07 rest.

## Session 2026-10-27: morning-commute push (owner goal: everything discussed, in production)
- Merged: #73 (nearby suggestions; route kept across tab switches; smooth pull-up sheet; route bar with Start/✕; routes start quiet with a destination pin and fly-to, follow paused until Start drive or FOLLOW; Apple MKLocalSearchCompleter place search in the app, Photon on web; voice audio to Bluetooth/CarPlay: .playback/.voicePrompt + .duckOthers/.interruptSpokenAudioAndMixWithOthers, active only while a prompt plays, web clips bracket with voiceBegin/voiceEnd).
- #75 (polish, landed via #77 after merging main in: the only conflict was the end of ApexNavApp.swift, where polish's WKWebView keyboard-bar extension and main's search/voice delegate extensions were both kept): drive log on a phone no longer has the sticky map scrolling over content; readout above the tab bar + home indicator; keyboard ‹ › Done bar removed (runtime subclass of WKContentView); Stages is one list, tap a stage for board and runs, New stage button, sharing older drives folded away.
- #76 (crews, merged): migration 0007 (crews.visibility/about/area_name/area_lat/area_lon, area rounded to 0.1°) applied by hand to apexnav-db and apexnav-preview-db on 2026-10-27; PUT /api/crews/:id (owner settings), GET /api/crews/discover?lat&lon (public crews within ~55 km, no members/owner/exact point, blocks respected), POST /api/crews/:id/join (public only). Crew sheet: your crews as tiles (open one for details, owner can make public/private), Crews near you with Join, create private or public with an area name, friends in a side pop-up (button shows new requests).
- Not verified on a phone: car audio routing, Apple search, quiet destination view, crews against the real server (checked with stubbed API responses in the browser).
- Not verified on a phone either: app-open road sharing, auto mount calibration, the drive log scroll fix, no keyboard bar.
- Next after this session: owner installs the IPA from main's "iOS Build & Simulator Tests" run and drives the commute (traffic: see the session above).

## Session 2026-10-27: navigation redesign and app-open road sharing
- #69 restored #66's cockpit fixes, which my resolution of #65's merge conflict (`git checkout --ours web/index.html`) had dropped from main. Lesson: never take a whole side of a conflicted file; merge hunks.
- #70 (navigation, owner decisions): tabs Map · Log · Stages · Crew · Settings; Plan is a pull-up sheet over the map ("Where to?" + compact Start; recent places and saved spots to route without typing); Notes/Voice/Cameras/Night on an edge tab over the map; no cog. In the app `locate()` uses the shell's GPS frames (no WKWebView location prompt every launch). Web idle map follows browser GPS and starts at the last known position, not a fixed demo road. No selecting UI text / callouts; 16 px fields. Map canvas follows its container size.
- App-open sharing (branch claude/app-open-sharing, on top of #70): `ApexContributor.createAmbient` shares road data from native frames whenever calibration is `locked`, cut into trips (3 min stopped, 10 s frame gap, 150 m jump, mount lost) so each trip's first/last km stays private; pauses 10 min after a refusal. Native drives no longer run their own sharer (no double upload). Settings shows a Road data line; the drive line shows the same sharer. Web still shares only during drives (no mount calibration in a browser).
- Not verified on a phone: any of the above. Untested in the app: the ambient sharer with real CoreMotion/GPS frames and real uploads.
- Exact next task: owner test on the IPA; then Crews (tiles, local suggestions, public + private, friends as a side pop-up), Stages simplification, polish (drive-log scrolling overlaps, keyboard accessory bar, remaining web-feel issues), iOS-only traffic.

## Session 2026-10-26 (end): main has everything; one agent only
- The owner shut down the earlier multi-model harness (queue/loop). One Claude Code session now works the repo; docs/WORKER_QUEUE.md and docs/LOOP.md are kept as a record, not a running process.
- Merged to main: #63 (no false acknowledgements), #64 (no lost uploads, no NaN scores, camber/crest kept, automatic mount calibration, IMU g only when calibrated, calibration in the drive line), #66 (toasts clear the Dynamic Island, one divider on Plan/Crew, no start links, 12-hour time), #65 (crest averaged over measuring passes, peak unweighting shared), #67 (route loading deadlines, black-screen recovery, unknown curvature null; recovered harness work).
- Migration 0006 (`road_bins.crest_n`) applied by hand to both D1 databases (apexnav-db and apexnav-preview-db) on 2026-10-26 before #65 merged; `d1_migrations` still only records 0001.
- The owner's old uncommitted main checkout is stashed (`stash@{0}`, "pre-reset 2026-10-26"); everything in it is on main.
- Not verified on a phone: uploads over a full drive, calibration timeline, black-screen recovery (WebGL context loss / background kill), Dynamic Island spacing.
- Exact next task: owner installs the IPA from main's iOS build and drives once (check shared km, `Calibrating` line clears, a score, no black screen after routing). Then the redesigns with the owner: Plan as a sheet over the map with prefilled places, Settings tab without the cog, smaller Start drive, Crews as groups (several per person), Stages, polish; traffic as a fun penalty; monetization (docs only so far, see conversation).

## Session 2026-10-26: road data upload loss (owner report)
- Evidence: production D1 `upload_counts` for the owner's 17:03 EDT drive (bucket `2026-10-26T21`) shows 21 uploads, 4.545 km, against a 7.4 mi (11.9 km) recorded drive. By design about 2 km never leave the phone (first and last km), and residential/service roads are skipped; the rest was lost. The server stores no drive logs, only anonymous `road_bins`.
- Causes found in the code: (1) `ApexSync.contribute` turned any network error into `'stop'`, so one blip ended sharing for the rest of the drive; (2) 5xx/429 returned `false` and the live streamer advanced past the chunk, dropping it; (3) each 100-row chunk dropped road pieces under 20 rows on either side of a chunk edge; (4) `finish()` left up to 99 settled rows unsent.
- Fixed: `contribute` returns `'retry'` for network/429/5xx and `'stop'` only for 401/403. `createLive` keeps built chunks in `pending` and resends the identical payload with backoff (30 s doubling, capped at 5 min; the server merges a repeated chunk once). Chunks end on a road boundary (`settledEnd`: a road still running keeps its last 25 rows for the next chunk). `finish()` flushes the settled rest. Privacy trims unchanged. New tests in tests/test_contributor.py fail on the old code (blip lost 200/800 rows; edge lost 14-15 rows) and pass now. `pytest tests`: 133 passed, 2 skipped (run with PYTHONUTF8=1 on Windows).
- Not fixed / not verified: a chunk still failing when the drive ends is dropped (no cross-drive queue; road-queue is the planned durable queue). Not run on a phone. iOS screen lock suspending the web view is not addressed.

## Session 2026-10-26: drive score NaN (owner report)
- Cause: the phone recorder (web/sensors.js `Recorder.toCsv`, used by the iOS app too) writes `camber_deg` blank on every row, and `ApexRecording.parse` turns blanks into NaN. `apexSpeedMps`/`effectiveMu` (and Python `apex_speed_mps`/`effective_mu`) let NaN camber or roughness through, so the whole braking envelope and every corner's `apex_mps` were NaN and `driverScore` returned NaN. A few blank roughness cells alone spread NaN along most of a drive through the backward braking pass.
- Fixed in JS and Python together: unknown (NaN) camber counts as flat and unknown roughness as full grip, exactly as a missing column already did; the record still stores them as null. `driverScore`/`driver_score` leave out a corner with any blank speed or an unknown limit. analysis.html turns any non-finite score into null so the Log shows `--`. ApexKit has no copy of this math.
- Tests: tests/test_road_dna.py, tests/test_drive_analysis.py, tests/test_recording_replay.py (a recorder-shaped CSV through `ApexRecording.parse` to a finite score). `pytest tests`: 136 passed, 2 skipped. Drives already saved on the phone recompute their score when the Log loads, so they should show a number after the update; not checked on a phone.

## Session 2026-10-26: camber/crest from the iOS IMU, and mount calibration
- Why camber was blank: the native pipeline computes it and sends `camber_deg` in every live frame, but web `Recorder` never stored it and `toCsv` hard-coded a blank; `feedLive` uploaded roughness only. Production D1: 0 of 909 `road_bins` have camber or crest. The live frame also lacked crest.
- Fixed: ApexNavApp.swift adds `crest_vertical_g` to the live frame (not compiled locally: no Swift on Windows; CI builds it). `Recorder` keeps `camber_deg`/`crest_vertical_g` only when the frame says `calibration: 'locked'`, and the CSV gains a `crest_vertical_g` column (before `source`). `feedLive` uploads camber. Crest is recorded on the phone but not uploaded: the server's `crest_peak` running mean divides by every pass including ones without crest, and crest sign semantics vs the server's 0..3 range are unresolved (noted in ARCHITECTURE.md §1). tests/test_sensors.py covers locked vs default/awaitingPull. `pytest tests`: 137 passed, 2 skipped.
- Calibration finding (important): nothing in the web UI ever sends the `calibrate` message, so `zeroMountCalibration()` never runs. The app starts with a hard-coded mount rotation solved from one old iPhone 15 Pro log (state `default`) or a persisted one (never written, since calibration never runs). It never updates and nothing detects a phone mounted after start or remounted mid-drive. So in the shipped app every frame is `default`, and with this change camber/crest stay blank until calibration really works. The same fixed rotation also feeds lat_g/lon_g/yaw (score, camber estimate) and the vertical axis (roughness, crest), so those are only right if the phone sits like that one log.

## Session 2026-10-26: automatic, continuous mount calibration
- core/live_pipeline.MountCalibrator and ApexKit.MountCalibrator now calibrate by themselves (method and thresholds in docs/ARCHITECTURE.md §1): vertical from 2 s of steady CoreMotion gravity, forward from GPS dv/dt (throttle and braking, signed) and v·yaw in turns, continuous refinement, remount detection (gravity swing / off-vertical rotation -> `default`), swivel-about-vertical detection (disagreeing evidence -> `awaitingPull`), saved mount reused only if gravity agrees within 8°. The old straight-pull lock (which locked backwards if the first hard input was braking) is gone; `lock_vertical` stays for the unused manual "calibrate" message. `IMUPipeline.step` takes gravity (`gravity_g` / `gravityG:`).
- ApexNavApp.swift: starts from an unknown mount (the hard-coded Pebble Ridge rows are deleted), passes CoreMotion gravity to every step, restores a saved mount as "trust once gravity agrees", saves on every new lock, no longer speaks "Forward axis locked".
- Fixture regenerated (60 s: handheld start, crooked mount, brake, banked turn, remount while cruising at 32 s, relearn, crest): default -> awaitingPull 5.5 s -> locked 9.0 s -> default 32.7 s -> awaitingPull 37.3 s -> locked 41.0 s, mount error < 0.001° (clean synthetic data), camber 4.05° in the 4° turn. New Python tests: braking-only lock, turns-only lock, swivel relearn, saved mount match/mismatch, no gravity stays unknown. `pytest tests`: 142 passed, 2 skipped; `make_live_fixture.py --check` fresh.
- NOT verified: `swift test --package-path ApexKit` and the Xcode build were not run (no Swift toolchain on this Windows machine); first run will be CI. Swift fixture tests compare rows at 1e-9 (was 1e-12) and check both mounts at 1e-3 against the truth. Not tried on a phone: real CoreMotion gravity noise, GPS speed lag and road grade/bank may need threshold tuning. lat_g/lon_g are still recorded while `default` (the score uses them); consider blanking them like camber.
- Exact next task: push a branch so CI runs `swift test` and the iOS build; then a real drive checking the `calibration` field timeline. Then the owner's iOS list: freeze/black screen after routing (see the uncommitted route-loading patch below), Dynamic Island overlap, extra divider on Plan/Crew, 12-hour time, remove the Plan a route / Watch a replay links; then the Plan-on-map sheet, Settings tab, Crews as groups, Stages, polish.

## Loop tick (2026-10-26): convoy transport decision
- Started isolated convoy-relay on Codex sol medium against the frozen shared design: actual local API/socket multi-client tests, feature disabled by default, no production operations or native/UI edits. Assessment removed from active registry; no waiting/polling. This tick changed design/queue docs only, so no new runtime-test result is claimed.
- main remains aligned with origin/main at 3cb86cc; latest core, Pages and iOS checks green. No local-worker jobs; Ollama running. Preserved all owner docs and the uncommitted iOS route-freeze patch. No merge/deploy.
- Consumed transport assessment and verified canonical config is root wrangler.jsonc (the audit missed it). Reviewer selected a small authenticated DO WebSocket relay as the first isolated slice, with replaceable transport and WebRTC still a future option. Frozen boundaries and draft operational bounds are in docs/CONVOY_TRANSPORT.md.
- Tightened audit recommendation: no tickets in WebSocket URLs; use a bounded first-frame one-use-ticket handshake. Do not persist anchors/event bodies to survive hibernation. Initial standard sockets retain live replay only in memory; actor reset requires fresh epoch/authorization. Control metadata only may persist with expiry/cleanup. No claim of enforceable deletion from another device or guaranteed delivery without connectivity.
- Exact next task: build and locally test authenticated convoy create/join/ticket/connect/publish/leave plus two-follower fanout, revoke/expiry/restart and log/storage privacy; then review before source/quality, native detector, path relevance, UI and priority-speech integration. Continue road queue/lifecycle contracts alongside this; neither foundation is shipped or phone-validated.

## Loop tick (2026-10-26): queue review and convoy transport
- Final isolated queue validation: 135 tests passed, 2 skipped; Node syntax and diff whitespace checks passed. Started bounded read-only convoy transport decision evidence on Codex luna low; completion will wake the loop, no waiting/polling. Completed queue removed from active registry; its uncommitted worktree remains preserved for integration review.
- main matches origin/main at 3cb86cc; latest main core, Pages and iOS checks remain green. No local-worker jobs; Ollama running. Preserved all uncommitted owner docs and the separate local iOS route-loading patch; no merge or deployment.
- Reviewed road-queue in isolated t3-a44f6c86 and fixed auth pause being cleared by enqueue, opt-out taking effect only after queued sends/purge, and thrown ack-shaped errors being accepted as successful sends. Added regression cases; focused queue plus web syntax run passed 31 tests. Opt-out now blocks subsequent sends immediately even if purge fails; an already-started request cannot be unsent, and purge still waits for that sender to settle.
- Queue remains an unintegrated foundation: actual IndexedDB transactions/browser persistence are not validated, auth/opt-out and retry backoff are instance-local, sender deadlines must be supplied, and the backend does not yet implement its matching-ID acknowledgement contract. Do not claim cross-page privacy revocation or end-to-end durable uploads. No PR/commit was made for this foundation.
- Exact next task: complete a bounded official-source WebRTC versus authenticated relay assessment, explicitly resolve SOCIAL's peer-to-peer preference and select the smallest implementable convoy transport before another generic audit. Then build authenticated create/join/leave/revocation plus the existing event ledger, while integrating road queue only after privacy/lifecycle and acknowledgement contracts are fixed. Physical-phone road/convoy/route-freeze acceptance remains unperformed.

## Owner iOS route-freeze report (2026-10-26)
- Validation after this patch: 129 Python tests passed, 2 skipped (including route-loading/heartbeat/fallback/retry tests and web syntax checks); git diff --check passed. project.yml and .github/workflows/build.yml parse as YAML and their existing whole-web-folder resource configuration is unchanged. No iOS compilation or physical-phone run was possible on this Windows host.
- Owner reports the iOS app appears to freeze while loading a route; destination vs loop vs replay and physical-device traces are not yet available, so the exact on-phone cause is not confirmed.
- Local mitigation: search/router/map-matching/tile requests now have deadlines covering both response headers and body reads, with abort and timeout recovery. Optional membership lookup can no longer hold up loop selection indefinitely. Route analysis yields between existing core phases; stage discovery yields between scoring batches and reports actual progress. Loop failures release controls and show a retryable error; stale live reroutes are checked again after asynchronous analysis.
- Physics formulas, 5 m spacing and unknown measurement values are unchanged. New Node regressions execute the actual loader and extracted application functions for hung fetch/body reads, HTTP/parse failures, primary-router fallback, retry controls, timer heartbeats and unchanged core output. No native file or build configuration changed; web assets are already included by project.yml.
- Exact next task: validate a rebuilt IPA on the owner's phone for the reported route type, plus destination and loop loading under good/poor connectivity. Check map/tab responsiveness, fallback/error recovery and retry; if a freeze persists, capture its last visible loading phase and a Web Inspector/native trace. This is a local patch, not a deployed or phone-verified fix. Preserve owner priority docs and completed isolated road-queue work awaiting review.

## Owner priority update 2026-10-26: live convoy hazards
- Reviewer validation in isolated convoy-events worktree: 135 Python tests passed, 2 skipped; Node syntax check and diff whitespace check passed. These are simulated module/regression checks, not browser persistence, authenticated transport, sensor detection or physical-phone validation.
- Convoy audit consumed: Crew membership is not live-session consent; no authenticated convoy transport exists, and priority speech is incomplete across WebAudio/browser/native paths. Preserve SOCIAL's WebRTC-first preference; transport selection remains open pending a bounded peer-to-peer versus relay assessment. No transport decision or end-to-end warning claim was made.
- Reviewed isolated convoy-events foundation in t3-9da1d14b. Fixed missing/null anchor coercion, unknown-path relevance, mutable received envelopes, insecure UUID fallback and stale Cancel handles crossing sessions; added four reviewer regressions. Foundation remains unintegrated and uncommitted: no authenticated relay, validated detector, matching, priority speech, page continuity or phone evidence. Draft latency target remains unmeasured.
- Started isolated Codex sol medium road-queue foundation: bounded durable retry queue for already matched/privacy-filtered chunks, persist-before-send, explicit acknowledgements, collision rejection and opt-out. Only new web/road_queue.js and tests/test_road_queue.py; no network integration or production calls. Exact next task: review queue storage/ack tests when it returns, settle convoy transport and versioned source/quality contracts, then implement app-open ownership plus authenticated warning integration in narrow slices. Keep roadmap/UI checkpoints and all owner docs intact.
- Loop tick: main 3cb86cc; no local-worker jobs, Ollama running. Convoy session/speech audit and event ledger review completed; road-queue is active. Draft road-ack #63 has four green checks and remains unmerged. No relay/sensor/UI integration or shipped-warning claim yet.
- Convoys with real-time hazard streaming are a coequal top priority alongside full road intelligence. Leader pothole evidence must promptly reach every approaching follower's co-driver as a spoken warning, independently of personal drive recording.
- Relay live provisional events immediately; do not wait for profile uploads or multi-pass verification. The three-second cancel window retracts an already-sent alert rather than delaying initial delivery. Include path/direction relevance, deduplication, expiry, reconnect and clear connection/audio states.
- Queued convoy-1 through convoy-3 in docs/WORKER_QUEUE.md and aligned LOOP/PHILOSOPHY/SOCIAL. This is a priority/specification update, not a shipped feature or a real-phone latency claim. Exact next task: loop audits existing convoy/session/sensor code, sets the event contract and latency budget, then implements a small end-to-end leader-to-followers slice alongside the shared road collection foundations.
- Started convoy-1 design/audit alongside the ongoing app-open sensor audit. ARCHITECTURE section 7 is a proposed shared-acquisition/two-consumer-path design: immediate provisional convoy transmission plus retraction, separate durable anonymous road processing; target p95 <=1.5 s detector emission to actual speech start (unmeasured, not a guarantee). Codex sol medium is auditing session/auth/relevance/speech boundaries and isolated multi-client plus phone checks.
- Road contract/routing audit returned: full evidence/source/confidence is not preserved; missing curvature can become zero; SQL catch-all may falsely acknowledge failed uploads; current measured routing is only a small final roughness adjustment. These are active implementation gaps, not fixed behavior. Exact next task: combine lifecycle and convoy audit results into narrow parallel builds for shared foreground collection and the smallest authenticated leader-to-followers warning slice, while defining versioned road evidence/aggregation/routing contracts. No merge/deploy or synthetic production report; preserve owner edits and checkpointed UI branches.

## Owner priority update 2026-10-26: full road intelligence
- road-ack reviewed and strengthened locally, draft PR #63 at a07174e: all receipt lookup failures are sanitized/retryable; rollback and concurrent retry tests prove no dropped/uncommitted upload acknowledgment or duplicate reward. Verified 90 backend tests, TypeScript typecheck, 119 Python tests passed / 2 skipped. Existing range-key changed-payload collisions remain unresolved; this is not a complete durable-upload contract. No merge/deploy/device verification.
- Draft #63 at a07174e has all four CI checks passing; remains draft and unmerged under this update's no-merge policy. No new production deployment was requested or initiated. Exact next task: review road-queue, settle convoy transport, and integrate app-open acquisition and authenticated warning delivery; keep owner docs and earlier UI checkpoints intact.
- Highest loop priority: full supported road-data upload, processing and major influence on route discovery/generation/ranking. Roughness-only uploads and a small final-loop tie-breaker are insufficient.
- Collect/share whenever the app is open, with sharing enabled and permissions granted, independently of personal recording and across all tabs/pages. End drive must not stop sharing. Unsupported measurements/background operation must not be claimed.
- Detailed work and acceptance criteria are queued first as road-1 through road-4 in docs/WORKER_QUEUE.md; docs/LOOP.md points to them. This scheduling update does not claim implementation or real-device verification.
- Checkpointed overlapping UI work locally, without pushing or merging: Stages ab88011 in t3-1d0d67b6; place suggestions 1d2cd46 in t3-b4b708be after stopping its active delegate. Both worktrees retained; Stages has reviewer findings and suggestions is unreviewed. Checkpoint metadata is in .worker/checkpoints.json.
- Audit starts from the existing recording-bound live contributor, native foreground sensor pipeline, privacy filtering, /api/contribute aggregation and measured routing adjustment. No road-data capability is newly implemented or phone-verified by this checkpoint. No merge or production deployment is authorized by this reprioritization step.
- Exact next task: complete road-1/road-2 lifecycle, contract and privacy audit; define reviewable collection/queue, ingestion/aggregation and routing slices plus isolated end-to-end and real-phone acceptance checks. Keep unsupported measurements null and separate personal recording, anonymous learning and private social sharing.
- Read-only audits dispatched: Codex Luna low for evidence contracts/backend/routing and Antigravity Flash Medium for app-open lifecycle/privacy/acceptance. No implementation task has been dispatched yet; review findings before assigning small non-overlapping builds. Owner doc edits remain uncommitted and preserved.
- Both road audits returned. Confirmed lifecycle gaps: native 5 m nodes only reach recording; web uploads start/end with recording; analysis has no native frame receiver; volatile JS buffers do not survive page navigation. Started narrow road-ack implementation on Codex Luna low: genuine successful/duplicate upload acknowledgement with local D1 fault-injection tests, no schema or sensor math changes. Convoy audit continues in parallel; the convoy vertical slice does not depend on completing road aggregation/routing.
- Audit proposals are not accepted facts: do not invent native spike output that ApexKit does not currently expose, claim browser alignment is intrinsically impossible, treat proposed 2.5-minute dwell/20-minute rotation as validated privacy thresholds, or assume a chunk-count bound equals a distance bound. Privacy/availability contracts need explicit review; raw unsent GPS is not an anonymous durable upload. No implementation or actual phone verification is claimed yet.
- Exact next task: review convoy session/speech audit and road-ack implementation; design foreground node delivery and privacy-gated durable queue plus immediate session relay as separate small builds. Keep all current owner doc edits; no merge/deploy in this update.

## Session 2026-10-25: honesty + foundation reset
Previous sessions claimed features that were faked. This session removed every fabricated
value and rebuilt the stack on a tested headless core.

### Removed (was fabricated)
- Flock/police pins generated by `sector_id % 18 == 4` / `% 28 == 11`, "Reported 12m ago" text, pothole gating by `sector_id % 22 == 7`, fixed `passes`, invented sector names.
- "Verified" closed loops built from a Bezier curve with sine-wave elevation and constant roughness.
- OSRM routes padded with sine-wave elevation, invented lateral G and camber.
- Hardcoded Octane counter (1,420 OCT + 3/km during replay).
- Duplicate, inconsistent corner/score/target-speed math in the UI.

### Completed
- [x] `core/road_dna.py`: curvature, rally pace notes (1–6, hairpin, modifiers), manifesto apex speed, braking envelope, IMU hazards, 4-axis Stage DNA (CLEAR null without ALPR data). Spec in ARCHITECTURE.md §3.
- [x] `web/apex_core.js`: parity-tested JS port for live routes in the browser / iOS WebView.
- [x] `core/kinematics.py`: camber no longer diluted by zeros on straights (NaN-mean); new `vert_peak_g` per bin for the manifesto's >0.35 g spike.
- [x] `tools/export_web_profile.py`: rebuilt on road_dna; `--reprofile` re-derives existing exports; `--alpr` folds real camera positions into CLEAR. Both shipped drives re-profiled: Pebble Ridge 12 corners / 7 bumps / 6 crests / 6 dips; Dry Ridge 28 / 19 / 11 / 3.
- [x] Cockpit `web/index.html` rebuilt to PHILOSOPHY.md: 80/20 topo stage + Halda binnacle (rolling drum trip odometer, VDO speed dial with PACE bug, spirit-level G-ball with bank inclinometer, toggle switches STAGE/VOICE/LPR/DNA/NIGHT), Daylight Topo Paper with DEM contours + olive hillshade, Night VDO Phosphor, opaque pace-note strip, speed-aware braking ribbon, no emoji, no 3D buildings, route drawn per 500 m sector (no confetti).
- [x] Live DeFlock/OSM ALPR: Overpass (3 mirrors, 7-day cache) for the route bbox; cameras within 60 m become LPR pace notes and set sector CLEAR. Failure is reported, never shown as clear.
- [x] Adaptive co-driver: cruise = LPR + severe bumps only; full notes when STAGE is on or spirited driving is detected (|lat| > 0.30 g or |lon| > 0.35 g in the last 30 s). Notes called once, ~5 s ahead.
- [x] Live mode: native `window.apex.live` frames now drive the puck, dials and map-matched pace notes (previously only the speed number). iOS speech queues instead of dropping notes.
- [x] Tests: `pytest tests -v` → 15 passed, 2 skipped. The skips are the raw Sensor Logger zips for Pebble/Dry Ridge, which are not committed (the old suite "passed 3/3" by pointing at a fixture that never existed and returning early). New: synthetic end-to-end Sensor Logger ingest, road_dna unit tests, JS/Python parity (incl. a real logged drive), and a guard that shipped data contains no fabricated event types.
- [x] CI: `.github/workflows/core-tests.yml` runs the suite on every push.

### Active bugs / limitations
- Swift shell was edited (speech queue) but not compiled in this session (no macOS runner here); `build.yml` will verify on push to main.
- Loop builder routes through 3 circle waypoints on OSRM; it can pick interstates. Choosing roads for character needs crowdsourced DNA.
- Native Swift still duplicates camber/roughness filtering for live frames (rule: math belongs in `/core`). Needs `/core/cpp` or a shared port.
- Exported drives carry the driver's own speeds per 5 m (fine for private replay; must be stripped before any public profile sharing per the zero-snitch rule).
- Shipped exports predate `vert_peak_g`, so their bumps use the 5 m RMS > 0.25 g proxy. Re-export from the raw zips to get true spike peaks.
- OSRM demo server and Overpass are rate-limited public services; fine for prototyping only.

## Session 2026-10-25 (b): re-export from raw Sensor Logger logs
- [x] Raw zips for both drives supplied (kept local, gitignored: they contain precise home-start GPS). `pytest tests -v` → **18 passed, 0 skipped**; the two real-drive invariants run for the first time.
- [x] Both drives re-exported from raw with true per-bin spike data (`vert_peak_g`).
- [x] Found: a single 100 Hz sample > 0.35 g fired 101 "bumps" on Dry Ridge (one per ~570 m) — mostly phone-mount rattle, plus phone handling at the start/end of each recording. Fixed in core: spike = peak 50 ms RMS of the >8 Hz band, and must exceed 6x the surrounding ~200 m roughness (steadily broken pavement is SURF's job). Exporter ignores hazards below 2.5 m/s. Now Pebble Ridge 7 bumps, Dry Ridge 21.
- [x] Camber now averages only cornering samples (previous session's fix) — median turn-relative bank on Pebble Ridge reads +2.9°, not the diluted +0.4°.

### Active bug: single-pass bumps are not repeatable
Dry Ridge re-drives 100 % of the Pebble Ridge route, yet only 1 of 7 Pebble bumps (at 18,410 m) reappears within 8 m on the second pass. Wheel-path differences explain some misses, but single-pass bump detections must be treated as unverified.

## Session 2026-10-25 (c): road intelligence, themes, analysis, Swift testing
Direction from the owner: themes A/B/C/AB as native components; no fixed speed cap (show
posted limit + sightline speed); Swift truly tested; plan social; drive analysis; road
scoring and routing must be the core advantage. Full design: docs/ROAD_INTELLIGENCE.md,
docs/SOCIAL.md.

- [x] **Sightline physics, no cap**: geometric sight distance (curve chord clearance M = 4 m +
  crest ray-cast on elevation) and stopping-sight speed; envelope = min(corner, sight).
  Posted limits from OSM via Valhalla map matching (exporter + cockpit routes). Dial shows
  PACE, SIGHT and LIMIT separately.
- [x] **Reference lap scoring (`core/reference_lap.py`)**: simulate a sane driver in a car
  profile (braking envelope, sim cruise, power/drag/grade acceleration); TECH/FLOW from
  per-minute experience (engagement, cadence regularity, esses transitions, braking per
  cornering load, dead time, vertical events, hairpins, blind corners); archetypes
  (Switchbacks, Esses, Technical, Rollercoaster, Flowing sweepers, Fast open, Town,
  Connector). Archetype ordering tests on synthetic roads.
- [x] **Themes (`web/themes.js`, `web/instruments.js`)**: Stage (AB, default), Roadbook (A,
  tulip roadbook boxes, printed gauges), Instrument (B, flat graphite), Telemetry (C, race
  dash with pace lights). Day/night per theme; picker in the route book.
- [x] **Routing**: Valhalla with highways de-prioritised (OSRM fallback), limits per sample.
- [x] **Drive analysis (`core/drive_analysis.py`, `web/analysis.html`)**: per-corner time,
  entry/min/exit, brake point, peak g, envelope use, apex offset, smoothness; B measured over
  A's stretch by location; cumulative delta; stops flagged and excluded. JS parity on real drives.
- [x] **Swift**: `core/live_pipeline.py` specifies the causal live pipeline; `ApexKit` (SwiftPM,
  no UIKit) implements it and replays `ApexKit/Tests/Fixtures/live_fixture.json` to 1e-9
  (passes on Linux here). `ApexNavApp.swift` delegates all live math to ApexKit.
  CI: ApexKit on Linux + macOS; simulator UI test launches the app and checks the web
  cockpit boots; IPA build on every push.
- Tests: `pytest tests -v` → 35 passed; `swift test --package-path ApexKit` → 5 passed.

- [x] **Rally pace-note grammar** (McRae 1-6, per the owner's guide): +/- within a band, Square /
  Acute / Hairpin, long/short, tightens/opens, over crest, caution ladder (care → triple caution,
  scored from approach speed ratio, blind entry, tightening, off-camber, crest), and chaining:
  "into"/"and" for notes < 25/60 m apart, otherwise the rally distance ("Left 4 minus long, 150").
  Python + JS at parity. Not done (no data to support them honestly): cut/don't cut, jump, water.
- [x] **Camera rig**: spring-damper follow on its own 60 fps loop; look-ahead position, bearing aimed
  2-4 s down the road (whips into corners), zoom/pitch breathe with speed. Steady / Dynamic / Whip.
- [x] **Voice**: Co-driver (best installed voice, British first, distances read "one-fifty") and Jarvis
  (robot voice where installed, chirps, machine-speak readout). Native iOS picks Premium/Enhanced voices.
- [x] Simulator UI test fixed: the cockpit was booting; the test queried text that WebKit hides inside
  the map region. Now asserts RUN/ROUTE controls and a live pace note.

### Active bugs / limitations
- ~~Ramp loops (cloverleafs) read as "Switchbacks"~~: fixed by R-34 (edge use from map matching vetoes ramps) for profiles exported with limits.
- ~~Sight offset M is a constant 4 m~~: per sample from landcover on planned routes (Q-09); the drive exporter still uses 4 m.
- Single-pass bumps are unverified (1 of 7 repeat); multi-pass store still to build.
- Route scoring (archetypes/axes) exists only in Python; routes in the browser get corners,
  sight and envelope but no Stage DNA until the reference lap is ported to JS.
- Loop routing uses snapped circle waypoints (best of 3); stage discovery + chaining (ROAD_INTELLIGENCE §7) not built.

## Session 2026-10-25 (d): loops, squares, camera, open-model voices, Driver Score history
### Completed
- [x] **Loops**: waypoints snapped to tertiary–primary through-roads (Valhalla `search_filter`),
  dead-end spurs removed (`removeSpurs`), best of 3 candidates by retraced share. 0 U-turns in 4 trials.
- [x] **Square vs hairpin**: valley split + core-share split; two left squares at a junction are no
  longer one hairpin (tests `test_two_left_squares_are_not_one_hairpin`, `..._junction_square_...`).
- [x] **Camera**: spring-damper chase rig (sway with lat g, brake dive, zoom punch, road-texture shake),
  feel steady/dynamic/whip; touching the map pauses follow, "FOLLOW IN 6" then glides back.
- [x] **Voices**: Kokoro-82M (Apache-2.0) voice banks George/Daniel/Emma/Jarvis stitched from structured
  notes; live dynamic phrases via kokoro-js (WASM q8) with prefetch, device-TTS fallback after 1.5 s.
  See docs/VOICE.md. Cloning engine (Chatterbox) planned, needs a consented sample.
- [x] **Driver Score** (`core/drive_analysis.driver_score`, JS `driverScore`): 0–1000, pace 40 /
  smoothness 25 / braking 15 / consistency 20, × legality. Legality is `None` (shown `--`, multiplies
  as 1) when no posted limits are known — never a perfect mark by default.
- [x] **Segments** (`segment_window`/`segment_pass`): custom stretches, direction-checked, length ratio 0.7–1.3.
- [x] **Browser profiler** (`profileRecording`) matches `tools/export_web_profile.profile_segments`
  exactly on identical input (parity test).
- [x] **web/analysis.html rebuilt**: HISTORY (every drive, Driver Score, component bars, trend),
  SEGMENTS (drag a range on any drive, name it, every pass ranked by Driver Score, time private),
  COMPARE (corner by corner, kept). Imports ApexDrive CSVs from the iPhone app, profiles them in the
  browser, fetches posted limits via Valhalla, stores in IndexedDB. Verified with Playwright (import,
  segment create, persistence across reload, no console errors).

### Active bugs / limitations
- Segments and imported drives live only on the device (localStorage / IndexedDB) until accounts exist.
- Friend/crew leaderboards, profiles, route sharing: designed (docs/SOCIAL.md), no backend chosen yet.
- Valhalla/OSRM demo servers are not for production traffic.

## Session 2026-10-25 (e): owner decisions, iOS voice fix, voice clone test
### Decisions (owner)
- Driver Score is technique only: **legality removed from the score and from the app**. A perfect
  score is a closed-track figure, not a public-road goal. Posted limits stay on the cockpit as information.
- Friend/crew time sharing: **opt-in per friend and per crew**, never public (docs/SOCIAL.md).
- Backend: zero budget, so Supabase free tier with row-level security; fallback Cloudflare D1 (docs/SOCIAL.md §4).
- No Apple developer account yet: CarPlay is deferred. Android priority is low.
- Routing: on device with Valhalla offline tiles built by free CI (ROAD_INTELLIGENCE §7.4).
### Completed
- [x] Driver Score without legality (Python + JS parity, tests updated); analysis page shows 4 components.
- [x] **iOS voice bug**: the WKWebView loaded file://, and WebKit's fetch() refuses file URLs, so the voice
  banks never loaded and every voice fell back to AVSpeech. The cockpit is now served from
  `apexnav://app/` by `ApexBundleSchemeHandler`. Needs on-device confirmation.
- [x] Chatterbox (MIT) installed at /opt/cbx (py3.11, torch 2.6 CPU, `setuptools<81` for the Perth
  watermarker). The owner's consented sample (in-recording consent at 0–8 s) cloned; test clip sent.
  The sample and the clip are kept out of git (`voice_test/` is gitignored).
### Active bugs
- Chatterbox truncates single-word prompts ("tightens" rendered as 0.24 s). Render tokens inside a
  carrier sentence and cut by word timestamps, or render whole note chains.

## Session 2026-10-25 (f): navigation, busy states, best-road loops
### Completed
- [x] **Tab bar** (ROUTE · DRIVES · ANALYSIS · SETUP) replaces the single ROUTE key. The panel shows one
  view at a time; tapping the open tab, the map behind it (scrim) or swiping it right closes it.
  `index.html?view=route|drives|setup` opens a view; analysis.html carries the same tab bar.
- [x] **Busy state** on loop and GO buttons: label shows the phase (ROADS > SCORING > ROUTING n/N >
  PROFILING), a progress bar and a sweep; sibling loop buttons are disabled while one builds.
- [x] **Best-road loops** (`web/stages.js`, ROAD_INTELLIGENCE §7.2): decodes OpenFreeMap vector tiles
  (z13, transportation layer) around the start, joins clipped pieces into strokes, scores each stroke's
  best 2–10 km window with the core corner detector (good corners/km, −1/3 corner per junction, rejects
  windows that curl back on themselves, e.g. cemetery/park drives), chains 1–4 stages by bearing to fit
  the distance, and routes them through Valhalla (≤ 10 locations on the public server). One circle loop
  is routed as a baseline; the best by corners/km, retracing and length wins. Measured on the Dry Ridge
  start: 15 mi → 46 good corners (circle 46 on a longer loop), 30 mi → 66 (circle 16), 45 mi → 101 (circle 62).
  Tests: `tests/test_stages.py` (synthetic roads, no network).
### Active bugs / limitations
- Loops can run 20–25 % short or long of the target (connector estimate is 1.6 × crow-fly).
- A stage reached by a dead end produces an out-and-back spur (seen: 6 % retraced on a 30 mi loop).
- OpenMapTiles `minor` mixes unclassified and residential; the junction penalty is the only filter.
- Overpass is unreachable from the cloud sandbox, so the ALPR layer could not be tested here.

## Session 2026-10-25 (g): whole-phrase voices, real recording, Opus consults
### Decisions
- Stitched words are audible to the owner: **whole phrases wherever possible** for every voice.
- The owner's voice is **published** (My Voice, id `own`) with their consent.
- Opus is consulted for architecture questions (two consults this session: phrase architecture, runtime clone).
### Completed
- [x] Phrase-aware playback (`ApexVoice.cover`/`joins`/`playWhole`), phrase rendering (`--phrases`),
  mined phrase list from 1,586 real calls, real-recording splitter, recording script, 4,000 training phrases.
- [x] Kokoro voices: whole-call prefetch at route load (renders calls the bank can only join).
- [x] Owner's real recording: 54 of 56 shipped calls cut from the read-through and verified;
  the clone was rebuilt from the clean Part A reference.
- [x] Tests: `tests/test_voice_phrases.py` (51 passing).
### Active bugs / limitations
- The clone cannot speak brand-new phrases whole; see docs/VOICE.md "Path to ANY phrase" (Kaggle fine-tune).
- Clip loudness differs between renders (peak normalisation), which can expose seams.
- Voice banks add ~15 MB per voice to the repo/Pages bundle (`du -sh web/voices`).

## Session 2026-10-25 (h): voices, licence, backend design, Cloudflare
### Completed
- [x] **Whole-phrase voices** for George, Daniel, Emma (896 clips each), **Michael** (American male) and **My Voice**
  (Michael converted to the owner's timbre with kNN-VC + 54 real recorded calls). Pause rhythm from the owner's real
  delivery (breath before the caution ~0.3-0.4 s and before the distance ~0.2-0.25 s; `tts_text`, `spokenText(text, rhythm)`).
- [x] **Licence**: proprietary, all rights reserved (LICENSE, THIRD_PARTY_NOTICES.md). Not open source.
- [x] **docs/BACKEND.md**: local-first backend design (Supabase + Google sign-in, invite-only), points 3x/2x/1x per way+direction,
  reviewed by Opus (privacy leaks fixed in the design).
- [x] **Cloudflare**: Worker `apexnav` serves `web/` (wrangler.jsonc). Live at https://apexnav.senftns.workers.dev/
  (also GitHub Pages at senft5.github.io/ApexNav/web until the repo goes private).
### Owner feedback on My Voice (open)
- "Sounds like me but robotic and stumbles over words." Metrics (speaker similarity 0.83 vs 0.89 ceiling, UTMOS 3.9, word
  match equal to the unconverted source) cannot see this; the conversion keeps the source voice's phrasing.
- Plan: owner records ~30 min of natural calls (generated call sheet from tools/training_phrases.json), then (a) play real clips
  for calls/parts read, with natural pauses, and (b) fine-tune Kokoro on the owner's real data on the RTX 5080 PC (tools/local).
### Active bugs / limitations
- iPhone sideload app only gets new voices when rebuilt; web app is current. Voice picker is in the SETUP tab.
- The espeak-ng GPL dependency of kokoro-js must go before the app is closed-source/sold (THIRD_PARTY_NOTICES.md).
- Clip loudness differs between banks (peak-normalised); an LUFS pass would hide seams.
- web/voices is 66 MB / 4,599 files total on the site; Workers free limit is 20,000 files.

## Session 2026-10-25 (i): Cloudflare backend foundation
### Decisions (owner)
- All-Cloudflare backend (Workers + D1), not Supabase. Google sign-in, invite-only, US only, under 20 users, all rights reserved.
- In-app voice enrollment (a short guided recording inside the app), not a giant call sheet. Voice work is **on hold**.
- Highlights (user scenic points, rated, optional routing bonus), points 3x/2x/1x per direction of each road.
### Completed
- [x] D1 database `apexnav-db` created in the owner's Cloudflare account; migrations 0001 + 0002 applied (22 + 1 tables).
- [x] `backend/` Worker: Google OIDC sign-in (PKCE/state/nonce), sessions, invites, members gate, friends/blocks/crews,
  opt-in grants, boards, segments with sharing. **29 tests** (privacy rules from the Opus review; mutation-checked).
- [x] `wrangler.jsonc`: Worker serves `web/` and routes `/api/*` to `backend/src`; verified locally (`wrangler dev`) and by dry run.
- [x] CI job `backend` (tsc, vitest, wrangler dry-run). docs/BACKEND.md rewritten for Cloudflare.
### Owner to do
- Create the Google OAuth client and set Worker secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL`, `PEPPER` (docs/BACKEND.md section 7).
### Completed (later in session (i))
- [x] Migration 0003 (`road_bins.camber_n`) applied live. 22+ tables.
- [x] `POST /api/contribute` + `PUT /api/me/contribute`: opt-in, date window, ranges, contiguity, hour/day/week caps, hashed one-per-road dedupe.
- [x] Nightly cron (`backend/src/nightly.ts`): 14-day hold, rank by drive date, replay discard, Welford merge into `road_bins`, points 3x/2x/1x in `points_ledger`; `GET /api/points`.
- [x] `GET /api/me/export` and `DELETE /api/me` (`{confirm:"DELETE"}`); audiences named by handle, never by other users' ids.
- [x] Highlights end to end: API (`backend/src/highlights.ts`), planner bonus (`applyHighlights` in web/stages.js), route-panel toggle + strength, Account panel in web/index.html (sign-in, invite, handle, friends, per-friend sharing, points, road-data toggle, export, delete).
- [x] Web segment sync (`web/sync.js`, used by analysis.html): segments get a decimated geometry on save, upload when signed in (idempotent by local id), friends' shared segments can be adopted, the active segment can be shared with a friend. Checked with Playwright against mocked APIs.
- [x] Highlights sync (`web/sync.js` + index.html): SHARE button on your spots (kind picker), planner merges members' shared spots near the start (4 s timeout, offline = yours only, no double counting within 60 m).
- [x] Friends board on the analysis page: best pass per synced segment is published (server delivers only to granted friends/crews); the active segment shows the board. Checked against mocked APIs.
- [x] Phone-side contributor (`web/contributor.js`, 9 pytest tests): Valhalla `trace_attributes` map-matching -> OSM way ids, Overpass way geometry, bins counted from the way's first node, direction from travel along the way; trims 1 km at both ends, skips residential/service roads, unknown roughness leaves the bin out, unknown camber stays null; uploads via `/api/contribute`. Analysis page has a "Share road data" panel for recent imported drives. **Not yet verified against the live Valhalla/Overpass servers or with a real recording** (the container's network is restricted); the shell is tested with a fake fetch.
- [x] Read side: `GET /api/roads?ways=a,b,c` (members only, max 50 ways) returns merged per-bin numbers (n, camber, roughness, crest; null = unmeasured), no contributor info. The phone does not use it for scoring yet.
- [x] Measured-data preview: when a route is opened, members see how much of it other members have measured (coverage, roughness, banked km, passes). `ApexContributor.measuredAlong` (match -> way geometry -> `/api/roads`), 2 more tests. Not wired into loop *scoring*: stage tiles carry no OSM way ids, so scoring by measured data needs a matched candidate route (next step).
- [x] Loop choice uses member data: among the top 3 candidate loops, measured roughness (same scale as core `effective_mu`) can cost up to 6 points; unmeasured roads are neutral. Members only, 12 s timeout, falls back silently.
- [x] Analysis page redesign, step 1: new **DRIVE** tab (default) in `web/drive_view.js`: summary strip, speed-coloured plan map with numbered corners, aligned lanes (speed, lateral g, brake/throttle g, elevation) with corner bands, scrub by pointer/arrow keys, zoom (all, 2 mi, 0.5 mi, 0.15 mi) with pan, corner list that jumps to the corner. Mobile-first; drawn at real pixel width. Fixed a `45:60` time-format bug (also in the segments table). Checked in a browser at phone and desktop widths.
- [x] Analysis step 2: **Road feel lane** on the Drive tab (members only): banking bars and roughness line from `/api/roads` along the drive, gaps shown as gaps (unknown, not zero); readout adds banking/roughness/passes. `ApexContributor.measuredSeries`. Verified in a browser with mocked Valhalla/Overpass/roads replies (mock data only, never shipped).
- [x] Analysis step 3: corner list on the Drive tab compares each corner against your best-scoring other drive on the same road (`Core.compareDrives`, needs >= 30% shared road and 3 clean corners); stopped corners excluded; net seconds shown in the heading and per corner. Checked with the two shipped examples.
- [x] Analysis step 4: "This road over time" on the Drive tab: every drive sharing >= 30% of the road, score chart by date, per-drive net corner seconds vs the one you are viewing, change in points first to latest.
- [x] Analysis accessibility pass: tablist/tab/tabpanel roles with arrow/Home/End keys, labelled selects and inputs, focus-visible outline, reduced-motion respected, the drive scrubber is a keyboard slider (arrows, Shift = 10x, Home/End) with spoken position and speed, labelled zoom and corner buttons. Checked by keyboard in a browser. Not yet tried with a real screen reader.
- [x] History/Compare polish: score chart drawn at real width (readable on phones), drives table drops secondary columns on narrow screens, empty states for no drives, Compare's whole-road delta no longer coloured as a verdict.
- [x] **Real-time road data (owner decision):** no 14-day hold, no nightly job, no cron. `POST /api/contribute` takes `drive_id` and merges each chunk immediately (atomic SQL upsert per bin), pays 3x/2x/1x by arrival order on a person's first drive on a road, ignores retried chunks. Migration 0004 applied to both D1 databases. Cross-account replay check removed (documented). 74 backend tests. Phone side sends `drive_id`; STREAMING from a live drive is the next piece (needs the web drive mode below).
- [x] Cloudflare preview builds now pass (the `previews` block fix; verified on commit 9893072, preview URL https://claude-lucid-pascal-82cnud-apexnav.senftns.workers.dev).
- [x] **Web DRIVE mode** (owner report: the web app never asked for sensors, had no separate modes): REPLAY | DRIVE switch in the cockpit. DRIVE (tap-initiated, so iOS permission prompts work) starts GPS (`watchPosition`, high accuracy), motion (`devicemotion`, iOS permission) and a screen wake lock (`web/sensors.js`); status bar shows GPS/MOTION/REC and plain-language errors. Honest limits: lateral/longitudinal g are DERIVED from the GPS track (not IMU) and labelled source `web-gps`; roughness comes from the accelerometer (orientation independent); camber is never claimed (blank). Recording is 5 m samples, saved to IndexedDB on END DRIVE (>= 0.3 km) via the shared `web/recording.js`, and appears in ANALYSIS. Tests: `tests/test_sensors.py` (sign/size of g on circles and straights, blanks, roughness, 5 m CSV). Browser-tested with emulated GPS and motion events (headless Chromium). NOT yet tested on a real phone.
- [ ] Live contribution streaming from DRIVE mode (chunks every ~500 m with a 1 km lag) is NOT built yet; web-recorded drives can be shared afterwards from the analysis page like any other recording.
- [x] Live voice measured: Kokoro q8 on wasm takes 10-17 s per short phrase on a desktop-class CPU (8-13 s with threads), so it cannot serve mid-drive calls on a phone; it only works as background pre-rendering of route names. The UI still says only 'LIVE FAILED' without a reason, and needs honest status text (open).
- [x] UI: the gauge cluster (transport, dials, switches) shows on the map view only; Route/Drives/Setup menus use the full height above the tab bar. Also fixed a bug from the DRIVE-mode change: `index.html` had no global `[hidden]` rule, so the drive bar showed in REPLAY mode (now fixed), and the separate mode label only appears for the route simulation warning.
- [x] **Live voice made honest** (owner: 'doesn't seem to be working anywhere'): it was ON by default, so the first route silently started a 90 MB download that is slow on phones. Now OFF by default (old saved prefs migrated via `liveVoiceV`), and `ApexVoice.liveInfo()` drives a status line under the LIVE button: loading engine, downloading with %, ready, preparing names N of M (about 10 s each), or a plain-language failure reason. Turning it on mid-route prepares that route's names. Added `tests/test_web_syntax.py` (every inline and external script must parse; a broken inline script had briefly killed the cockpit during this work). Measured earlier: 6-17 s per phrase, so it is only for names, never mid-drive.
- [x] **Road data streams live from DRIVE mode** (owner request): `ApexContributor.createLive` matches each settled 500 m chunk with Valhalla, caches way geometry, and posts bins while driving. The first ~1 km and last ~1 km of every drive never leave the phone; failures retry on the next row; a server refusal stops it; the saved drive is marked `contributed` so analysis does not resend it. Server: crest is optional (`null` = unknown, never erases a measured value), minimum bin coverage relaxed 0.8 -> 0.6 (5 m samples on 5 m bins can skip a bin). Validated against REAL Valhalla output (edges `way_id`/`road_class`, `matched_points` incl. `interpolated`) and real CORS headers; end-to-end browser test with emulated GPS/motion and mocked map servers. NOT yet run on a real phone or against real roads with road data merging on production.
- [x] **Brand pass 1** (docs/BRAND.md is the spec; checklist items 1-4, 7-10, 15, 20, 23 done on the phone UI): Road book is now the default look (saved prefs reset once via `themeV: 2`; Instruments is the only other look offered, Instrument/Telemetry code stays until the owner approves deleting it); sentence case, 11 px type floor, 44 px targets; Barlow Condensed + Inter Tight only; 5 tabs Map, Plan, Log, Stages, Crew; the REPLAY/DRIVE switch is gone in favour of a red Start drive button with a first-drive permission sheet (`apex.permsExplained`) and End drive; three-screen first run (`apex.onboarded`); favicon, apple-touch icon PNGs; notes strip hidden while a sheet is open. Fixed a real bug on phones: the drive bar's no-wrap status text widened the whole binnacle, pushing End drive off screen.
- [x] **Brand pass 2 (layout)**: idle map screen is just the map, Start drive and the tabs (map is ~80% of the screen); gauges and notes appear only for a replay, a route preview or a drive (tap the plate to end a replay). The five display switches moved into Settings, SIGHT/PACE became one Road figure, the Road-scores bars left the binnacle. Honesty fix: while driving off the loaded route, its pace notes and trip distance are no longer spoken/shown as if they were the road under the car.
- [x] **Brand pass 3 (every screen)**: Plan has Where to, Loop, Spots (Detour Off/Little/Some/More; adding a spot is a disclosure), Replay; Settings groups While you drive (switch rows), Voice, Speak road names, Map motion, Look, Sources (collapsed). Log page is a titled list of drives (rows open the drive), Latest/Best, trend only from 3 scored drives, Import .csv, Score explainer folded; Drive page has Compare with… and a back link; Compare lost the whole-road delta card; Stages lists your stages first with New stage folded; inner tab row hidden (bottom bar navigates). The iOS simulator smoke test now looks for Start drive and the five tabs (it was failing on every push since the brand pass, causing the failure emails). Known gap: drives saved from the web (IndexedDB) are not offered in the map Replay list yet.
- [x] **Crew tab** (social): signed-out and invite states, requests with a badge from `/api/me.requests`, friends with Scores/Times switches and a plain-language line on what each friend sees, add by handle, "Share my handle" link (`?add=handle`), crews (create, invite link `?crew=token`, leave, Scores/Times per crew), points board, Share road feel, export/sign out/delete. Redeeming an invite makes the inviter a friend (PR 15).
- [x] **76 backend tests** (privacy, auth, highlights, contribute, nightly, account) + 53 pytest.
### Active bugs / limitations
- **Cloudflare preview build (FIXED, kept for history)** failed because `wrangler preview` (the default preview command) requires a `previews` block in `wrangler.jsonc`. Fixed: added `previews.d1_databases` pointing at a separate empty `apexnav-preview-db` (id 9103ab07-..., migrations 0001-0003 applied), so previews never touch production data. Verify the next PR build is green. Any future migration must be applied to BOTH databases. Production deploys (`wrangler deploy`) were never affected by this error.
- Contributor limits: only drives imported after this change keep the roughness/crest/curvature columns; older stored drives are not eligible. Public Valhalla/Overpass servers are rate limited, so a self-hosted matcher may be needed past a handful of users.
- Not built yet:  convoy, R2 backups.
- `npm ci` needs `--legacy-peer-deps` (Cloudflare test plugin vs wrangler peers).

## Session 2026-10-25 (j): espeak-ng (GPL) removed from the shipped LIVE voice
- [x] Found: `kokoro-js@1.2.1/dist/kokoro.web.js` (what LIVE loaded) inlines the espeak-ng WASM build via `phonemizer`; so the
  whole bundle had to go, not just its phonemiser. Evidence and licences with URLs: docs/VOICE.md "Removing espeak-ng (GPL)".
- [x] `web/voice.js` LIVE now loads transformers.js 3.5.1 directly (Apache-2.0) + Kokoro-82M v1.0 ONNX q8 (revision pinned) and
  feeds it phonemes from the new `web/g2p.js`: JS port of misaki's English dictionary G2P + misaki's BART fallback for unknown
  words run in plain JS. Data in `web/g2p/` (`tools/g2p_export.py`, sha/revision pinned) + `web/g2p/places.json` (hand-written
  names the fallback gets wrong: Mulholland, Tellico so far). A failed phrase no longer blocks the render queue.
- [x] Measured (`tools/g2p_compare.py`, misaki+espeak only as an offline ruler): JS BART = Python BART on 1,472 words; JS = Python
  misaki+BART on 99.3 % of 1,436 US place names (rest = our St.→Saint); pace calls identical to the espeak reference; place names
  62–65 % exact vs espeak (PER 8–10 %), all in out-of-dictionary words, neither side ground truth.
- [x] Browser end to end (headless Chromium, George + Michael, 5 phrases): Whisper transcripts identical to Python espeak-based renders
  on 10/10. Load ~7.5 s, 6–10 s per phrase here; coordinator measured 10–17 s (8–13 s with threads) → background prefetch only.
- [x] `tests/test_g2p.py` (5 tests): 28 phrases against verified phonemes (GB + US), fallback parity, Kokoro vocabulary, and a guard
  that nothing under web/ loads kokoro-js / phonemizer / espeak-ng.
### Unverified
- Nobody has listened to the new LIVE renders; not tried on a real phone or in the iOS WKWebView (WASM + 9 MB extra G2P download).
- misaki dictionary provenance undocumented; BART licence only in model-card metadata: lawyer review before charging.
- Heteronyms use the dictionary default (no POS tagger); `places.json` entries are agent-written, not checked by ear.

## Session 2026-10-25 (k): continue screens-rework, saved-drive replay
- Reviewed remote branches: `claude/screens-rework` (PR #21) is the active screen work; `claude/brand-direction` is the earlier design proposal.
- Closed PR #21's documented replay gap: Plan now loads saved/imported IndexedDB recordings, newest first, refreshes when opened and after saving, and resolves saved-drive URL links before activating playback.
- Shared recording adapter keeps missing road scores, camera data, speed limits and older recordings' unavailable envelopes unknown. New recordings retain the profiler's envelope and sight-distance arrays.
- Verification: `python -X utf8 -m pytest tests -q`: 97 passed, 2 skipped (unavailable raw logs). Default Windows encoding caused existing Unicode tests to fail; UTF-8 mode passes. Browser verified persisted-recording list, URL selection and running replay using a copy of shipped drive data, removed afterwards.
- Follow-up review fixed a crash in the ribbon and scrubber for legacy recordings without envelopes; missing bins now break the drawn line instead of implying zero. Added `tests/test_recording_replay.py` covering real parser output, legacy replay renderers and missing-bin gaps.
- Verification after review: `python -X utf8 -m pytest tests -q`: 98 passed, 2 skipped (private raw logs unavailable). Browser played a persisted legacy recording with Road/Limit unknown. Real-phone sensors/audio, iOS compilation and production deployment remain unverified.
- Follow-up prepared on `claude/screens-rework` for PR #21; check the remote PR for CI results.

## Workspace relocation
- Permanent checkout: `C:/Users/senft/Projects/ApexNav`; verified working files, HEAD, index entries and local diffs. Original scratch checkout retained as a recovery copy.
- T3 project root now points to the permanent checkout. Continue implementation there; this existing thread may retain its original scratch binding.

## Full-width panels
- Owner feedback: Plan left a strip of map visible on wider phones. Removed the 420 px panel width cap and side border; Plan, Crew and Settings now fill the area above navigation.

## Exact Next Task
1. Owner on a real phone: plan a route from the real position, drive off it and back (reroute, "Back on route"), a Night Auto switch at sunset, DRIVE recording and live contribution; listen to LIVE road-name renders and fix pronunciations.
2. Owner decisions 2026-10-26: one theme only (item 19 approved, queued as themes-1); keep the Jarvis voice.
3. Loop: work the "owner's iOS test" section of docs/WORKER_QUEUE.md first (iOS app cannot reach the Worker from apexnav://, Log scroll, pinch zoom, idle GPS, End drive / bundled drives), then live ETA (eta-1) and traffic on the current route detected via MapKit on iOS, then switch to the next most fun route around it (traffic-1), pins, highlight dialog, Plan suggestions, Stages redesign, Log friends.

## Session 2026-10-26 (m): local GPU worker + 30-minute review loop
- [x] PR #21 merged (`5d15d94`); its late simulator failure was on superseded commit `054f811`, `main` CI is green.
- [x] `tools/local_worker.py`: dispatches a coding job to OpenCode 1.19.4 + Ollama (`qwen3-coder:30b`, 32k context,
  ~86 tok/s on the RTX 5080 with 1/3 on CPU) in its own clone `../ApexNav-worker/<id>` (not a git worktree: OpenCode
  edits the main checkout from a worktree, seen on the first test job and reverted). Runs detached, then pytest, writes
  `.worker/jobs/<id>/job.json`; flags `escaped` if the main checkout changed. Worker cannot push (OpenCode permissions).
  Replaces the earlier whole-file-rewrite bridge (4096-token output cap truncated big files).
- [x] `docs/LOOP.md` (one review tick) and `docs/WORKER_QUEUE.md` (brand §7 items for the worker). Owner approved merging
  to `main` on green CI and wants the loop never to pause itself.
- [x] First job `brand-21a` (`.dv-z` 44 px): the worker made exactly the two requested edits, tests green.
- [x] Loop tick 1: brand-21a reviewed, rebased on #22, merged as #23; `local_worker.py` `changed_files` no longer drops the first path's first character.
- [x] brand-17 (#26): pace-note sub line `R 42 m · 31 mph` / `Driven once` / `Camera`; no code under the next-note tulip; Roadbook boxes show the code only for hazards whose code is not the call (worker r2 did instruments.js after r1 wandered off with two files; subFor done by the loop).
- [x] Worker: whole-file reads of web/index.html overflow qwen3-coder's 32k context (brand-17, route-1 lost the task; route-1 invented a `lastKnownLocation` fallback, discarded). Prompt now forbids reading >400-line files whole; LOOP.md says to give read windows. Webhook wake-ups were 403 (relay CDN blocks the Python-urllib agent); `notify()` sends its own User-Agent.
- [x] route-1 (#28): Plan, map-tap and Loop routes start from `locate()` (live fix, else one high-accuracy GPS fix) and never from the map centre; no fix → toast, no route. `here()` is unchanged for its other callers. Real-phone check: iOS WKWebView may ask for location once for the page.
- [x] route-3 (#30): `web/reroute.js` `RerouteMonitor`, pure off-route state machine (off > max(40 m, 2x accuracy) for 5 s while moving, back under 25 m, wrong way at -100 m progress, one request per episode, 20 s cooldown, 20/40/80/120 s failure backoff, a GPS gap breaks the run). `tests/test_reroute.py` 9 tests. Not wired yet (route-4).
- [x] route-2 (#31): Plan has From (empty = current location) + To, a Swap button, `lat, lon` accepted in either field; "Or tap the map" fills the last focused field; each route keeps `t.request = { from, to, via }` (from null = phone position) for rerouting.
- [x] brand-18 (#33): Drive and Compare plan maps draw a corner number only ≥ 18 px from every drawn number, else a 4 px dot. Local tier (Pi + qwen): first try passed Pi's `edit` `edits` array as a string and wandered off; the retry did 3 of 4 edits, the loop added the Compare check.
- [x] route-4 (#34): live mode feeds `RerouteMonitor` once per frame; off route the match searches the whole route, notes/pace/trip stay blank, the strip says Off route / Wrong way / Rerouting… / Off route · no signal to reroute; a request rebuilds from the fix through the vias still ahead (loops: their waypoints, back to the start) to `request.to`, old route kept until the new one arrives; voice "Rerouting" / "Back on route". Native frames now carry `accuracy_m`. Not yet driven or browser-tested (route-5).
- [x] brand-24b (#35): analysis.html spacing utilities `.mt-8`, `.stack-8`, `.stack-12`; 8 inline styles replaced (14 px stacks round to 12). Local tier did it but wrote a second `class` attribute on 4 elements (browsers drop it); loop merged them.
- [x] brand-12 (#36): Drive view summary: 44 px score with /1000 and its four part bars, one distance · time · corners line, Top speed / Peak lateral / Peak braking / Climb tiles gone from the summary, scrub readout hidden until the first scrub or zoom; lane and zoom labels sentence case. Mid tier (Gemini 4 Argon after Codex hit its usage limit).
- [x] route-5 (#37): `node tools/sim_offroute.mjs` drives web/index.html in headless Edge/Chrome over the DevTools protocol (no npm deps, virtual clock) with a 1 Hz GPS track: 30 s on Pebble Ridge, 20 s drifting 150-300 m off, back on. 2026-10-26 run: 24/24 pass. Off route exactly 5 s after leaving, notes/pace blank; a recorded drive never requests; router unreachable → "Rerouting…" then "Off route · no signal to reroute", retry after 20 s; real Valhalla reroute loaded a 21.7 km route 2 s after the request and notes resumed; "Back on route" spoken on rejoin; ±30 m jitter for 80 s never triggers. During the 5 s hold the strip now says "Checking route…" instead of claiming off route early.
  - Known: the first fix after a reroute lands can still read "Checking route…" (the new line starts where the car was when it asked, a few tens of metres back); the script allows that one frame and reports it (seen with the stub router, not on the real network). Not exercised: Dry Ridge, the wrong-way path, a real phone.
- [x] brand-log (#40): Log page has no header or tab row; opens on the drives list (Score right-aligned 26 px), a row opens the drive with "‹ Log" back; Compare tab gone, "Compare with…" preselects the best other drive on the same road (`Core.compareDrives`); `.gain` = `var(--gain)`; stages say runs; sharing controls sit with the Board; `?tab=log` / `?tab=stages` aliases, old tab names still work. Not checked: member-only parts, phone width.
- [x] brand-6 (#41): dials cluster Road cell gets a 12 px eye when sight speed < corner pace (both known); road-type line under the trip back, from `sector.archetype` in BRAND names (Sweepers, Fast & open), `--` on planned routes (no sectors). Limit/Road cells were already in place.
- [x] brand-fix (#43): "Plan a route · Watch a replay" under Start drive (replay loads Dry Ridge); live plate "Drive ● Rec" while recording; location denied → permission sheet says "Location is off. Settings → Safari (or ApexNav in the app) → Location → Allow" and Start drive is disabled; no motion → "No motion · surface not recorded" and the drive runs; first-run logo inlined, its Watch a replay loads Dry Ridge; Speak road names is a switch with its status line; `.key` 15 px / 600; `.ink-btn.solid` 48 px.
- [x] brand-5 (#44): Settings Notes cycles Auto → Full → Quiet (Quiet never wakes on spirited driving: cameras and severe bumps only), Night Auto / On / Off (Auto follows the system dark-mode setting for now; BRAND wants sunset/sunrise, queued as brand-5b), Road scores switch gone (layer stays hidden); old saved prefs map to the new modes.
- [x] brand-23 (#42): iOS app icon: `Assets.xcassets/AppIcon.appiconset` with the 1024 px brand icon (single-size, RGB, no alpha), listed in project.yml with `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon`; verified by the cloud xcodegen build.
- [x] brand-16 (#45): after a route or loop is built the Plan sheet shows a route card (name, distance · corners · road type, Twist/Flow/Surface bars, cameras, road-feel coverage; `--` where unknown, "Road feel after first drive" when none) with Drive it (start drive on it) and Preview (sim); never opened in live mode, so reroutes don't pop it. Spots note per §2; Plan busy labels sentence case.
- [x] brand-5b (#46): Night Auto = dark between sunset and sunrise at the live fix / track position / last GPS fix (`web/sun.js`, NOAA approximation, −0.833° altitude; `tests/test_sun.py` within 5 min of published times, polar day/night); no position → system dark-mode setting; rechecked every minute. Terrain blocking the horizon is not modelled.
- [x] brand-9 (#47): cockpit Log/Stages tabs open `analysis.html?tab=log|stages`; Settings plate is a 44 px gear (aria-label Settings); the Plan sheet's "Replay a drive" list is gone: drives (bundled and saved) replay from the Log's drive detail, Dry Ridge also from Start drive's "Watch a replay".
- [x] brand-25 (#48): Crew rows expand to a detail with the member list (new `GET /api/crews/:id/members`: members only, 404 otherwise, blocked users hidden both ways; privacy test extended), invite and share switches; stage Board has Friends / <crew> filter chips; Delete account is a red text button.
- [x] brand-1 (#49): BRAND §2 rows 1–16 verbatim (new: Settings voice note, "Drive saved" toast with [View] → `analysis.html?tab=drive&drive=<id>`, Stages subtitle/empty state); "Share road feel" everywhere; SHARE/ADOPT/MATCHING ROADS sentence case (adopt → Add); Passes → Runs; member labels per §3 (Banking, Roughness under Road feel); road-type fallback "Map only"; router/service names only in Settings → Sources.
- [x] route-6 (#51): `node tools/sim_offroute.mjs --all-drives` adds a wrong-way scenario (U-turn after 40 s: "Wrong way" exactly at 100 m lost progress, one reroute request, notes blank) and runs everything on Dry Ridge too: 56/56 pass (2026-10-26). Fix: a pending "Rerouting…" note no longer hides "Wrong way"; offline it reads "Wrong way · no signal to reroute".
- [x] themes-1 (#56): Instrument and Telemetry themes deleted (themes.js objects, telemetry cluster/notes renderers, `.tm-*` / `.cluster-telemetry` / `.pn-code` CSS); a saved `instrument`/`telemetry` loads as Stage. Road book and Stage stay with their picker (BRAND keeps two); owner asked whether "the current theme is the only one" means Stage and the picker go too.
- [x] ios-drive + ios-gps (#58): root cause: the app pushes native frames every 0.1 s from launch and `window.apex.live` switched to live mode on each, so Start drive returned at once ("Finding GPS…" forever), End drive was undone 0.1 s later and the bundled drive loaded at boot looked driven. Now in the app native frames update the position (idle puck, Plan, Night) and drive the screen only between Start drive and End drive; a native drive records from them and shows "Finding GPS…" in a gap instead of dropping out. Bundled drives are demos only ("Replay · Demo ·" plate, not in the Log, not loaded at boot). Browser path unchanged (sim 56/56). Needs the phone to confirm.
- [x] ios-api (#55): the iOS app reaches the Worker: `ApexSync.apiFetch` (Worker URL + bearer token in the app, same-origin cookie on the web), Worker CORS for `apexnav://app` only, bearer sessions, app writes need the bearer; Google sign-in through `ASWebAuthenticationSession` + one-time PKCE-bound code (`POST /api/auth/app/exchange`, migration 0005 applied live). Backend 85 tests; iOS build + simulator green. Not yet run on a phone: confirm WKWebView sends `Origin: apexnav://app` and Crew/Board/Share road feel work signed in.
- [x] ios-scroll-zoom (#59): the Log scrolls inside `<body>` (the shell keeps the web view's scroll view off so the map page never rubber-bands); the app never zooms (scroll view zoom locked to 1, its pinch recognizer off, `gesturestart` cancelled on both pages, analysis viewport `user-scalable=no`); MapLibre pinch unaffected. Needs the phone to confirm.
- [x] pin-1 + hl-1 (#61): long-press (500 ms; pan, zoom, second finger cancel; never while driving) drops a pin with its reverse-geocoded name (`--` if none) and Go here / Start from here / Add via / Save as highlight; the highlight dialog is redone (name, category chips, 5 tap-target rating, Save / Cancel), same storage and sharing. Not yet checked in a browser or on the phone.
### Next
1. Loop thread runs docs/LOOP.md every 30 min, starting with brand-21a's PR.
2. Owner priority after brand-17: routing from the real position, From/To, off-route detection and reroute (docs/WORKER_QUEUE.md route-1..5).
- 2026-10-26: worker dispatch moved to the T3 **Pi** provider (Pi 1.4.0, `~/.pi/agent/models.json` → Ollama). Probes: Pi did a 3-step bash task and a grep-then-edit in web/index.html exactly, no T3 tool calls, own worktree. The T3 OpenCode provider failed the same probe (called T3 orchestration tools, launched a stray thread); `tools/local_worker.py` stays as the fallback.
- 2026-10-26: loop reorganised into tiers (docs/LOOP.md): top (loop thread) designs/reviews and does core math; mid (Sonnet 5.5 / GPT sol / Gemini Argon) and fast (Haiku 5.5 / Gemini Flash / GPT luna) get short briefs, never line-by-line edits; local Pi only for high-output, machine-checked jobs. Reason: line-level specs for the local model were bigger than the diffs (route-2: 6.3 KB spec for +50/-24).
- 2026-10-26: owner wants Opus usage saved for high-level review: delegates prefer Codex / Antigravity, Claude models only as a last resort; top items get a design + a mid build (docs/LOOP.md).

## Session 2026-10-26: Road book only (themes-2)
### Completed
- [x] Removed the Instruments/Stage theme, Settings theme picker, and Stage-only pace-note strip renderer and CSS. Road book's tulips and shared dial cluster remain.
- [x] Saved and URL theme ids `stage`, `instrument`, `telemetry`, and unknown ids resolve to Road book. Notes mode and the Stages feature are unchanged.
- [x] `python -X utf8 -m pytest tests -q`: 118 passed, 2 skipped. Headless Edge loaded day and night with saved `theme: 'stage'`; both rendered Road book dials, the matching Night setting, and no picker.

### Active bugs / limitations
- Browser check did not cover a physical phone or the full Auto sunset transition. Edge held its temporary test profile briefly after exit, so that cleanup step reported a Windows file permission error; the day/night assertions had passed.

### Exact next task
- Reviewer verification: 119 passed, 2 skipped; added a deterministic Node regression for retired/unknown ids (including inherited object keys) and day/night palette application. All ids now resolve directly to the only theme.
- Loop tick 2026-10-26: main is current at 3cb86cc (#62). Post-merge core and Pages passed; iOS CI is still running. No open PRs or local-worker jobs; Ollama is running. stages-1 remains active on Antigravity Flash Medium; dispatched plan-suggest to Codex GPT sol medium in a separate checkout with non-overlapping UI files.
- Superseded next task: road-1 through road-4 now take precedence. Stages and place suggestions are checkpointed, not eligible to merge without resolving their review/validation work. Existing phone-only checks remain outstanding. Preserve local owner/reviewer doc edits.
