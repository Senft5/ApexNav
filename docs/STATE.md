# VETTA — CURRENT AGENT HANDOFF STATE

## Session 2026-11-10 (fable-loop-time): the loop dial by distance or time (claude/fable-loop-time, off origin/main 1a38381)

- [x] web/index.html `#loopBy` (two radio words over the dial, `.loop-by`). web/cockpit.js: `LOOP_BY` ('apex.loopBy'),
  `LOOP_MINUTES = [30, 60, 90, 120, 180]`, `labelLoops()` relabels the same five `#loopDetents` buttons
  (`data-loop-mi` or `data-loop-min`), `setLoopBy(by)`; `buildLoop` calls `setLoopBy(minutes ? 'time' : 'distance')`;
  `paintCardLoop` draws the row from the dial's buttons in either unit (label Length / Time, pressed by `targetS`).
  web/route_card.js `loopTime(minutes)` ("1½ h"), used for the dial, the card and the loop's note.
- [x] Tests: tests/test_loop_ways.py (+2); e2e "a loop by time…" (dial turns, 1 h loop built, card row by time, kept
  across a reload, back to distance).
- Next: Options' "Loop to fit" 1 hour / 2 hours keys now duplicate the dial; remove them once the owner has used the
  dial (My free time stays).

## Session 2026-11-10 (fable-polish-7): the Settings list in groups, with values (claude/fable-polish-7, off origin/main 1a38381)

- [x] web/garage_settings.js: `GROUPS` (a group's name goes before its first key, hidden while all its rows are),
  `summaryOf(node, count)` and `refresh()` fill each row's `<small>` and `aria-label`; closing a setting's sheet
  refreshes the list. A section opts in with `data-summary="<selector>"` (+ `data-summary-count="one,many"` for a
  list) in web/index.html: zones, crash, nudge, units, motion. `.nav-group` CSS.
- [x] Tests: tests/test_garage_settings.py (+1); e2e "Settings behind the gear…".
- Next: Road feel, Route tuning and Spots rows have no value yet (Road feel's is drawn by who_sees.js).

## Session 2026-11-10 (fable-loops): loops lose Quick / Fun / Long way; the card offers which way to head (claude/fable-loops, off origin/main 7dee309)

- [x] The owner: "why do loops need a long way a fun and a quick? the whole point is aimless driving". web/cockpit.js:
  `LOOP_STYLE = 'fun'` is the one style a loop is searched, costed, ranked and rerouted with (never `funLevel`);
  `loopLevels` is gone, `loopOptions` returns `{ kind: 'loop', list, picked: 0 }` with no `levels`; `#routeCardFun` is
  hidden unless `route_dest`; `takeLevel` is destination-only.
- [x] Which way: web/fun_route.js `loopWay(t)` (bearing from the start to the length-weighted middle of the loop, 8
  names, null when it circles the start) and `loopOffer(order, 3)` (the best, then loops 60+ degrees apart within 100
  points, then any not the same length and time). web/route_card.js `loopCards(o)` and `loopOutline(t)`;
  cockpit.js `paintLoopWays` draws `#routeCardWays` (`.rc-levels.rc-ways`, buttons `[data-way]`, a tap = `pickOption`).
  Hidden with one loop. The page marks stay a destination's.
- [x] Tests: tests/test_loop_ways.py (5); e2e "plan flow (b)" and "level cards" now say a loop has no level (the old
  checks asked for the three cards), new flow "a loop's choices are which way to head…" on the graph fixture (level
  left on Quick, 2-3 cards, a tap swaps the loop with the network off, largest text).
- Left: fun_route.js `LOOP_LEVEL` / `LOOP_HWY` quick and max rows and route_engine.js `LOOP_USE_HIGHWAYS` are no longer
  reached by the app (tests/test_plan_options.py still covers them); remove them if loops never get a style back.
- Next: two cards can share a name (both "Southeast"); a finer name (16 points, or the road it is built on) if it reads
  badly on real roads. The 1 hour / 2 hours loops sit in Options; the card's Length row is miles only.

## Session 2026-11-10 (fable-log-dates): readable days in the Log's records and charts (claude/fable-log-dates, off origin/main 1a38381)

- [x] web/format.js `dayShort(iso, locale)`; web/analysis.html: Your records' day through `ApexFormat.dateTime`, the
  Score over time and road charts' labels through `dayShort` (CSP hashes regenerated).
- [x] Tests: tests/test_format.py `test_a_chart_day_reads_as_a_day`; e2e "Your records…" refuses an ISO date in a row.

## Session 2026-11-10 (fable-design-offline): design pass 5: People with no connection (claude/fable-design-offline, off origin/main 7dee309)

- [x] web/cockpit.js renderAccount `if (!me)`: `.join-page.lost-page` on both sides (the `gets` / `roads` / `pucks` /
  `drawing` helpers moved above it from the signed-out branch), head by `navigator.onLine === false`, three rows of
  what works offline, `again()` key ("Trying…", disabled) in `.join-sign`; the Garage's `#garageMeBody` gets "Your
  cars" + a line + Try again. `online` / `offline` window events redraw while a `.lost-page` is up.
- [x] web/index.html: `.jr-ghost` (the dotted way on), `.join-sign button.ink-btn`.
- [x] Tests: tests/test_people_no_connection.py (5); e2e "no connection: People is a page…" (/api aborted: both phone
  sizes, both sides, the Garage, offline event, Try again, online event brings People back).
- Next design pass candidates: the lower Garage blocks (How this works, Pro), the Options sheet's long list.

## Session 2026-11-10 (fable-suggest-follows-dial): the loop suggestion follows the dial (claude/fable-suggest-follows-dial, off origin/main 1a38381)

- [x] web/cockpit.js `pickLoop` ends with `paintLoopSuggest()` (in a try: at launch the deck isn't set up yet).
- [x] Tests: tests/test_loop_ways.py (+1); e2e "plan flow (b)" picks 15 mi and 45 mi on the dial and reads the row.

## Session 2026-11-10 (fable-fix-join-scope): #332's page showed in the Garage too; scoped to People (claude/fable-fix-join-scope, off origin/main 6412cb5)

- [x] Bug from #332 (live on main): `#accountSection:has(.join-page) { display: grid }` outranked `.sheet [data-panel]
  { display: none }`, so signed out the People page (543 px) stood at the top of the Garage. web/index.html: both
  `:has(.join-page)` rules now start `.sheet[data-view="people"]`.
- [x] Tests: tests/test_people_signed_out.py refuses a bare `#accountSection:has(.join-page)`; e2e "REVIEW.md 1.2 screen
  by screen: the Log…" checks the Garage signed out has no People page (fails on main's CSS, passes here).
- Lesson: a rule that sets `display` on a tab's panel must carry the tab (`.sheet[data-view=…]`); after changing one
  tab signed out, open the other three.

## Session 2026-11-10 (fable-loop-names): no two loop cards the same way and the same length (claude/fable-loop-names, off origin/main 1a38381)

- web/fun_route.js `loopOffer`: the fill pass takes a loop only if it heads elsewhere than every card already offered
  (60 degrees) or differs from it by `LOOP_OFFER.differs` (0.2) in km or time. Before, the fill took any lookalike, so
  two "Southeast" cards a couple of minutes apart came up.
- Tests: tests/test_loop_ways.py (`oneWay`, `twins`); e2e "a loop's choices are which way to head" checks no two cards
  share a name with times within a fifth.
- Next: the Layers panel and the drive screen have not had a design pass.

## Session 2026-11-10 (fable-quiet-news): What's new waits for a quiet launch (claude/fable-quiet-news, off origin/main 7dee309)

- [x] web/whats_new.js `moment({ touched, driving, splash, open })` → 'show' | 'wait' | 'skip'; web/cockpit.js asks it
  at 1.2 s and every 0.4 s while the splash (`#boot`) is up (40 tries), with `touched` from the first pointerdown or
  keydown and `open` = any `.overlay.show`, `.side-pop.open`, `#planPanel.open`, `.sheet.open` or live mode.
- [x] Tests: tests/test_whats_new.py `test_it_never_interrupts`; e2e "what's new…" first touches the screen and opens
  Options (no sheet, not marked seen), then a hands-off launch shows it after the splash.

## Session 2026-11-10 (fable-design-signed-out): People signed out, redrawn as a page (claude/fable-design-signed-out, off origin/main 2fda3f8)

- [x] Design pass 3 (the owner, 2026-11-10: "designed by an artist not a programmer"). web/cockpit.js `renderAccount`,
  signed out: `page(art, head, line, list, waiting)` builds `.join-page` for both sides: `.join-art` (an inline SVG,
  roads as casing + fill, `.jr-puck` people, one `.lead` in the accent), `h3.join-head`, `.join-line`, `ul.join-gets`
  (glyph in a dashed circle, `b` name, `small` one line), `.join-wait` for a stashed link, `.join-sign` (Apple, Google,
  legal) pushed to the foot. The logo `img` and `.crew-gets` are gone.
- [x] web/index.html: the `.join-*` rules; `.sheet .body:has(.join-page) { flex: 1 1 auto }` lets the page fill the
  sheet (only while that page is drawn, so the signed-in lists are untouched); a short phone (max-height 720px) gets a
  shorter drawing and rows so both keys stay on the first screen (checked at 375x667 with the Apple key shown).
- [x] Tests: tests/test_people_signed_out.py; e2e "REVIEW.md 1.2 screen by screen: the Log…" now measures the page
  (the head's face and size, two pucks and one lead, a line per row, 52 px key, keys at the foot, nothing wider than
  the sheet). Also run: "one link in…", "Billet: a primary key…". docs/APP_REVIEW.md 5.1.1 row updated.
- Next design chunks, from reading the screens: the route card stacks two pencil help lines under the levels; search
  says a plain "Routing…" while it waits; the Garage is a long page (IDEAS U-49); "Can't reach Vetta" on People is a
  heading and a button on blank paper.

## Session 2026-11-10 (fable-design-garage): the looks' shelf and the empty bay (claude/fable-design-garage, off origin/main 2fda3f8)

- [x] Design pass 4 (part of IDEAS U-49, "the Garage is a long page"). web/index.html: under `(hover: none) and
  (pointer: coarse)` and not `html[data-type-size]`, `.theme-cards` is a sideways scroll-snap grid (88 % columns, edge
  to edge, the preview tightened so each call stays on one line). Signed out the page went from 1861 to 1373 px.
- [x] web/cockpit.js: `shelveLooks()` (after `renderThemePicker`) opens the shelf on the look in use and turns it only
  when the look changes; the sheet's swipe-right-to-close ignores touches that start in `.theme-cards`. Signed out,
  Your cars is `.empty-bay` (a dashed slot, a line, `Sign in` → `showView('friends')`).
- [x] Tests: tests/test_garage_shelf.py (3); e2e "the Garage on a phone…" (isMobile: the shelf's geometry, one line per
  call, a real touch turn and back with the sheet still open, Use keeps the card in view, large text stacks, the bay's
  key opens sign-in). Also run: every flow matching "theme", "Garage", "Dynamic Type", "REVIEW.md 1.2".
- e2e note: a flow that swipes must wait for the splash (`#boot`) to lift; `elementFromPoint` under the finger says so.
- Next design chunks: "Can't reach Vetta" on People; the Co-driver / Night / The words blocks lower in the Garage.
- [x] CI red on cdbd25a ("a turn of the thumb brings the next look": the shelf ended two cards on). Not main: the
  e2e swipe has no pauses, so on a fast runner it is a fling, and a fling passed the next snap point (reproduced
  locally with a 300 px drag in 4 moves; fails before, passes after). Fix in the product: `.theme-card
  { scroll-snap-stop: always }`. The check is unchanged.

## Session 2026-11-10 (fable-tile-limits): HPMS limits under 25 mph are unknown; tile times take HPMS's posted limit (claude/fable-tile-limits, off origin/main f27a1fe)

- [x] Deferred finding 1 (the fable-hpms-limits entry below: "the tiles' times use OSM's limit or the class estimate,
  never HPMS's"). Measured first, every edge of the shipped tiles (169k of 100 m or more) against the shipped bundles:
  where OSM and HPMS both post a limit they agree within 5 mph on 93 % (motorway), 98 % (trunk), 88 % (primary), 75 %
  (secondary), 76 % (tertiary) of the km. A cover / one-value / class guard barely moves those numbers: the misses are
  the two sources disagreeing (HPMS 55 where OSM signs 45, 38 km of secondary), not wrong matches.
- [x] By HPMS value: 30 mph and up agree on 76-99 %, 25 on 77 %, 20 on 63 %, 15 on 0 %. Asked HPMS itself
  (geo.dot.gov, HPMS_FULL_IN_2024): Switzerland County, Indiana reports 15 mph on every county road (f_system 6 and
  7). web/route_ctx/context_grid.js `LIMIT_MPH` and tools/ctx_etl/build.py `LIMIT_MPH` are now 25-85: the reader
  refuses the value in today's bundles, the writer stops storing it.
- [x] tools/graph_etl/score_edges.js `inventoryLimit(limit, fclass, rc, use)`: for an edge OSM has no sign on, HPMS's
  modal limit when it is matched on `INVENTORY.COVER` (0.5) of the 25 m samples and `SAME` (0.6) of those agree; never
  for a ramp; a freeway section (fclass 1-2) only for a motorway or trunk edge. It feeds the time model and the tile's
  `speed` (flag `speed_est` clear: the phone already reads HPMS as posted in the engine's chain). In the model hash.
- Not done: the "Graph region" rebuild (owner or coordinator: it commits to the data branch; the expressway flag waits
  for the same run). Until then tiles keep today's times and baked quality; the reader's floor works at once.
- Seen, not changed: Indiana HPMS 25-30 mph on rural roads (State Line Road 10.7 km at 25, Johnson Fork, Seeley,
  Pinhook at 30) look low against OSM where both exist (Georgetown, Pribble: HPMS 25, OSM 35), but can't be told from
  real town limits by value. A density-aware rule (a limit of 30 or less in open country) is the candidate; it needs
  ground truth first.
- Tests: test_travel_time_takes_the_road_inventorys_posted_limit_where_the_map_has_no_sign (unit cases and a real
  shipped secondary edge, with and without the bundles), the two "no limit" tests extended to the 25 floor (the
  shipped bundles hold over 100 such spans); pytest 1370 passed, 5 skipped. No web flow touched (no phone code path
  but the reader's range): e2e own routing flows run below.
- Exact next task: run "Graph region", then tools/live_speed.js on the owner's trips at Fun and Long way against the
  new tiles (times on primary roads move about 3 %).

## Session 2026-11-09 (fable-road-carry): road data survives no signal and a closed app (claude/fable-road-carry, off origin/main 3a74cc3)

- [x] Found: contributor.js createLive `finish()` gave up when the last try had failed, so a trip that ended with no
  signal sent nothing, and an app closed mid-retry lost its rows (IDEAS Q-06, F-05). Now a `carry` (web/road_carry.js,
  `window.ApexRoadCarry`, found by createLive as its default) holds `leftover()`: after each failed try, when the page is
  hidden (checkpoint), and at the trip's end. `flush()` resumes each kept item through createLive itself (`rows`,
  `pending0`, skip 0, lag 0), so the same bins go, once, under the trip's own drive id and day.
- [x] Kept: only the rows between the private ends; 13 days; 40,000 rows; IndexedDB `vetta-road-carry`, index in
  localStorage `apex.roadCarry` (Erase everything clears it, and a missing index empties the store). Sent only online,
  signed in, Road data on (`contributionEnabled`), never under APEX_REVIEW. Nothing is asked while nothing waits.
- [x] createLive `maxRun` 2000: a backlog is matched 10 km a try. my_data.js: "road data from N mi waiting for signal".
  privacy.html Road data paragraph; APP_REVIEW.md 5.1.2; IDEAS Q-06 / F-05; CALL_SHEET 2026-11-09 (fable-road-carry).
- [x] Finished in a second session (2026-11-09, thread "Run autonomous Vetta improvement"; origin/main de537a6 merged in):
  web/sync.js `contribute` now sends `rec` and `hr` (built by contributor.js, read by contribute.ts, never sent: no road
  was ever counted loved); `roadShare()` -> { on, known, member } remembers the server's last answer (`apex.roadShare`,
  only while signed in) so `startLiveSharing` and `checkAmbientAllowed` share on a drive begun with no signal (it never
  shared before, so nothing was carried); cockpit.js `clearCarry` on Road data off (both switches), both Sign outs and
  Delete account; `ApexRoadCarry.onPost` (app health counts late uploads) and `onSent` (a toast, Your data redrawn);
  the end-of-drive toast says what waits (`ApexRoadCarry.itemM(live.leftover())`); the index's `n` counts the bins of
  built chunks as well as rows (Your data said nothing waited for a trip whose uploads failed after matching: the e2e's catch).
- cockpit.js edits are in the account, Your data and sharing code only (#322 touches paintStory / ownRefine);
  web/index.html gains one script tag before contributor.js.
- Tests: tests/test_road_carry.py (17: the first session's 14, plus `rec` on the wire, the remembered answer, the page's
  clearing and wiring); pytest 1387 passed, 5 skipped (no existing test changed); `python tools/csp.py` up to date. e2e: new "road
  feel that waited for signal" (the real IndexedDB store in Chromium: seeded with `hold(item, true)`, kept while the account
  can't be confirmed, sent once on `online`, Your data counts it and stops), plus your data, drive ended (4), the app comes back whole, no signal hazard, spot photo with Erase, REVIEW5 §2, REVIEW.md 1.2 (2), review mode, People new account, first run (2), plan flow (g): all pass.
- Open: not run in WebKit (no WebKit in the cloud container) or on a phone; the drive bar doesn't say what waits while
  driving; a carried trip sent later doesn't mark its drive `contributed` in the Log.
- Looked at and left (deferred finding 2, Sharon Woods to Winton Woods at Fun): reproduced on the shipped tiles. The one
  good road is Lakeview Drive at the end; the engine prefers 29.8 min over a 23.8 min way that also drives it because
  `poor` (10 a km) outweighs 6 minutes (1 a minute). A small-weight search step (a = 1.5) finds the 23.8 min way but
  changed no router pick on 80 random trips, so it was not shipped. Halving `POOR_PER_KM` breaks no calibration test:
  the fixtures do not pin it, so that weight needs a driven judgment (or the owner's word) before it moves. Also seen
  live: the fresh-context re-rank swapped the card to a 26.0 min way under "Conditions ahead" (#322's area).
- Exact next task: the deferred round-1 items: HPMS posted limits in the graph ETL edge time (after #321 merges and the
  region rebuild), then Hamilton Ave quality 0.47-0.54.

## Session 2026-11-10 (fable-surface-map): Measured roads coloured by measured pavement, tap for words (claude/fable-surface-map, off origin/main f27a1fe)

- [x] IDEAS U-13 (the surface half; the twisty half was the Twisty roads switch). `GET /api/coverage` has sent each
  direction's mean roughness and banked / off-camber shares since the stage-discovery work, and the map drew none of it.
  web/coverage.js: `reading(w)` (the surer direction's numbers, both averaged on a tie), `surface(rough)` (1 smooth under
  `SMOOTH_G` 0.10 g, 3 rough over `ROUGH_G` 0.22 g, 2 fair, 0 not measured), `describe(w)` (the tap's words), feature
  properties `{ t, s, way }`, and `add` now redraws when a road's numbers change, not only its confidence.
- [x] web/cockpit.js: `apex-coverage` `line-color` is a match on `s` over the theme's gain / amber / signal / dim (all
  three looks, day and night); a tap on a measured road toasts `describe` unless a route, option or stage line is under
  the finger or tap-to-route is armed; the switch's toast names the colours and the tap.
- Not done: a per-bin surface (the line is one colour per road, the server's per-direction mean); a drawn legend (the
  switch's toast and the tap carry it); the scale lives in two files (coverage.js and route_story.js, held together by
  test_the_scale_is_the_route_overviews) because route_story.js was in another open PR.
- Tests: tests/test_coverage.py 7 (classes, surer direction, words, redraw, the shared scale); e2e "measured roads" flow
  extended (colour property, four theme colours in the paint, a tap says the words); pytest 1375 passed, 5 skipped.
- Exact next task: unchanged (tools/live_speed.js on the owner's trips at Fun and Long way). #321 is merged: the tiles'
  travel times from HPMS posted limits (the fable-hpms-limits entry below) is unblocked once the region is rebuilt.

## Session 2026-11-09 (fable-overview): the drive overview read against real trips (claude/fable-overview, off origin/main 1d97979)

- [x] The overview's "exact next task" (read it on real routes, tune `ApexRouteStory.T`), on ten public trips planned in
  the app's own page offline (new tools/story_live.js: the card's lines beside each route's setting, quality and street
  per 400 m; the owner's own trips are not in the repo and weren't run). Found and fixed:
  - **Our own routes' overview never saw the context grid** (land cover, lanes, housing, lights): `t.ranked` was the first
    ranking's candidate (tiles' channels only) and the refined ranking never rebuilt it, so no own route ever said "two-lane"
    or "through woods". cockpit.js `ownRefine`: when the route stays, `t.ranked` becomes the refined candidate and
    `paintStory(t, true)` rebuilds the lines in place (no hide, after the card, off the plan's path).
  - **The first road had no name** (the track's steps start at the first turn; names known on 63 % of northgate):
    `paintStory` puts the router's depart street at 0 m. Names now 99 % on all ten.
  - **One signal made open ground suburbs** (night lights near the city: 10 of harrison's 30 km): `settings` takes the
    second-highest place signal, sidewalks a signal like the rest.
  - **"two-lane" was said of two lanes each way**: `lanes` is lanes in your direction; now 1 (the test fixture said 2).
  - **"7 miles of Millville Shandon Road"** of a stretch that road carried 3 miles of: `namesFor`, "N miles of A and B"
    only when they carry 75 % of it, else "of good road, including A and B" (`T.NAMES_WHOLE`, `T.INCLUDE_MIN_M`).
  - **"About 7 miles through suburbs"** on a country drive: the slow line counts town, and suburbs only where the engine's
    quality is under 0.55.
- Tests: tests/test_route_story.py 15 (4 new: two lanes each way, one signal, many roads, houses beside good road; the
  country fixture's `lanes` 2 -> 1, the channel's unit); pytest 1374 passed, 2 skipped; e2e route overview (1), own
  routing (4), plan flow (6), level (6) pass. `python tools/csp.py` not needed (no inline script changed).
- Open: the in-place refresh has no e2e flow of its own (e2e/smoke.js is being changed by #319; seen working in
  tools/story_live.js runs: the grid's channels and the new lines 1-3 s after the card). Posted limits are known on few
  of these roads, so most leads say no speed. The owner's own trips still unread.
- Exact next task: an e2e flow for the overview's refresh once #319 is merged; the owner reads the overview on his trips.

## Session 2026-11-10 (fable-glide-flake): the flaky "car map glides" flow measured one frame late (claude/fable-glide-flake, off origin/main e6ddea2)

- [x] Root cause: the flow's `tick` (requestAnimationFrame) sampled `map.unproject` and paired it with `ts - last.ts`.
  web/carmap.js `frame(ts)` sets the camera for the frame's own time in its own callback; when `tick` runs first in a
  frame it sees the previous frame's camera, so every step is one frame late. With even frames that cancels; after a
  long frame its travel lands in the next short frame (px doubles at 33 ms then 17 ms locally; 10x on a busy runner).
- [x] e2e/smoke.js: steps come from the map's `move` event, timed by `document.timeline.currentTime` (the frame the
  camera was set in; two moves in one frame add up). `frames` and `moving` count real frames. Limits unchanged.
- [x] Checked: 140 ms stalls every 0.9 s (a temporary hook, not committed): old measure fails "no frame leaps ahead"
  (rateMax 0.139, median 0.011), new passes. Without stalls both pass.

## Session 2026-11-10 (fable-design-route-card): page marks under the level cards (claude/fable-design-route-card, off origin/main 2fda3f8)

- [x] Design pass 3b. web/route_card.js `pager(o)` ({ n, at, label } or null under two routes) and `levelNote(o,
  learned)` (learned: no swipe sentence, no count; "another route found" stays). web/cockpit.js `paintLevelCards` draws
  `#routeCardPager` (an `i` per route, `.on` the one on screen, a `span` count, a `small` with the swipe words until
  `apex.cardSwiped` is set by a real swipe in the card's touchend) and calls `levelNote(o, true)`.
- [x] web/index.html `.rc-pager` rules (one 22 px row, the marks ease between widths, still under reduced motion).
- [x] Tests: tests/test_route_pager.py (3); e2e "plan flow (a)" and "(e, f)" read the marks (which is on, the count,
  the words before a swipe and gone after). All six "plan flow" flows pass.
- Next design chunks: search says a plain "Routing…" while it waits; the Garage is a long page (IDEAS U-49); "Can't
  reach Vetta" on People is a heading and a button on blank paper.

## Session 2026-11-10 (fable-hazard-alive): a repeated "still there" keeps a hazard alive (claude/fable-hazard-alive, off origin/main f27a1fe)

- [x] Found reading backend/src/hazards.ts `vote`: a person's second "still there" on the same report returned early
  ("the same vote twice counts once") without moving `expires_at`, and the reporter's own (a repeat report within
  SAME_M lands in `vote`) moved nothing either. The page asks again on every drive (hazard_reports.js createPassWatch
  keeps `asked` per page), so those answers were thrown away: a report lived only as long as NEW people kept arriving.
- [x] Now any "still" sets `expires_at = MAX(expires_at, now + the kind's life)`; `confirms` moves only on a person's
  first "still" (never for the reporter, whose report is the first confirmation). "Gone" and the ending rule are
  unchanged. No migration, no client change.
- Tests: backend/test/hazards.test.ts "seen again by the same person" (second vote, the reporter's repeat report, a
  doubled "gone", an ended report stays ended); backend vitest 358 passed, tsc clean.
- Seen, not changed: the reporter is never asked about their own report and can't take it back; their "gone" through
  the API leaves their own confirmation counted. No screen reaches that path today.
- Exact next task: unchanged.

## Session 2026-11-09 (fable-expressway): expressways below trunk class are highways to Fun and Long way (claude/fable-expressway, off origin/main 1d97979)

- [x] The gap STATE and OWN_ROUTING listed: an expressway mapped as `primary` (or lower) with `motorroad=yes` wasn't a
  highway to the levels' rule. tools/graph_etl: osm_graph.py `drivable` keeps `expressway` (`motorroad=yes` or the US
  tagging `expressway=yes`, never on a link; a MERGE_KEY, so a chain never merges across the tag), tiles.py edge flag
  `EXPRESSWAY` (bit 14, 16384; no format bump), build.py sets it. web/graph_tiles.js `FLAGS.expressway`,
  graph_router.js `isHwyEdge` (so the ban at Fun and Long way, `hwyKm`, the exception's link, loops' highway share and
  Quick loops' x2.5 all count it) and `explore` (never a Best road nearby).
- [x] The shipped and region tiles are NOT rebuilt here (the build container can't reach Geofabrik): the bit is clear in
  them, so nothing changes on a phone until the next "Graph region" run (Actions, manual; it also re-bundles
  web/data/graph/v1). With old tiles the router behaves exactly as before (test: the `plain` half of the case).
- Tests: new test_an_expressway_below_trunk_class_is_a_highway_to_the_levels (graph_router_cases.js `expressway`),
  test_an_expressway_keeps_its_flag_into_the_tiles (a real build through pyosmium, both readers' flag tables),
  drivable() tag asserts; pytest 1372 passed, 2 skipped; e2e levels (3), own routing (4) pass.
- Open: how many roads in OH+KY+IN carry either tag isn't measured (no extract here). The route engine's own class
  (Valhalla-planned routes off our tiles) still knows only motorway/trunk.
- Exact next task: after merge, run Actions → "Graph region (own routing, OH+KY+IN)" so the flag reaches the tiles; then
  unchanged (tools/live_speed.js on the owner's trips at Fun and Long way).
## Session 2026-11-10 (fable-convoy-keep): the leader keeps a convoy going; a heads-up before it ends (claude/fable-convoy-keep, off origin/main f27a1fe)

- [x] A room lived `LIMITS.roomMs` (2 h, "draft operational bounds" in CONVOY_TRANSPORT.md) and ended by alarm with no
  way on and no warning. backend/src/convoy.ts `keepGoing(leaderId)`: leader only, in the last `keepWindowMs` (30 min),
  `expiresAt += keepMs` (1 h) capped at `createdAt + roomMaxMs` (6 h); saves, moves the alarm, updates every member's
  ConvoyIndex entry (a block or sign-out finds the convoy through it), broadcasts `extended`. Route
  `POST /api/convoy/:id/keep`. The context carries `maxExpiresAtMs` and `keepWindowMs`.
- [x] web/convoy.js: `canKeep(ctx, now)`, `endingNote(ctx, now, said)` (once per end time, last 10 min),
  `ConvoyClient.keepGoing()`, the `extended` frame (`onExtended`). web/convoy_ui.js: "Keep going 1 h" on the card while
  `canKeep`, the heads-up toast (spoken in a drive; the leader's has the key), "Convoy kept going: ..." to everyone.
  An old app ignores `extended` and reads the new end at its next connect; an old server sends no numbers, so no key.
- [x] Words: convoy_ui.js, cockpit.js (two places), privacy.html (Convoys), APP_REVIEW.md 5.1.2 row, BACKEND.md,
  CONVOY_TRANSPORT.md, BACKUPS.md.
- Not done: the car's screen (carplay.js) shows no heads-up of its own; the phone speaks it. In-app invites sent before
  a keep still expire at their own time.
- Tests: backend/test/convoy.test.ts "the leader keeps it going ..." (window, leader only, broadcast, alarm, index,
  restart, the six-hour cap); tests/test_convoy_client.py test_keep_going_and_the_heads_up_before_the_end; e2e "convoy:
  ten minutes before it ends ..."; backend vitest and pytest counts below in the PR.
- Exact next task: unchanged.

## Session 2026-11-09 (fable-hpms-limits): a "not reported" speed limit was read as 254 mph (claude/fable-hpms-limits, off origin/main 1d97979)

- [x] Found while measuring posted limits for the overview: the context grid's HPMS `speed_limit` (u8 mph) clamped a state's
  "not reported" code (999 and the like) to 254 instead of nodata, and the phone read it as a measured limit: 409 km/h at
  the head of the engine's speed-limit chain (route_engine.js SOURCES `hpms_speed_limit`), on 281 of the 17,611 spans
  with a limit in the shipped Cincinnati bundles (Boone County KY roads: Nelson Road, Salem Ridge Road, Bellview Lane).
  Unknown shown as measured (rule 3).
- [x] Reader: web/route_ctx/context_grid.js `rawLine` gives NaN for a limit outside 5-85 mph (`LIMIT_MPH`), so today's
  shipped and region bundles read right at once. Writer: tools/ctx_etl/build.py `limit_or` writes nodata for the same.
- [x] Not rebuilt here: the graph tiles' baked quality on those roads was scored with the 409 km/h limit; the next "Graph
  region" build scores them again (context_grid.js is one of the model files, so the build id changes). The context
  bundles need no rebuild for this (the reader refuses the value).
- Measured on the way, NOT changed (tools/graph_etl/score_edges.js, for whoever takes the time model next): on a 5 %
  sample of the shipped tiles' edges, HPMS knows a posted limit on 52 % of the primary and 44 % of the secondary km where
  the tile has only a class estimate (11 % of tertiary); where OSM and HPMS both post one they agree within 5 mph on
  80-93 %. The tiles' times use OSM's limit or the class estimate, never HPMS's; the estimate is off by more than 5 mph on
  32 % (primary) to 78 % (secondary) of those km. Using the engine's own chain for the time is the candidate fix; a wrong
  match (a 15 mph reading on a county road, a road under an interstate) is the risk to check first.
- Tests: test_an_hpms_limit_that_is_no_limit_is_unknown (ETL), test_an_hpms_limit_that_is_no_limit_reads_as_unknown
  (the reader: a unit table and every span of the shipped bundles); pytest 1372 passed, 2 skipped; e2e route overview (1), own
  routing (4), plan flow (6) pass.
- Exact next task: unchanged (tools/live_speed.js on the owner's trips at Fun and Long way); a "Graph region" run picks
  this up together with the expressway flag.
## Session 2026-11-10 (fable-zone-samples): a home zone added later reaches the server and hides the stored position (claude/fable-zone-samples, off origin/main f27a1fe)

- [x] Found by reading backend/src/presence.ts against the app: home zones were only sent with a change of "Show me
  to", so a zone added or removed in Settings never reached the server's copy (the phone still dropped positions inside
  it), and the last sample stored before the zone existed stayed on friends' maps until it aged out.
- [x] web/friends_map.js `syncZones()` (loads settings if needed, nothing while Nobody, a quiet save with the current
  zones); `start()` calls it at each launch; cockpit.js `zonesChanged()` calls it on zone add and remove.
  backend/src/presence.ts `presenceSettingsPut` deletes the user's presence_samples when the zones JSON changes.
- Tests: backend presence.test.ts "a home zone added or moved hides what was stored before it..." (vitest, tsc clean);
  tests/test_friends_map.py test_home_zones_go_to_the_server_when_they_change_and_at_each_launch. No migration.
- Next: nothing owed here. Deploys with the Worker on merge.

## Session 2026-11-09 (route-sliders): Tune your routes, Pro open to everyone until on sale (claude/route-sliders, off origin/main 1d97979)

- [x] Owner: "every parameter with a slider for premium users"; "remember everyone has pro if they are an early user. Once
  we launch app store we will restrict to paid users and anyone who had the beta". New web/route_tuning.js: 14 plain
  sliders in four groups (Time, Roads, Avoid, Data), each a one-line hint, a default equal to today's number (a test holds
  each to the code) and bounds; at defaults no tune at all. They build the Dev panel's tune ({ router, engine, levels,
  hwy }) and ride its plumbing (graph_router.js withTune, route_engine.js setTune); a developer's numbers lay on top
  (`merge`). Garage → Settings → Route tuning (garage_settings.js ORDER 'tuning'); saved as moved (apex.routeTuning, this
  phone only: no account settings sync exists); "Use on the route on screen" re-plans; Reset to defaults.
- [x] Pro: pro.js kind `tuning`, item `route_tuning`, `TUNING_OPEN` / `tuningOpen()` like the themes; on sale without Pro
  the sliders grey out with Pro's line, settings kept, plans use the defaults. test_pro.py: kinds theme, livery, tuning.
- [x] Reach: destination plans (router + engine; Valhalla path engine + levels), loops (our router's search: cockpit.js
  buildLoop sends the tune, graph_router.js `loop` now wrapped in withTune; also the Dev panel's), not Best roads nearby.
- [x] Route card: `#cardTuneChip` "Your tuning" beside Options when the route was planned with a slider moved
  (`t.tuned`, the sliders' names; set through optionOnto `o.tuned`, loops through `loopTuned`); a tap opens the screen.
- [x] New knobs: graph_router.js `K.STOP_AVOID_X` 1 (search-only weight on signal/stop/give-way seconds; route time stays
  real), route_engine.js `W.FUN` 1, `W.GAIN` 0.5 (identical ranking at defaults; ROUTE_ENGINE.md table, flow page rebuilt).
- [x] Bug fixed: graph_router.js `objective()` cached per view without the K weights it read, so a tune of W_FUN /
  W_QUALITY (Dev panel too) did nothing on a warm view and could leak into a later plan; key now includes them.
- docs: CALL_SHEET 2026-11-09 (route-sliders), MONETIZATION.md 3 (row, Founders quote) and 8, APP_REVIEW.md 3.1.1,
  ROUTE_ENGINE.md "Route tuning", OWN_ROUTING.md §5. No inline script changed (`python tools/csp.py`: up to date).
- Tests: new tests/test_route_tuning.py (6) and graph_router_cases.js `routeTuning`; test_pro.py updated (+1). e2e: new
  "route tuning" (2: Fun's time sliders re-plan a longer Fun pick, the chip, Reset brings the pick back; on sale without
  Pro the screen locks and plans use the defaults). Results in the session report.
- Open: on the synthetic e2e grid the fresh-context re-rank (ownRefine, real time-of-day context over made-up roads) swaps
  the card back to the quickest, so the e2e judges the plan's pick (apexDebug.lastFun[0]); not tried on a phone; the
  slider ranges are judgment, not fitted on the owner's trips.
- Exact next task: on the phone, plan the owner's trips at Fun with the time sliders up and check the picks and the chip
  read right; then the engine-rank task below (tools/live_speed.js on the owner's trips).

## Session 2026-11-09 (dev-mode): a Dev panel for the owner and the co-developer (claude/dev-mode, off origin/main 01a0423)

- [x] Owner: "a dev mode in the app that shows all routing parameters and other debug info for only me and my codev to
  mess with". Garage → Settings → Developer → Open the Dev panel (web/dev_panel.js, lazy.js group `dev`). The gate is
  Satellite's: cockpit.js `applyDevFlags` (a fresh `/api/me` with `developer: true`) fills `#garageDevBody`; anyone else
  gets an empty, hidden row, no panel script, and `apex.dev` in localStorage is never read.
- [x] The panel: each candidate of the last plan (source own/Valhalla, minutes, km, highway km, the router's G, role, a,
  side-street and good-road km, the engine's value in its parts, why it was picked, ranked lower or dropped: hard
  constraint, highway rule, over budget), the plan head (budget, own router used, router/view ms, the fresh-context
  re-rank and whether it swapped), the timeline and plan marks, the versions (router, engine, context grid, graph index
  bundled/region builds, ctx index). Raw record: `apexDebug.devPlan` (developers only), summarised by the panel.
- [x] Tunables: graph_router.js `K` (router), route_engine.js `W` (engine), fun_route.js `LEVELS` (levels) and `HWY`
  (hwy), the owner's list first, every other number under "All". Re-plan saves (`apex.dev`) and re-plans the trip on
  screen (`replanForLevel`); Reset restores and re-plans. Plumbing: fun_route.js `tuneOnto` / `untune` / `tuned` /
  `tuneKnobs`; graph_router.js `withTune` around `plan` and `quickest` (`req.tune`, also through the worker's host;
  `quickKey` includes the tune); route_engine.js `setTune` (global, page), `rank(…, { tune })`, `tuneDefaults`, and
  `rank` now leaves `valued` and `limitS` on its answer (non-enumerable). With no tune nothing is touched.
- [x] Switches: Force own router (no Valhalla routes or checks), Force Valhalla (ours off), Offline simulation (the
  page's other-host fetches fail, `navigator.onLine` false), Candidate lines (`apex-dev-cands` under the route casing,
  a colour per candidate, the pick wider). Copy debug JSON (clipboard, else a box to copy from).
- [x] The planner reads dev mode through `window.apexDebug.dev` (frozen; every answer off unless `devAccess`), so
  funRoute's extracted source in tests/test_fun_route.py runs as before.
- Tests: new tests/test_dev_mode.py (4: router tune changes Fun's pick and nothing without one, through the host too;
  engine tune changes the ranking, setTune(null) restores; the gate and lazy load; the knobs listed) and the
  graph_router_cases.js `tune` case; pytest 1358 passed, 2 skipped (no existing test changed). e2e: "dev mode" (2:
  non-developers see no row and stored settings change no plan; a developer opens the panel, re-plans with defaults,
  sets levels fun.slackS 900, re-plans, both budgets move by 660 s, Copy debug JSON, Reset, Force Valhalla, Offline
  simulation), levels (3), plan flow (6), own routing (4), offline plan, valhalla down, satellite (2), REVIEW5 §2,
  your data, first run (2), a short trip: all pass. `python tools/csp.py`: up to date (no inline script).
- [x] docs: CALL_SHEET 2026-11-09 (dev-mode), APP_REVIEW.md 2.3.1 developer Dev panel row, OWN_ROUTING.md §5 overrides.
- Open: not tried on a phone (WKWebView clipboard from `apexnav://`, the panel's height under the notch); overrides
  apply to destination plans only (not loops, reroutes or Best roads nearby).
- Exact next task: unchanged from engine-rank below (tools/live_speed.js on the owner's trips at Fun and Long way); the
  owner can now do the same on the phone with the Dev panel and paste its JSON.

## Session 2026-11-10 (fable-design-pass): design pass 1, the empty Log and Stages pages and two Garage rows (claude/fable-design-pass, off origin/main ad4f1e4)

- [x] Owner 2026-11-10: UI and UX polish is a main focus of the run ("designed by an artist, not a programmer").
  Captured onboarding, the idle map, Layers, Garage, Settings, People (signed out), Log, Stages at 393x852 and read them.
- [x] web/analysis.html: `#historyEmpty` is a `.first-page` (pencil sketch of the hero and one row, head, line, Start a
  drive, Watch a replay first); the empty Stages list the same shape with a drawn stage; `.switch > button
  { font-family: inherit; }` (Drives / Stages were Arial).
- [x] web/index.html: Garage `.ctl-label` rows at 15/500; `#coNotesHere` is a `.co-row` with "Change in Layers".
- Tests: tests/test_log_first_page.py (3), e2e "the empty Log is a first page..." (computed typeface, key sizes).
- Seen and not yet done (next design chunks, in the order I would take them): the signed-out People page is a logo and
  a button over two thirds of blank paper; the search sheet says "Routing..." in plain text where the route card will
  be; MapLibre's attribution is the stock control (IDEAS U-53); the Garage is still a long settings page (U-49).
- Exact next task: the signed-out People page and the search sheet's waiting state, then U-49.

## Session 2026-11-09 (drive-overview): "What this drive is like" on the route card (claude/drive-overview, off origin/main 01a0423)

- [x] Owner: "can we compile the data used to give some kind of route overview for the type of drive it will be? in plain
  english for the user." New pure module web/route_story.js (`ApexRouteStory.build(ranked, { metric, steps, track,
  glareMin })` -> `{ lines: [{ kind, text, facts }], coverage }`): character (setting share and posted limits), the best
  stretch (names from the track's steps, corners and tight ones), town / suburbs / lights / side streets, members' crowd
  data per named road, today's conditions (the engine's time-of-day costs, rain, weather code, low sun, closures). Each line
  only with its data known over enough of the route (`T`); unknown is never said. ROUTE_ENGINE.md "What this drive is like".
- [x] Card: `#routeCardStory` (web/index.html) under the profile, the first line as a closed `<details>` summary, the rest a
  tap away. cockpit.js: `optionOnto` keeps the ranked candidate on the track (`t.ranked`, non-enumerable), `renderRouteCard`
  calls `paintStory`, which builds it in a setTimeout after the card is up and keeps it on the track (`t.__story`). Three
  additive edits only (claude/dev-mode also touches cockpit.js). Not on loops, GPX or restored routes. CALL_SHEET 2026-11-09.
- [x] No inline script changed (`python tools/csp.py`: all pages up to date). No iOS shell, sign-in, social or data
  collection change, so APP_REVIEW.md is untouched.
- Tests: new tests/test_route_story.py (11: country, suburban, mixed, a highlight with names and without, units, thin data,
  unknown data, an estimated limit, members without names, conditions); new e2e "route overview" (plans on the graph
  fixture: "Mostly suburban roads, 35–55 mph." / "2 sets of lights on the way."). pytest 1365 passed, 2 skipped; e2e route
  overview (1), levels (3), plan flow (6), own routing (4), level cards (2), offline (6) all pass. Build ~4 ms for 80 km.
- Open: thresholds are judgment, not fitted on real trips; the wording hasn't been read on the owner's routes.
- Exact next task: plan the owner's trips (work to home, colerain, harrison) at Fun and Long way in the app and read the
  overview against the roads; tune `ApexRouteStory.T` (the 0.65 highlight mark, the setting signals) where a line reads wrong.

## Session 2026-11-08 (drop-fcc): FCC coverage removed at the owner's word (claude/drop-fcc, off origin/main 77db807)

- [x] Owner: "we can just drop fcc it's confusing". Removed #311's FCC path: tools/ctx_etl sources.py (MobileCoverage,
  fcc_json, fcc_creds, SOURCES["fcc"], FCC_API), transforms.py (fcc_pick_files, fcc_tech, fcc_env, provider_count,
  latest_as_of), build.py (mobile_coverage no longer in RASTERS, no FCC step); FCC_USERNAME / FCC_API_TOKEN out of
  context-grid.yml and ctx-region.yml; FCC tests and tests/fixtures/ctx_etl/fcc_listing_synthetic.json deleted;
  car.js `signalFromProviders` and its test removed; FCC out of licenses.html, index.html (About sources),
  OWNER_TODO, ROUTE_ENGINE.md (flow page regenerated). privacy.html and APP_REVIEW.md had no FCC text.
- [x] Signal as before #311: car.js passes `opts.peer[id].channels.mobile_coverage` straight to signalPlan (code identical
  to 744e516^); route_engine.js `signal_coverage` untouched; grid.py / context_grid.js keep the channel, marked no source.
- [x] Earthdata (VNP46A4 night lights, EARTHDATA_TOKEN, h5py, the headers on http/cached_file) unchanged.
- Tests: pytest 1353 passed, 2 skipped (1358 before, less the 5 FCC-only tests); `python tools/csp.py` all pages up to
  date. Backend untouched.
- Exact next task: unchanged from engine-rank below (tools/live_speed.js on the owner's trips at Fun and Long way).

## Session 2026-11-10 (fable-loved-roads): the app's recorded drives count toward loved roads; by-hand sharing is honest (claude/fable-loved-roads, off origin/main ad4f1e4)

- [x] web/contributor.js `createLive`: `deliberate` may be a function, asked as rows arrive; `recorded()` latches from
  the first recorded row (slices' `rec`, and `leftover().deliberate` as a plain boolean for road_carry.js).
  web/cockpit.js feedAmbient passes `deliberate: () => !!(drive.native && drive.rec)`.
- [x] cockpit.js End: `nativeShared` (the mounted stream ran during this native drive) and `|| waits` (the browser's
  drive whose road feel waits for signal) save the drive `contributed`, so analysis.html's Share by hand doesn't
  offer a pass that went or will go by itself. `contributeDrive` throws on 'retry' instead of counting it sent.
- Tests: tests/test_loved_roads.py (5), e2e "loved roads: in the app..." (a real native drive, `rec` on every chunk,
  the saved drive marked shared).
- Not shipped: I rebuilt road feel waiting for signal on a branch (`claude/fable-road-later`) before seeing #323 had
  merged the same thing (road_carry.js). No PR was opened; the branch can be deleted. This entry is what was new in it.
- Open: `road_love` on production has no rows from before this build. docs/WORKER_QUEUE.md road-queue names a
  web/road_queue.js that is not in the repo.
- Exact next task: after a TestFlight drive on a road driven before, check `road_love` has a row
  (`SELECT COUNT(*) FROM road_love`) and the route card's "members come back to this road" line shows.

## Session 2026-11-08 (engine-rank): the engine and the router agree on what a longer way buys (claude/engine-rank, off claude/level-spread = main fdbf363)

- [x] The engine's value broken into its parts (tools/live_speed.js dumps lastFun[].parts and ev). On colerain and subdivision4
  Long way, `poor` (10 a km of side street) decides. Time doesn't (Long way's -4.9 for 14 min), and nor do the corners
  (fully gated on the good road).
- [x] colerain: the engine was wrong. It charged side street by the km but counted good road only in a mean, so the 31.6
  min route's 11 km more of the best road gave +3 against -16 for 3 km more suburb. New part `road`
  (route_engine.js `W.GOOD_PER_KM` 1.5 per km of good road gained over the quickest: quality 0.5 -> 0.65, never a
  motorway or ramp, cap 30; why line "N mi more good road"; ROUTE_ENGINE.md weights, flowchart regenerated).
  App's colerain Long way: 17.4 -> 31.6 min (+5.1).
- [x] subdivision4: the engine was right. The router's G (a mean) rewarded 2.6 km of good road bought with 3 km more
  subdivision, and colerain Fun's 19.6 min pick was a strip mall's G. graph_router.js `pick()` adds `K.ROAD.w` 0.003 x
  the engine's per-km road points over the level's quickest (`why.poorKm`, `why.goodKm`). The router's picks now equal
  the app's on all 15 trip-levels.
- [x] App picks before/after (live, warm): changed only colerain Long way (31.6) and northgate Fun (12.1 -> 14.4, 1.1 km
  more good road, a 0.3-point near-tie before). Quick, subdivision and the other levels are unchanged.
  OWN_ROUTING.md §5, §8 2026-11-08 (engine-rank); CALL_SHEET 2026-11-08 (engine-rank).
- [x] Planning time unchanged (node, 5 trips warm, best of 4: Quick 186/185, Fun 148/152, Long way 173/173 ms).
- Tests: new test_the_good_road_a_longer_way_buys_has_a_length, test_the_pick_weighs_the_road_length_as_the_engine_does
  (both fail without the change); pytest 1358 passed, 2 skipped; e2e level (6), own routing (4), plan flow (6),
  offline (6) all pass.
- Open: the GOOD_PER_KM 1.5 and ROAD.w 0.003 values are fitted on the 5 public trips (colerain flips at 1.0). The
  owner's own trips weren't re-run here.
- Exact next task: run tools/live_speed.js on the owner's trips (work to home, owner1) at Fun and Long way and check the
  "more good road" lines read right; then production after the deploy.

## Session 2026-11-08 (levels): each level spends its budget on better road (claude/level-spread, off origin/main 744e516)

- [x] The levels audit (route_quality.js, 5 public trips): Long way = Fun on every trip (bisection capped at A_MAX 40
  with time left), Fun short of the in-budget best on colerain (G 0.304 against 0.340). web/graph_router.js: Fun and Long
  way now pick by `pick()` (length-weighted goodness G less `K.BUY` 0.12 / 0.03 per 100 % extra time over the level's
  quickest; under `K.BUY_MIN` 0.1 never the pick), among the bisection's steps, LOWER, the alternates and the new
  **spread** (penalty alternates x1.6 / x2.5 of the first step's route, `K.SPREAD`, one search); `K.A_FIRST` 5,
  `K.A_MAX` 80 at Long way; `why.goodness` on every route. Quick, the highway rules and loops unchanged.
- [x] Router picks after (min, G): subdivision Fun / Long way 5.3, 0.200 (was 8.7, 0.253); subdivision4 Long way 17.2,
  0.323 (was 12.0, 0.262 = the audit's ceiling); northgate Fun 12.1 (was 14.4), Long way 29.1, 0.398 (was 14.4, 0.251;
  above the audit's ceiling); colerain Fun 19.6, 0.340, Long way 31.6, 0.403 (both = ceiling); harrison Fun and Long way
  31.6, 0.469 (Fun's ceiling was 0.454; Long way's 0.478 at 41.9 min buys 0.009 for 10 min, not taken at 0.03).
  OWN_ROUTING.md §5, §8 2026-11-08 (levels); CALL_SHEET 2026-11-08 (levels).
- [x] Plan time (node, 5 trips warm, sum): Fun 137 -> 151 ms (+10 %), Long way 156 -> 177 ms (+13 %), Quick the same.
- [x] In the app (tools/live_speed.js, local web/ of each, warm) the engine's ranking has the last word: Long way now
  differs on northgate (29.1 min, 19 more good corners; was 14.4) and harrison (41.9, was 37.5); colerain (17.4 at both
  levels) and subdivision4 (12.0) unchanged because the engine values the shorter route higher.
- Tests: new test_each_level_spends_its_budget_on_better_road, test_no_level_lengthens_a_trip_with_no_good_road
  (levelSpread case, synthetic; both fail on main); pytest 1356 passed, 2 skipped; e2e levels (3), own routing (4),
  plan flow (6), offline (6) all pass.
- Open: the router's G and the route engine's value disagree on colerain (31.6 min G 0.403 ranked -41.9 against 17.4's
  -37.6) and subdivision4 (17.2 min G 0.323 at -62.5 against 12.0's -40.3).
- Exact next task: find why route_engine.js rank values colerain's 31.6 min and subdivision4's 17.2 min Long way routes
  below the shorter ones (per-term breakdown of the value: corners on side streets, strip mall, time cost at perMin 0.35)
  and decide whether the engine or the router's goodness is wrong; then re-run route_quality.js and tools/live_speed.js.

## Session 2026-11-10 (fable-design-people): design pass 2, the route card's action strip and the map's credit (claude/fable-design-people, off origin/main ad4f1e4)

- [x] web/index.html `.rc-links`: a flex strip ruled top, bottom and between keys, 48 px keys sized to their words, no
  underlines, `[aria-pressed="true"]` inked in; two a row under `html[data-type-size]`.
- [x] web/index.html `.maplibregl-ctrl-attrib` on the look's tokens (IDEAS U-53 done): square, `--panel` paper,
  `--panel-ink` rule, the button's stock image replaced by an "i" in `--font-num`; the accent outline on keyboard focus.
- Tests: e2e "design pass 2..." (one row edge to edge, 44 pt, no underline, no cut word, Saved inked in, the credit's
  computed style); tests/test_design_pass.py (source rules).
- Seen and not yet done: the signed-out People page (a logo and a button over blank paper); the route card stacks two
  pencil help lines under the levels ("Swipe the card for the next route", "For Fields Ertel Road..."); the Garage is
  a long settings page (U-49).
- Exact next task: the signed-out People page, then the route card's help lines.

## Session 2026-11-08 (keys): the owner's answers on the free keys (claude/keys-1108, off origin/main)

- [x] NREL is now NLR: backend/src/chargers.ts asks developer.nlr.gov (developer.nrel.gov no longer resolves; nlr.gov
  answers 200 with DEMO_KEY, checked from the build container). Secret name `NREL_API_KEY` kept. Vitest asserts the host.
- [x] Flickr dropped (no free keys): photos.js, `flickrApiKey` in route_feeds.ts CTX_KEY_NAMES, www.flickr.com in
  tools/csp.py CONNECT (pages regenerated), licences, privacy, APP_REVIEW.md, ROUTING.md, ROUTE_ENGINE.md. Tests now
  assert Flickr isn't asked or mentioned (test_route_ctx_photos, test_route_ctx_fetch).
- [x] Night lights from NASA Black Marble VNP46A4 with `EARTHDATA_TOKEN` (tools/ctx_etl: transforms.vnp46_radiance,
  night_from_radiance = min(1, (r / 20) ** 0.7); sources.night_prepare / night_lights_viirs / read_vnp46a4 with h5py; the
  newest year LAADS lists, AllAngle_Composite_Snow_Free, quality 0-1 only). No token, or a refused one: the 2016 GIBS path
  for the whole run, unchanged (a Cincinnati rebuild without secrets is identical to the committed bundles). LAADS
  listings answer without a token from this container; file downloads redirect to the Earthdata login (303), so the HDF5
  read is tested on a synthetic file only.
- [x] FCC mobile coverage with `FCC_USERNAME` + `FCC_API_TOKEN` (sources.MobileCoverage: listAsOfDates →
  listAvailabilityData per state → 4G/5G mobile-broadband shapefiles per provider, in-vehicle where listed →
  mobile_coverage = providers per 32-cell, NaN outside the states read). Without both: skipped, as before. The FCC API
  answered 401 without credentials here, so the listing's field names and the downloadFile path (`/1` = shapefile) are
  from the API spec, not seen live.
- [x] Consumer: route_engine.js already reads mobile_coverage (signal_coverage); car.js `signalFromProviders` turns the
  count into its 0..1 signal (0 / 0.5 / 1) for the no-signal stretch, Share-your-ETA point and offline areas.
- [x] Both secrets passed in .github/workflows/context-grid.yml and ctx-region.yml; h5py in tools/ctx_etl/requirements.txt.
- Tests: pytest 1352 passed, 2 skipped (new: tests/test_ctx_etl_accounts.py, 11 tests on labelled synthetic
  fixtures incl. tests/fixtures/ctx_etl/fcc_listing_synthetic.json; test_route_ctx_car fcc count); backend tsc clean,
  vitest 357 passed; e2e: route context, offline plan, levels (3), garage photos, spot photo, plan flow (6) all pass.
- Open: NIGHT_SAT / NIGHT_GAMMA are estimates; the first run with the token logs "night lights vs 2016 over N cells"
  (means, r, dark counts): tune from that line. The FCC request shapes are unverified until a run with the secrets.
- Exact next task: once the owner has added the secrets and run "Context grid (route data ETL)" (preset launch, upload),
  read the run's log: the night-lights comparison line, "FCC mobile coverage <date>: N providers ... (environment)",
  any "! FCC" lines; fix the FCC listing filter / download path if the live answer differs, tune the night mapping, then
  rebuild the committed Cincinnati bundles (preset cincinnati) so the app's shipped grid has both.

## Session 2026-11-08 (night): planning speed on production and a weak signal (claude/prod-speed)

- [x] Measured production (#307) with a harness that logs every request of the page and its workers and dumps
  apexDebug.timeline (tools/live_speed.js): cold 0.97-5.0 s card, warm 0.23-0.84 s, a second plan 0.14-0.5 s.
  The cold seconds were the harness and the website: a fresh profile, a 0.2-0.3 s proxy per request, the website
  fetching the app's files and shipped tiles, and the routing worker started at Enter (its scripts in 2.5-3.7 s later).
  The app's case (web/ local, /api relayed): 0.1-0.65 s card, nothing on the network before it (OWN_ROUTING.md §8).
- [x] No network before the first route or the card where our tiles are on the phone: the region index's kept copy used
  however old, refreshed behind (none kept: 3 s from launch); the worker and both indexes at launch; the region's tiles
  within 15 km kept at launch; Avoid towns 0.4 s and crew roads 0.3 s before the card; the Log's prewarm never mid-plan;
  a restored route never replaces a new plan. With every request off the app hanging from launch, main showed no route
  in 60 s, the branch 0.26-0.72 s (e2e "weak signal").
- [x] Where to?: your pinned and recent places match as you type, at once; Enter before the list waits for the map
  search already asked (1.5 s) before a full geocode; the top suggestion's tile read while you choose.
- Tests: pytest 1342 passed, 2 skipped; e2e 137/137 (full run, after merging #308 and #309).
- Open: production after the deploy, cold and warm (tools/live_speed.js, BASE defaults to production); a phone's own numbers
  (WKWebView, LTE, Apple's place search) can't be measured from here.
- Exact next task: after the deploy, `OUT=<dir> AGAIN=1 node tools/live_speed.js subdivision:fun northgate:fun colerain:fun
  harrison:fun colerain:quick colerain:max` against production; warm should match the local numbers (card 0.25-0.65 s)
  and colerain max warm should drop from 1.6 s (the worker now starts at launch).

## Session 2026-11-08 (later): what the levels mean (claude/level-rules, off claude/own-routing-instant-2)

- [x] The owner: "fun should never go on the highway. Quick should essentially be a normal route i suppose". Quick is the
  quickest way, highways welcome, a nicer road only within a minute (LEVELS quick budget 0 + 60 s). Fun and Long way
  never drive a motorway, trunk road or their links: a hard filter in graph_router.js (`K.NO_HWY`, `opts.ban`: plan,
  quickest, alternates, through, loop legs) and in the ranking (fun_route.js `levelHighways` / `applyHighways`, used by
  route_engine.js rank and FunRoute.rank; loopRank for loops); Valhalla use_highways 0 at Fun and Long way
  (`levelCosting`, `loopCosting`, the default route, a reroute). The exception (no highway-free way in the corridor: a
  river crossed only by an interstate bridge, a start or end on a ramp): the shortest link, "Uses 0.4 mi of I-275 (no
  other way across)" on the card. A highway-free way over 2x Quick's time: still none, "No highway-free way in a sensible
  time; Quick is the way" (route_engine.js `whyHighway`). CALL_SHEET 2026-11-08 (later); OWN_ROUTING.md §5, §8.
- [x] Live (the real app in Playwright on this branch's web/, production's Worker for /api; highway km = the shown
  track's 5 m samples on our tiles' motorway/trunk edges; before = claude/own-routing-instant-2 at e5e8453):

  | case | level | before: highway km, min over Quick | after: highway km, min over Quick | after: the why line |
  |---|---|---|---|---|
  | work to home | Quick | 22.4, +0.2 | 22.4, +0.2 | (none) |
  | work to home | Fun | 25.5, +7.9 | 0, +22.7 | No highway-free way in a sensible time; Quick is the way |
  | work to home | Long way | 31.2, +13.1 | 0, +22.7 | the same (the same 44 min route) |
  | owner1 | Quick | 0, +4.7 | 4.0, 0 | (none: the quickest) |
  | owner1 | Fun | 0, +6.4 | 0, +4.2 | Avoids 1.7 mi of strip malls · 9 more good corners · nicer country, +4 min |
  | owner1 | Long way | 0, +16.6 | 0, +14.4 | 16 more good corners · avoids 1.7 mi of strip malls · nicer country, +14 min |
  | colerain | Quick | 6.6, 0 | 6.6, 0 | (none) |
  | colerain | Fun | 6.6, +0.5 | 0, +2.2 | The quickest way off the highway is a good road too. Over the 17 min route: fewer side streets · its extra corners are on side streets or between houses |
  | colerain | Long way | 6.6, 0 | 0, +2.2 | the same |
  | northgate | Quick | 8.5, +1.1 | 4.6, 0 | (none: the quickest) |
  | northgate | Fun | 8.5, +1.1 | 0, +1.5 | Nicer country, +1 min |
  | northgate | Long way | 8.5, +1.1 | 0, +3.8 | Nicer country, +4 min |
  | harrison | Quick | 0, +2.7 | 21.7, 0 | (none: I-275 and I-74, the quickest) |
  | harrison | Fun | 9.9, +7.5 | 0, +9.7 | 27 more good corners · avoids 0.8 mi of strip malls · open roads at 45 mph, +10 min |
  | harrison | Long way | 9.9, +7.5 | 0, +16.1 | 38 more good corners · avoids 0.8 mi of strip malls · back roads at 45 mph, +16 min |
  | subdivision | all three | 0, 0 | 0, 0 | Fun, Long way: No great roads on this trip: Quick is the way |
  | loop Winton Woods 30 mi | Fun | 0 of 69.2 km | 0 of 69.2 km (the same loop) | |
  | loop Sharon Woods 30 mi | Long way | 0 of 61.8 km | 0 of 61.8 km (the same loop) | |
  | loop Fountain Square 30 mi | Fun | 7.3 of 66.8 km | 0 of 44.1 km | |
  | loop Fountain Square 30 mi | Long way | 1.5 of 56.4 km | 0 of 65.7 km | |
  | loop Miami Whitewater 1 h | Long way | 0 of 40.7 km | 0 of 40.7 km (the same loop) | |

- Tests: pytest 1339 passed, 2 skipped (new: graph_router levelsHighway cases for the motorway and trunk beside a back
  road, the river bridge, the absurd detour and Quick within a minute; loops on the motorway grid 0 highway where they can;
  engine, calibration and live tests moved to the rule); e2e "levels:" (3 new flows, Quick / Fun / Long way on the
  motorway grid, the Fun flow taps the Quick and Fun cards), own routing (4), offline, valhalla down, plan flow (6),
  level cards, a road someone sent, a suggestion, a short trip: all pass.
- Open: the owner's work to home trip is the "absurd" case (the highway-free quickest 44 min, 2.07x Quick's 21): Fun and
  Long way both show it with the Quick-is-the-way line; whether that, or Quick's route, or a 2.5x limit is wanted is the
  owner's call (CALL_SHEET). Colerain at Quick now takes Colerain Avenue (the quickest; Pippin and Struble are 1.4 min
  more). Expressways tagged `primary` + `motorroad=yes` aren't in the tiles' flags yet.
- Exact next task: the owner checks the work-to-home card at Fun; then, if wanted, keep `motorroad=yes` as a tile flag in
  tools/graph_etl (osm_graph.py, build.py) and treat it as a highway in graph_router.js isHwyEdge.

## Session 2026-11-08: the owner's TestFlight notes of 2026-11-05, build 592.1 (claude/feedback-1105)

- [x] Screenshots from the `feedback-screenshots` artifact of run 42432318127 (gh run download), each looked at first.
- [x] Note 1 (Crews, "a dashboard like the groups you're in, with a feed, pin crews"): in 2+ crews the Crews side is a
  dashboard (crew_page.js `dashboard`, `dashOrder`, `dashLine`): a row a crew (crest, next drive / last message, pin), pins
  first (on the phone, `apex.crewPins`), then "Latest from your crews"; a crew opens with "‹ Your crews". New Worker route
  `GET /api/crews/feed` (crew_page.ts `crewFeed`, same block/report rules as chat and drives; no migration). One crew: its
  page as before. The old name-chip switcher is gone.
- [x] Note 2 ("bad when typing new crew info"): bottom sheets (`.side-pop`, the confirm sheet) stand on the keyboard with
  the field in view (index.html, controls.css `html.kb-open`); Start a crew in fill-in order, Create crew last.
- [x] Note 3 (your photo): the Garage photo is the key (photos.js `mine`): picker, or Choose a new photo / Remove photo /
  Cancel; the note and the two keys gone. APP_REVIEW.md updated (photos, the crews feed).
- [x] Note 4 ("bad text spacing", a stage's Board and Runs): runs are a line with components under it (no sideways scroll;
  it was 469 px in 335), the empty board is a sentence, no "@null" for a friend with no handle.
- [x] Note 5 (Ways to go "glitched animation"): focusing the first key mid-slide scrolled the overlay (WebKit held the sheet
  ~360 pt up for the whole slide). keyboard.js undoes a sliding sheet's scroll; Ways to go focuses with preventScroll.
- [x] Note 6 ("takes up so much screen", the idle deck): suggestion + one road; swipe down on the bar folds the deck to the
  bar alone (kept, `apex.deckMin`), swipe up brings it back, the next opens Where to?.
- e2e: six new flows ("TestFlight 2026-11-05 note 1..6" and "a stage's Board and Runs"), at 393x852 and the four safe-area
  shapes; note 2 with the keyboard height the shell reports per shape. Backend: crew_page.test.ts feed test. pytest:
  test_crews_dashboard_order_and_line.
- Tests: pytest 1332 passed + the new one; backend tsc clean, crew_page/crews/events vitest 34 passed; full e2e 131/132
  (the one failure a focus race in the new note 1 flow, fixed: 3/3 repeated, and every crew flow 9/9 after).
- Open: pins don't follow you to a second phone (a server column if wanted); the feed needs the Worker deployed (until
  then the dashboard says the latest couldn't be loaded); the folded deck has no VoiceOver action of its own (Where to?
  holds everything in it).
- Exact next task: the owner checks the dashboard with real crews on the next TestFlight build, and the deck fold gesture.

## Session 2026-11-08: own routing instant (2): limits offline, Valhalla down (claude/own-routing-instant-2)

- [x] Speed: exact faster sightDistanceM, every candidate's track built ahead, the engine's samples kept (2d41b40); the
  plan reuses the first route's search (graph_router.js quickKey), towns with the context, limits after the card.
  Live, 8 cases, main (#306) / branch back to back: warm card 223-694 / 249-588 ms, cold card 291-686 / 278-577 ms,
  first route warm 109-263 / 116-198 ms; same pick as main 16/16 (OWN_ROUTING.md §8 2026-11-08). Targets met in every
  run (card 0.7 s warm, 1.0 s cold; first route 0.4 s warm) on a lightly loaded box.
- [x] Posted limits offline: our routes' limits from the tiles (own_routing.js limitsAlong, cockpit.js attachLimits);
  trace_attributes only off our tiles and for contributions. Unit test graph_router_cases limits; the offline e2e
  flow asserts a known posted limit on every plan and no trace_attributes asked.
- [x] Valhalla down: e2e "valhalla down: planning inside our tiles is unaffected" (refused, then hanging); nothing on
  the planning path of a route waited on Valhalla; a loop did (the context's router provider, 2.9 s with Valhalla
  hanging), fixed: 0.6 s. The remaining Valhalla uses are listed in OWN_ROUTING.md §8 2026-11-08.
- Re-measured on a box shared with another agent (load 4-6): main and branch both over 0.7 s warm on the long trips
  (harrison branch 536-1300, main 617-1254); branch no worse than main; same pick 34/34 (OWN_ROUTING.md §8).
- Tests: pytest 1335 passed, 2 skipped; e2e 127/127 (full run, after fixing the offline flow's weather-line read race:
  a 126/127 run under load read the line between a route's replace and its refused forecast).
- Open: on a loaded box the long trips are 2x slower (2026-11-07's numbers); the context's page work (graph, driver,
  conditions, 0.1-0.15 s) and the lead ranking (0.05-0.08 s) are what's left; the worker's plan 0.2-0.3 s.
- Exact next task: measure on production after deploy (the tiles over the network, cold); if the long trips' card is
  over 0.7 s warm there, move the graph provider's fromTable and the driver provider into the routing worker.

## Session 2026-11-07: own routing, instant and offline; Valhalla only as backup (claude/own-routing-instant)

- [x] The owner's goal: "Planning in well under a second. Routing that works offline. No dependence on a free server that
  can slow down or go away. Valhalla would stay only as a backup and for turn instructions until we build our own."
- [x] A timeline per plan (`apexDebug.timeline`); nine items removed from the critical path between the first route and
  the final card (OWN_ROUTING.md §8 2026-11-07): members' roads kept per cell, our quickest kept when picked, localTime
  per minute, engine evaluations reused, a second analysis worker started early, no page turn before a track built
  ahead, geometry in the routing worker, the plan's tile loading behind the first route's, the corridor's tiles first.
- [x] Live, 8 cases on #305's main (first route / final card, ms): warm card 463-1174 (was 662-1500), cold card
  517-1291 (was 873-1510), first route warm 230-422; same pick as main's in 16/16 runs. Table in OWN_ROUTING.md §8.
- [x] Offline: e2e "offline: plan a route and a loop from our tiles with no network" (Quick, Fun, Long way, our own
  instructions, the card says live data isn't known, typed search says offline, a map tap's place, a loop, the browser
  offline too). Fixed: the card's weather line hid instead of saying "not known".
- [x] Valhalla off the critical path where our tiles cover: loops (ours first, the map's stage loops after the card),
  reroute and every points route (`through` on our tiles, offline too). The audit table is in OWN_ROUTING.md §8.
- Tests: pytest 1332 passed; e2e 123/124 on the full run before the last merge (the one failure was the new offline
  flow clicking a hidden Clear, fixed: 4/4 after), own routing, level and loop flows re-run after it.
- Open: the warm card over 1 s on the two longest trips (harrison 1.17 s, northgate 0.99 s): the context's main-thread
  work, the first ranking and sight distance in the pick's track; posted limits offline (our tiles carry them).
- Exact next task: lay the tiles' speed limits on our routes (route.graph limit) so the strip and card have limits
  offline, and a faster exact sightDistanceM (or the pick's analysis started from a ranking on the tiles' scores alone
  while the time-dependent context runs); then measure on production after deploy.

## Session 2026-11-06 (later): destination picks (claude/dest-picks)

- [x] The owner's work-to-home report: corners between houses cut by agreeing built evidence (fun_route.js BUILT,
  route_engine.js cornerGate, graph_router.js objective); Flow and Dull gated; `whyOver` (a pick the card shows as beaten
  says why) and `whyQuickest` ("No great roads on this trip") on the card's why line; router tries 0.9 / 0.75 of the
  found goodness weight (K.LOWER); refine swap to a newly found route says "Found a better way". tests/test_dest_picks.py.
- Live before/after (main vs branch served locally, back to back, 7 trips x 3 levels): no pick changed for the worse on
  the engine's value; Fun on a public cross-suburb trip went from +11 min to the quickest with the no-great-roads line;
  the owner's trip keeps its county-road way at Fun (+8) and Long way (+12) with honest corner counts (CALL_SHEET).
- Open: Long way on the owner's trip still +12 min; whether avoiding the US-27 end is worth that is the owner's call.
  The tiles' baked `fun` is gate-only (the router applies the cut at query time); a tile rebuild could bake it instead.
- Exact next task: the owner checks the work-to-home card at Fun and Long way; loops keep their own loopDominates (its
  own measures), destination options use FunRoute.dominates (the card's minutes and corners).

## Session 2026-11-06 (later): level cards and the map's labels (claude/level-cards)

- [x] The route card's level is one control: three cards (Quick, Fun, Long way), each its pick of the routes already
  found (time, corners); a tap puts it up with nothing planned again, the card you tapped held under your finger
  (changeLevel's settle). The tile row and the switch are gone. Two levels on one route: both lit, the line under the
  cards says so; a level the plan didn't look at (Long way after Fun) says "Look further" and plans on a tap. The swipe
  steps through the cards' routes then up to two others, and the line says "Swipe the card for the next route, 2 of 3".
  cockpit.js `paintLevelCards`, `takeLevel`, `destLevels`, `loopLevels`, `withLevels`; route_card.js `levelCards`,
  `levelNote` (tests/test_route_card.py).
- [x] The viewpoint / café / fuel stamps along a route collide and hide as the map moves, the most useful few kept
  (scenic.js `declutter`, tests/test_scenic.py; cockpit.js `declutterPois`).
- [x] ownRefine's weather swap could never run (useOption refused the copy it was handed); fixed (CALL_SHEET).
- [x] e2e: plan flows (a), (e, f), (b) on the cards; a new flow checks the cards on the four safe-area phone shapes for a
  destination and a loop (no wrap, nothing cut, clear of the island); the Dynamic Type floor covers the cards; a flow
  piles a fuel stamp on every km and checks none overlap, the viewpoint shown, at most four fuel, more when zoomed in.
- Full local e2e: 121/122 (all new and changed flows pass); "drag to reshape" fails, and fails the same on this branch's
  base (9368196) and on main (bf40b1b): not this change. Bug: the drag's re-plan reaches the router without the new stop.
- Open: the e2e loop stub builds one loop, so the loop flows see all three levels on one route; a stub with distinct
  loops would test a loop's level change moving the route.
- Exact next task: the owner looks at the cards on a real 90 mi loop; then, if wanted, a loop stub with three distinct
  loops in e2e/smoke.js planRouter.

## Session 2026-11-06: loops off the highway, from the best roads (claude/loops-off-highway)

- [x] The owner: "it also seems to route mostly highway for loops", and "the loops don't at all need to be a circle".
  A loop is now any route back to the start with little driven twice, built from the best roads within reach
  (CALL_SHEET 2026-11-06; OWN_ROUTING.md §5 and §8).
- Root causes:
  - our router's ring legs had no highway cost, and its objective reads a motorway as good, fast road;
  - Valhalla's stage legs and loop matrix asked `use_highways` 0.6;
  - the loop ranking had no highway term, and the engine's quality and side-street terms favour a motorway;
  - removeSpurs' 400-point look-ahead was the whole of a sparse own-routed loop, so 0 km loops won.
- [x] Fixes:
  - graph_router.js `loop`: the best stages chained one to three at a time; motorway/trunk ×2.5/×3/×4 at
    Quick/Fun/Long way; connectors at a ≤ 3; rings only as the fallback.
  - `loopCosting` (use_highways 0.25 at Quick, 0.1 otherwise).
  - `FunRoute.loopRank`: highway share charged, and a loop beaten on both corners and time never wins (the owner's
    90 mi Long way case).
  - The circle baseline only as the last resort; spurs cut on an even 5 m line.
- Live (the real app in Playwright on production's Worker; winner's motorway/trunk share, before → after):

  | case | before | after |
  |---|---|---|
  | Sharon Woods 30 mi Fun / Long way | stages 52 km, 56 % / same | stages 48 km, 0 % / same |
  | Sharon Woods 1 h Fun | own 33 km, 80 % | own 31 km, 13 % |
  | Sharon Woods 1 h Long way | own 46 km, 90 % | own 40 km, 0 % |
  | Sharon Woods 90 mi Long way | own 127 km, 34 % | stages 113 km, 0 % |
  | Fountain Square 15 mi Fun | own **0 km** | own 21 km, 4 % |
  | Fountain Square 30 mi Fun | own 38 km, 93 % | own 67 km, 11 % |
  | Fountain Square 1 h Long way | own 31 km, 89 % | stages 43 km, 8 % |
  | Winton Woods 15 mi Quick | stages 16 km, 0 % | own 24 km, 0 % |
  | Winton Woods 30 mi Fun / Long way | own 50 km, 13 % / 0 % | own 31 km, 0 % (both) |
  | Winton Woods 1 h Fun | stages 42 km, 0 % | own 31 km, 0 % |
  | Winton Woods 90 mi Long way | circle 126 km, 0 % | stages 93 km, 0 % |
  | Miami Whitewater 30 mi Fun / 1 h Long way | own 47 km, 0 % / 39 km, 0 % | own 40 km, 0 % / 45 km, 0 % |

- Tests: tests/test_graph_router.py (motorway grid: every loop "stages", at most 20 % / 10 % / 10 % motorway),
  tests/test_plan_options.py (the 90 mi case, highway cost), e2e "own routing: a loop from our tiles … keeps off the
  motorway".
- Open:
  - Short loops (under about 25 km) from suburban starts still come from the rings, because no stage loop fits.
  - Our loop lengths cluster (Winton Woods 30 mi: 31 or 65-75 km), so the pick can be 35 % short ("the closest good
    loop to 30 mi").
  - The planner's loop pick still leans on the engine's side-street terms more than on length.
- Exact next task: a stage-loop length search (route the best combos, then re-pick the stages by the routed length
  until one lands within 20 %); then the owner drives a Fun loop from home.

## Session 2026-11-04 (late): best roads never a neighbourhood; developer Satellite layer (claude/best-roads-satellite)

- [x] Best roads nearby: a neighbourhood street (fun_route.js `streetSample`: residential/living/service class in built-up
  frontage; class alone never) never makes a stage from our tiles, nor a destination-only edge; a stage's dead-end end is
  cut back to the last junction unless the dead-end run is 2 km+ of good road (`OUT_BACK_KM`, out-and-back roads stay). The map's stages (used where our tiles find none) are marked `notRoad` by
  `rescoreStages` when the context shows a street or our tiles score them under 0.45; the list skips them and anything
  unchecked. Root cause and checks: ROUTING.md "Explore". Tests: test_graph_router.py (synthetic + real tiles at Devou
  Park and Mount Airy Forest, fixtures tests/fixtures/best_roads).
- [x] Developers: `/api/me` `developer: true` for the owner (OWNER_EMAIL) and the co-developer's fingerprint
  (backend/src/developers.ts, + var DEV_FINGERPRINTS); no migration. Layers → Satellite (USGS The National Map
  orthoimagery) only then; tests backend/test/developers.test.ts, tests/test_developers.py, e2e "satellite: ...".
- Open: outside our tiles (or own routing off) a neighbourhood is unknown when the live stage context (router edges in
  1.2 s) comes back partial, and can still be listed. On a 144-start scan of the bundled tiles our search lists 281 stages instead of 293: dead-end spurs are cut off
  (some through stages fall under 2 km and go); out-and-back roads of 2 km+ (Cook, Mudlick, Second Creek) stay.
- Exact next task: the owner checks Best roads nearby at home and Layers → Satellite on TestFlight; if @fish5spd has no
  switch, OWNER_TODO's DEV_FINGERPRINTS row.

## Session 2026-11-05 (night): own routing, the speed round (claude/own-routing-fast)

- [x] Final card on the tile ranking + background refresh; Explore from tiles; via-way restrictions; first route from
  the straight-line tiles; compressed tiles; preload yields to plans. Preview table in OWN_ROUTING.md §8.
- Open: final card under 1 s warm in 5/10, cold 1.8-4.8 s (the preload's 17 MB competes on a first visit).
- Exact next task: smaller first tiles (the region branch's per-tile Worker relay), or a preload of only the user's tile
  before the rest; then merge claude/own-routing-region when it lands.

## Session 2026-11-05 (later): own routing on v2 tiles, profiled

- [x] v2 tiles merged and mapped (route_ctx/graph.js); 10/10 live picks at least as good as production; warm ranked
  0.8-1.5 s, warm first 0.29-0.55 s (OWN_ROUTING.md §8).
- Open: warm first route 20-70 ms slower than cold in 4 of 10 runs (worker's first answer later in a warm session).
- Exact next task: find the warm worker's 70-90 ms first answer; then a real drive on owner1 at Fun.

## Session 2026-11-05: own routing, faster (merged main through #297)

- [x] First route = our quickest from the worker (0.35-1.05 s); ranking on tile scores + time-dependent providers
  (route_ctx/graph.js); warm tiles at start. Table in OWN_ROUTING.md §8.
- Open: ranked route 1.2-1.8 s warm (target 1.5); subdivision fun pick worse on full data (ETL lacks router density /
  driveways).
- Exact next task: graph builder bakes router-like density, sidewalks and driveways (or a per-edge side-street share)
  into the tiles; then re-run live2/run_own.js and judge.js.

## Session 2026-11-04 (night): own routing on the real Cincinnati tiles

- [x] Merged the 16 Cincinnati tiles (claude/own-routing-graph 2ff318b). Live comparison on the 7 cases plus owner1 at
  three levels: our router produced every winner, at least as good as production's on the engine's value except
  subdivision4 (the same route, scored at a different hour). Table in OWN_ROUTING.md §8.
- [x] Objective `t x exp(a x bad)`, corners-led goodness, one clock with Valhalla, members' data in the search.
- Gaps: via-way restrictions (not in the tiles), Explore on Valhalla, plan time still the context's ~4-7 s.
- Exact next task: the owner drives owner1 at Fun; then a via-way table in the tile format (graph builder).

## Session 2026-11-04 (evening): own routing, the phone's router (branch claude/own-routing-router)

- [x] web/graph_router.js (edge-based A*, turn restrictions, one-ways, U-turns at dead ends only, turn and node costs,
  Quick / Fun / Max with the goodness weight bisected to the level budget, 2 alternates 30 % different, loops),
  web/graph_worker.js, web/own_routing.js, the planner glue in cockpit.js (funRoute, buildLoop), the `own_routing`
  flag. Merged the codec branch (claude/own-routing-graph: web/graph_tiles.js, tools/graph_etl/tiles.py).
- [x] tests/test_graph_router.py (A* = brute-force Dijkstra on 720 random queries, rules, budgets, alternates,
  determinism, the worker on .vgr tiles from the real writer, client fallback, glue, performance), two e2e flows.
  Performance (node, 16 tiles, 179k edges): a search 2-90 ms, a whole Fun plan 90-550 ms.
- Not done: the live comparison with production on the 7 cases waits for the real Cincinnati tiles (the ETL branch has
  only the codec so far); Explore stays on Valhalla; corners split across edge joins aren't scored by the router yet.
- Exact next task: when web/data/graph/v1 has the Cincinnati tiles, serve locally and run the live harness
  (scratchpad live2/run.js with BASE=) on the 7 cases; tune `K` in graph_router.js on what it finds.

## Session 2026-11-04: own routing for OH+KY+IN on the free tier (branch claude/own-routing-region)

- [x] Region tiles on the `graph-data` branch (graph-region.yml), relayed by the Worker (backend/src/graph.ts,
  /api/graph/v1/), loaded by web/graph_tiles.js (shipped, IndexedDB, Worker; union index; prefetchArea from Save area);
  format v3 via-way restrictions.
- Region: OH+KY+IN built by .github/workflows/graph-region.yml (6 bands in parallel, 1 h 42 min) and
  committed to the `graph-data` branch (ba6787a): 584 tiles, 228.9 MB (largest 4.5 MB), 5.26 M edges, 2.15 M nodes,
  build 2026-45-95960e6d; 1,211 via-way restrictions applied (1,504 through undrivable crossovers). The preview Worker
  serves them (/api/graph/v1/388_519.vgr, Columbus: 2.9 MB, decodes, 69,058 edges). Not yet: the Cache API is a no-op
  on workers.dev, so each tile request goes to raw GitHub until the Worker has a custom domain; the context grid
  covers only Cincinnati, so outside it those channels are unknown; the shipped Cincinnati tiles are an older build
  than the region's, so the phone uses the region's there until both are rebuilt together.
- [x] Region grid: the context grid for OH+KY+IN on graph-data ctx/v1 (ctx-region.yml, 6 shards, 32 min):
  33 bundles, 35.6 MB, 1.46 M HPMS road spans, 13,574 fatal crashes; served at /api/ctx/v1/ (KV first, then the branch).
  The region graph was rebuilt with it (build 2026-45-95960e6d-gebab6b, 584 tiles, 228.9 MB; Columbus tile 388_519:
  known share of the model's weight 0.65 -> 0.76), and the shipped Cincinnati set is that build's 16 tiles (17.4 MB),
  committed by the workflow. The relay asks raw GitHub with Cloudflare's subrequest cache (a week, keyed by build);
  timed on the preview, repeats were 0.3-0.8 s against 0.6-1.0 s first, too noisy from here to call a cache hit.
- Exact next task: merge main once #299 lands; a custom domain for the Worker (the Cache API works there);
  re-run ctx-region.yml / graph-region.yml (edit tools/ctx_etl/REGION_BUILD, tools/graph_etl/REGION_BUILD) weekly.

## Session 2026-11-04: own routing, the road-network half (branch claude/own-routing-graph)

- [x] docs/OWN_ROUTING.md (the plan and contract) committed; §4 "As built" has the exact tile interface, §8 the status.
- [x] Tile codec v1: tools/graph_etl/tiles.py (writer + reader), web/graph_tiles.js (`ApexGraphTiles.decode`, `load`),
  tests/test_graph_tiles.py round-trips through both.
- [x] Graph ETL (tools/graph_etl): pyosmium reader, chains, oneways, access, via-node restrictions, barriers, point
  features, joins, businesses (40 m, no fuel/cafes), buildings, land use, water, road density; score_edges.js scores
  each edge with web/route_engine.js + fun_route.js + dem.js + context_grid.js (no second model). tests/test_graph_etl.py
  on a toy network and a real Colerain Township piece (tests/fixtures/graph, from the OSM API).
- [x] CI .github/workflows/graph.yml: Geofabrik OH+KY+IN, merged, Cincinnati's 16 tiles committed back to the branch;
  region build as an artifact, R2 upload gated on the owner's secrets (OWNER_TODO).
- Cincinnati tiles (CI, Geofabrik 2026-11-04): 16 tiles, 14.63 MB, 400,913 edges, 173,598 nodes, 4,225 turn
  restrictions applied (2,273 skipped: via node outside the tiles or a removed lot lane; 259 via-way not applied).
  Spot checks (web/data/graph/v1/CHECK.txt): Colerain Ave quality 0.25, Blue Rock Rd (north of I-275) 0.68, E Miami
  River Rd 0.72, Lees Creek Rd 0.58, I-275 motorway 0.82 at 109 km/h. Local e2e: one reroute flow failed under load
  (the known flake), unrelated (no page script changed).
- [x] Tiles v2: side-street evidence per edge in the tiles (`edges.ch`); 17.44 MB for the 16 tiles. Spot checks:
  Colerain Ave 0.22, Springdale Rd east of -84.62 0.32 (was 0.39), Hamilton Ave 0.21 (0.24), Pippin Rd 0.33 (0.42; the
  live engine also 0.33), Blue Rock rural 0.68, E Miami River 0.72, Lees Creek 0.58, I-275 0.82.
- Exact next task: the phone router (web/graph_router.js + graph_worker.js) on these tiles (the parallel builder), then
  OWN_ROUTING.md §6's proof against today's picks.
## Session 2026-11-04 (evening): the plan flow, simpler (branch claude/plan-flow)

- [x] The planux audit's eleven findings are fixed (CALL_SHEET 2026-11-04 evening has each call and how to undo it):
  - the card shows progress, then says "Better route found: +N min, M more corners", or that it kept the first route;
  - Start is the card's pinned foot, the profile's space is kept, and a re-plan keeps the scroll;
  - the main key follows the task;
  - the level lives only on the route card, and switching re-ranks the routes already found;
  - loops have a level and a length in your units;
  - one Options sheet with chips that show what is on;
  - Best roads nearby is a chip with a list sheet whose columns are named;
  - one name for go: Start / Just drive / Fly-through;
  - plain words (vocabulary.js);
  - the card opens at half height and drags to full;
  - swipe the card for the alternatives.
- [x] New e2e journeys "plan flow (a)–(g)" at iPhone 15 geometry. They count taps (destination 3, loop 2, best roads
  nearby 3, level 1, alternative 1 swipe), track Start's y over time, check the swap line, the option chips, and the
  safe-area/overlap scanner. Old flows that tested More, Drive it or Preview now test the new path for the same
  capability.
- Unverified: the half-height drag and the sideways swipe on a real phone (headless touch only). UITests string changes
  (Swift; CI compiles). The re-rank on live data: it uses the engine's own ranking of the pool kept from the plan.
- Known: on the website in headless Chromium, the fresh GPS fix for a re-plan sometimes fails. It now falls back to the
  last known position.
- Exact next task: the owner tries the plan flow on TestFlight (half card, Options, Best roads nearby). Then a real
  drive with the engine, and recording 8 / panel round 3.

## Session 2026-11-04: owner notes through #290; route engine being integrated

- [x] #286-#290: convoy line behind the car (@fish5spd), car-specific themes with any voice pack and red needles,
  End undo 1.7 s, a granted theme from a newer server falls back to a known renderer (#289), the drive page map zooms a
  little out and freely in, menu sheets swipe down to close, feedback runs print the build number.
- [x] e2e can run in WebKit (`BROWSER=webkit`), the app's own engine.
- Deploy note: Workers Builds did not start a production build for #290's merge (no check on 6885631 after 35 min;
  earlier merges all built). The next merge to main deploys it; verify by curling `cockpit.js` for `SWIPE_CLOSE_PX`.
- [x] Route engine merged in this PR (was: in progress). Route intelligence: one route engine scoring every 25 m for road quality (speed limit, class, signals,
  driveways, businesses, density, land use) and scenery, with time-dependent penalties and hard constraints, fed by five
  data families (router edges + DEM, OSM tiles/Overpass, national context grid, time/world, driver/crowd/car). Branches
  are being merged into the engine branch; calibrated on four real Cincinnati route choices. Flowchart:
  docs/ROUTE_ENGINE.md (lands with the engine PR).
- Local e2e flakes under heavy machine load ("Where to?" suggestion, "car map glides"); green in CI. Re-check idle.
- Unverified: Swift (ApexContext for calendar/album; CI compiles), the engine on a real drive, the Kentucky relay live.
- [x] Route engine fixed on the live network (#293): live checks on five real trips pick the expected roads; planning
  4.4-6.6 s. tests/test_route_engine_live.py holds the live captures. Still slow-ish: first route 1.3-2.4 s (target 1.5).
- [x] Route engine faster (stages in a Web Worker, parallel plans): live 3.1-6.9 s, first route 0.85-1.73 s.
- Exact next task: a real drive with the engine (owner), the wider-region context grid once its storage is set up, then
  recording 8 / panel round 3.

## Session 2026-11-03 (later): road data, tester feedback, private themes (#285)

- [x] Road data reaches the map (line and class uploaded; 187 roads backfilled from OSM), no placeholder camber (all
  three twins, `cam_v` 2, server ignores camber from older builds; production camber cleared, backup table kept).
- [x] Tester feedback: detour reroutes once and forward, Lower/Pause music while Vetta speaks, seamless reroute.
- [x] Private themes Tiburon and FR-S (theme_grants, 0044, applied; granted to natesenft and fish5spd).
- [x] Feedback runs hourly; @fish5spd's notes are followed (#284).
- Unverified: all Swift (CI compiles it), the music pause on a device, the themes on CarPlay.
- Open: R2 for photos (owner turns it on; R2 needs enabling in the dashboard), the Sign in with Apple key, the public
  TestFlight link (Claude submits once the key is in and the contact email is chosen).
- Exact next task: recording 8, then panel round 3 (carry-overs below).

## Session 2026-11-03: panel round 2 built (20 reviewers across four models)

- [x] Twenty reviewers (docs/design/PANEL.md round 2) reviewed recording 7, and the vote is in
  docs/design/panel/round-2/VOTE.md. Built:
  - one red that means act now;
  - one vocabulary and one set of numbers;
  - road feel shown, never a false +0.0°;
  - the end card's road portrait and share card;
  - roads drawn before driving;
  - share the road, not the drive;
  - the position beacon removed;
  - quiet means quiet, chimes, the asides playing;
  - explain behind a tap;
  - Dynamic Type on the drive pages;
  - VoiceOver;
  - idle sensors off;
  - the rig's four flows fixed.
  CALL_SHEET 2026-11-03 has the calls.
- Unverified: all Swift (CI), VoiceOver and Dynamic Type on a device, the sensor stack's battery effect.
- Exact next task: recording 8, then panel round 3. Carry over:
  - the crew drive with people (RA-1);
  - a usability lab (SO-3, NA-1);
  - the lock screen as the road book (TH-1);
  - a trip pack (DE-2);
  - IN-2 large cockpit;
  - SO-2 two Start keys.

## Session 2026-11-02: the panel (docs/design/PANEL.md), round 1 built

- [x] Six reviewer characters (Dani, Margo, Theo, Priya, Ray, Ines) reviewed recording 6 and voted
  (docs/design/panel/round-1/). The winners are built:
  - your roads, Drive it again, the Sunday suggestion and an opt-in weekly reminder;
  - the car card's glance form;
  - End with Undo;
  - the call grammar and one notation;
  - the app coming back whole after a replay or drive;
  - crew links showing the welcome first;
  - the recording rig's fixes.
  CALL_SHEET 2026-11-02 lists the calls.
- Unverified: Swift (CI compiles it), the reminder on a device, the rig changes (the next recording proves them).
- Exact next task: panel round 2. Record on main, then the same six review it and vote. Carry over: P-3 as a tap-to-learn
  instead, I-1 checked side by side, and R-4's seeded social world.

## Session 2026-11-01: design skills installed; Fable review 5; all 32 findings built

- [x] Skills in `.claude/skills` (Impeccable, Intent, 18 Swift iOS skills, ios-code-audit, swift-security-expert,
  swiftui-pro), #278. Recording 5 (app-review run 41286687159, all 8 flows) and docs/design/REVIEW5.md, #279.
- [x] All 32 findings U-106..U-137 built by five parallel builders and merged:
  - strip grammar, including landscape (the P0);
  - a bounded forecast;
  - one coaching sentence;
  - per-voice words, with 42 new Kokoro clips;
  - CarPlay short instructions;
  - the replay's end;
  - the Garage behind one gear;
  - People example rows;
  - the REVIEW5 §7 recording fixes.
  CALL_SHEET 2026-11-01 lists every call.
- Unverified on a device or Mac: all Swift (CI compiles it), the recording changes (the next app-review run proves them),
  the new clips on a phone, the landscape strip on a real phone.
- Known gap: with plain words on (the default), calls are spoken by the phone's voice and only asides are in the pack
  voice; rendering plain-words calls per pack is the follow-up if the owner wants it.
- Exact next task: recording 6 (app-review.yml on main) to check review 5 on video, then Fable stage 2
  (REVIEW5_CHECK.md) if the owner asks.

## Session 2026-10-31: TestFlight notes 09, 10 and the video (one of three feedback builders)

- [x] 09 a stage is marked on the drive's map (circled), from a whole road you drove (road keys from map matching) or
  Start/Finish sliders; 10 "Which route was better?" with a map of each route; Make the video fixed for the iOS web view
  (the dashcam video never loaded), both video keys hidden where recording can't work. CALL_SHEET 2026-10-31.
- Unverified on a device: both videos in the app's WKWebView (MediaRecorder + canvas captureStream), the road keys on a
  real drive (Valhalla's names).
- Exact next task: TestFlight from main; the owner tries Make the video and a Bank Road stage.
## Session 2026-10-31: TestFlight notes 05 and 06 (feedback builder)

- [x] 05: the Crew drives row is gone; the crew page's "Upcoming drives" lists the crew's drives with a + to plan one.
- [x] 06: the crew Score board shows faces and Week / Month / Year / All time, ranked by the total of drive Scores
  (`GET /api/crews/:id/board`, `POST /api/drives/scores`, backend/src/drive_scores.ts). Old builds keep the page's `board`.
- Migration 0043 (drive_scores) is NOT applied yet: apply it to apexnav-preview-db and apexnav-db before the Worker deploy
  (until then the new board says "Couldn't load the board" and drive Scores wait on the phone to be sent).
- Exact next task: apply 0043; on a device, check a finished drive shows on the crew board's Week total.
## Session 2026-10-31: TestFlight feedback 01-04, 07, 08 (screens and sharing)

- [x] A route Preview owns the screen like a replay (no route card or tabs under it); Where to? stays below the Dynamic
  Island with the keyboard up; written fields centred top to bottom and growing; menus are bottom sheets over a modal
  scrim (tap outside closes); every invite/share opens the real share sheet (`shareText` bridge); no crew image card.
- Unverified on a device: the `shareText` share sheet (CI compiles the Swift), the island gap on a real Dynamic Island.
- Exact next task: TestFlight from main, then the owner's next round of notes.

## Session 2026-10-30 (evening): REVIEW_PEOPLE.md and REVIEW_FEEL.md built (PR #267)

- [x] All 35 People findings (P-01..P-35), open sign-up, two tabs; all 18 speed findings (F-01..F-18) incl. the native
  CarPlay map (MapLibre Native) and dead reckoning; the CarPlay guidance card at the top (bar hides in guidance).
- [x] Migrations 0041 (crew_event_attendance) and 0042 (crews.invites) applied to apexnav-db and apexnav-preview-db.
- Unverified on a device: the native car map, dead reckoning, the guidance card position, every speed number (Chromium
  4x rig only). CI compiles the Swift.
- Exact next task: TestFlight from main; the second speed review (Fable, REVIEW_FEEL_2.md) on the new build; then a
  real drive.

## Session 2026-10-30 (day): fixes from the owner's first real drive with CarPlay

- [x] Drives started on CarPlay always saved (checkpoints, native drive journal, end on disconnect/park, recovery).
- [x] Turn-by-turn in road order (one tracked turn, a prompt ladder said once, no corner before the junction's call).
- [x] Car map glides between fixes; dedupe; no contours in the car; not throttled when locked.
- [x] Phone performance (no idle redraws, change-only DOM writes, fonts non-blocking).
- [x] Crew tab is People with Friends | Crews (the owner's choice).
- Unverified on a device: all of the above needs the owner's next drive (a fresh TestFlight build); Swift compiles in CI.
- Exact next task: a TestFlight build from main for the owner; then confirm on a real drive; then REVIEW3.md Roadmap 3.

## Session 2026-10-30 (overnight): Fable review 4, both stages, built

- [x] The owner tuned and approved the Fable prompts (docs/design/REVIEW4_PROMPT.md: the critic's role, the standard).
- [x] Stage 1 (docs/design/REVIEW4.md, U-58 to U-89): all 32 built in #261 (co-driver wakes on the road, the car in
  every drive, steady sight plate, route times, Live Activity words, the welcome in the app, planning and end card,
  the recording). #262 and #263 fixed the recording itself (the location sheet the welcome brings up, >99 steps, flows
  start past the welcome).
- [x] Stage 2 (docs/design/REVIEW4_CHECK.md): 26/32 fixed, 4 partly, 1 not, 1 can't tell; 16 new (U-90 to U-105), all
  built in the stage 2 PR (route that doubles back, one score, fitted forecast, island words, status-line messages,
  end-card map, recording never writes real data). CALL_SHEET "Review 4, stage 2" has every call.
- [x] The recording's test hazard was deleted from production (BACKUPS.md).
- Active bugs: none known. Unverified on a device: the free-drive car strip with a negative distance (U-95), the
  launch handoff (U-80), real-WebKit fonts for the strip clamps (U-92).
- Exact next task: a third recording (app-review.yml, on demand) to confirm stage 2 on video, especially U-90 on the
  Dry Ridge loop-back and U-86 at the billet standstill; then REVIEW3.md Roadmap 3 items 1, 2, 4-9.

## Session 2026-10-30: Tapedeck readout, the review recording, CarPlay by XCUITest

- [x] #259 Tapedeck's digital readout compacted on the phone (it took most of the screen in a drive).
- [x] #260 CarPlay screenshots by XCUITest (UITests/CarPlayTests: the car's home screen and templates found by label,
  XCUIScreen.screens[1] photographed); clicks from the Mac never reached the car. Debug builds replay the real drive
  (`ApexReplay`, dry_ridge) through the shell's sensor handlers; the review recording (app-review.yml, ON DEMAND ONLY,
  docs/REVIEW_RECORDING.md) runs eight flows on the phone and car with video, photos and a transcript of every line said,
  packed by tools/review_pack.py. Car run 6 showed guidance on the replayed road; fixed on the way: a loop or GPX route
  had no car guidance (guideMessage needed steps), and the trip strip sat at "0 min · -- mi" (now the miles left, time
  "--" when no router time).
- [x] The review account `@vetta_review` (member, Share road feel off, no Google login, one 365-day session); its token
  goes in the `REVIEW_SESSION` secret, which the owner adds (OWNER_TODO).
- **The Fable review waits for the owner**: record the pack, then draft the Fable prompt WITH the owner; never run Fable
  on it until the owner says go.
- Active bugs: none known. Unverified: the trip strip's "--" time on a real car (from Apple's header).
- Exact next task: once #260 is on main, dispatch app-review.yml, check the review-pack covers every flow and fix what
  the recording shows broken, then draft the Fable prompt for the owner. Then REVIEW3.md Roadmap 3 items 1, 2, 4-9.

## Session 2026-10-29 (late): CarPlay, then the owner's first-drive fixes

- [x] #254 the promise ("no personal data sold") and every theme open until the App Store release; #255 the CarPlay
  entitlement in every build (granted the same day; TestFlight signed and uploaded).
- [x] #256 CarPlay rebuilt to the mockups (docs/design/carplay): the engine runs without the phone's window (ApexEngine),
  the voice pack plays natively in the car (ApexClipPlayer), our themed map in the base view (web/carmap.html,
  web/basemap.js), tulip maneuvers on the theme's card, Where to?, Loops, Places, Report, Still there, mute, the
  Dashboard and the instrument cluster.
- [x] This branch: every corner on the car's guidance card, interleaved with turns (`CAR_CORNERS`, fallback 'tight');
  switches that read on and off (fill plus an I/O mark); press feedback on iOS (web/press.js); units and app sign-in
  without a reload; the Log's tabs go back to the map (web/page_return.js); Live Activities end with the drive, at
  launch and at quit, and go stale after two minutes. e2e: the units flow checks there is no reload; a new flow checks
  the Log's tabs go back and the switch's two states differ.
- [x] Follow-up (the owner: "the crew page still does a full reload every time"; "sightline speed as part of the current
  location marker"): the Log and Stages open in a frame over the map (openLog, web/page_return.js), so the map page never
  reloads from the Log's tabs and a drive and the car keep running behind it; the sight-line speed rides under the
  position arrow on the phone and the car (sightMessage, paintSight, carmap drawSight). e2e flows for both.
- [x] From the owner's photos of build 498.1 in the car: tulips drawn synchronously (they never reached the card),
  distances in the driver's units, a loop's start no longer matched to its end, the trip card without repeats, plates
  decluttered with the car above them.
- [x] The car map edge to edge at the car's own scale (it stopped at the map buttons, and was laid out at the phone's
  width and scaled up); the app opens with no route (the planned route lasts the session only).
- [x] The owner's account has the full crew livery (livery_grants, migration 0040, applied to both databases); only a
  route being driven survives a close (a planned one lasts the session); a drive start clears any open sheet or the Log.
- [x] From phone photos: convoy bar one line idle, calls only in a drive (one scrolling row), `wss://` in the CSP for the
  convoy socket (unverified on the phone: "Reconnecting…"); Tapedeck without ghost 8s, the Trip key or a lone Road row in a
  drive; no destination pin on a loop; the plan sheet closes on drive start.
- [x] Cameras: web/cameras.js loads by tile (only the route's), races the three Overpass servers, keeps tiles a week;
  speed cameras from OSM join the plate readers. Paid camera data is an owner decision (OWNER_TODO); Waze is out.
- Answered for the owner: the UI is a WKWebView; the IMU and GPS run with the phone locked once CarPlay starts the engine,
  but location and motion permission must have been granted once on the phone.
- Active bugs: none known. Unverified on a device: the Log frame's native calls through the map page's bridge (Save/Share, signed-in
  calls from the Log), and how App Review reads corners as maneuvers.
- Exact next task: run the carplay-shots workflow to see the real car screen, then REVIEW3.md Roadmap 3 from item 1
  (stash@{0} in the old session holds a half-built version; rebuild it on main) and items 2, 4-9.

## Session 2026-10-29 (night): design review 3, fixed in the branch

- [x] docs/design/REVIEW3.md (Fable, with the code): the verdict against each principle, 40 screens judged on three
  phone shapes with real fonts, a code-level section, IDEAS U-47 to U-57, Roadmap 3. Screenshots in docs/design/screens-v3.
- [x] Fixed in the review's own commits: Plan a drive on the app's controls (row lists, a 30-day strip, a time stepper,
  slide switches; STATE's first active bug); every other select, checkbox and system prompt the app drew (Add a step,
  the car form, the report sheet, the livery editor, Feedback, Pin place, presets, zones, Tried it, DELETE) replaced
  by row lists, slide switches and `ApexConfirm.prompt`; the friend-label edge collision (STATE's second bug); the
  "Finding GPS…" Tapedeck still (STATE's third: the tour's, not the app's); the lead call's cut modifiers; Tapedeck's
  meters over Sight on a 15 Pro; the dial's end labels under the numeral; duplicate headings in the crew pops; red
  where it was not record or destructive; emoji stripped from chat and build replies (U-46, tested).
- Active bugs: none new. Open from the review: Roadmap 3 (the Garage's settings behind rows, fonts in the bundle, the
  "No subscription" promise for the owner, the café glyph, the mockups' motion).
- Exact next task: REVIEW3.md Roadmap 3 from item 1 (U-49, the Garage's settings as rows that open side pops), then
  item 2 (U-47, bundle the fonts). U-48 waits on the owner's words.

## Session 2026-10-29 (evening): Roadmap 2 complete

- [x] docs/design/REVIEW2.md Roadmap 2, items 1-20, each its own PR (the last four: #248 replay controls, #249 Kit,
  #250 night as a mode, and this one). Every IDEAS row it names (U-23 to U-46) is done except U-18 and U-33 (partial, below).
  - Replay: one Play slide switch, a 1x 2x 4x 8x speed detent, the elevation strip as a full-width scrubber, no tab bar
    (the Replay plate is the exit). Tapedeck's bar meters keep their height and get their own row on small phones and
    on its side (they overprinted the controls, and Sight on an SE).
  - Kit at 80 px on a 16 x 14 grid with two idle frames and four lean frames; KIT SAYS wraps to two lines.
  - Night as a mode: a 46 px speed numeral, Limit and Sight in a row (Limit over Sight on an SE, day and night), the
    trip behind a Trip key for ten seconds.
  - tools/app_tour.js saves review stills (OUT/stills) of the five surfaces REVIEW2 could not judge: a routed mountain
    road with corners and alternatives, two friends and a home zone, Plan a drive open, the crew board and chat,
    Tapedeck on a live drive. All data is stubbed in the script, never in the app.
- [x] The three defects the stills found: Plan a drive now uses row pickers, day and time steppers and slide switches;
  a friend's label near the right edge flips to the face's left; "Finding GPS..." was the tour scene (it now starts a
  drive as the shell does and reads "Rec").
- Active bugs: none known. U-33 (partial): Crews near you and Spots near you still explain in a line. U-18 (partial):
  the rest of the browser controls named in its row.
- Exact next task: act on Fable's third review (docs/design/REVIEW3.md), a codebase-wide pass with edit access.

## Session 2026-10-29 (day): design phase 2

- [x] REVIEW.md roadmap 9-14: four tabs (Map, Log, Crew, Garage; Stages a Log segment; Settings, you, cars and account in
  the Garage; help folds under "How this works"); the Layers key; night as a mode; the theme contract
  (web/theme_contract.js, renderers in themes.js and instruments.js `register`, an e2e flow on the rendered page); the
  Log (hero score, quiet lines, road-book index); the drive page (score first, Replay primary, tag row, g-ball grip).
- Exact next task: REVIEW.md 1.2 screen items not in the roadmap (cockpit idle place plate and suggested loop, one-tap
  hazard report with undo, crew signed-out line, empty states), then phase 3 item 15 (theme picker).

## Session 2026-10-29 (day): design phase 1

- [x] REVIEW.md roadmap 1-8: driving full-screen (no tab bar, one status line, End); the hazard plate (fixed tokens
  `--hz-*`, top-left of the map for the nearest reported hazard ahead, pins, report sheet, the strip); the call lockup;
  shaped controls (web/controls.css: switch, detents, stamps, the record key); the route card as instruments
  (web/route_card.js); the plan sheet's basic level and More with presets (web/plan_presets.js); the drive-ended card;
  Look/Octane and onboarding steps 2-3 removed.
- Exact next task: REVIEW.md phase 2, item 9 (four tabs: Map, Log, Crew, Garage; Stages into Log; Settings under Garage).

## Session 2026-10-29 (morning): design review, Vetta Score

- [x] Design review by a design agent (Fable) from 54 screenshots: docs/design/ (REVIEW.md, 12 HTML mockups with PNG
  renders, the brief, the screenshots, the mockup generator). The owner approved the direction.
- [x] The score is the Vetta Score in every visible place; the "How Score works" note and formula lines are gone; About's
  first promise is "No races". Calls logged in docs/CALL_SHEET.md.
- Active bugs: none new. Still open: CarPlay cold launch, CarPlay screenshots need Xcode on a Mac.
- Exact next task: docs/design/REVIEW.md roadmap phase 1 (control shapes, the plan sheet split into basic and More, the
  driving screen without the tab bar and with the fixed hazard plate), then P-03 and U-15.

## Session 2026-10-29 (early hours): keyboard, Sight, CarPlay screens, lanes
- Merged #229 (CarPlay app, single-pass roads, road export; migration 0029 applied to both D1), #230 (keyboard fix in the app: the shell reports the keyboard height and undoes WKWebView's pan, checked on the simulator's real keyboard by AppTourTests.testKeyboard; Sight cell; opening cover; launch colours; docs/LAUNCH.md; docs/CALL_SHEET.md), #231 (carplay-shots workflow), #232 (R-29 lane guidance).
- Owner rule: make the calls and log them at the top of docs/CALL_SHEET.md (CLAUDE.md item 6).
- Sight = the old road speed (stop within what you can see, no faster than the corner), uncapped, "Open" at the 400 m sight cap; alert-driver inputs kept and sourced in ROAD_INTELLIGENCE.
- CarPlay: the simulator's CarPlay display shows Vetta's icon on GitHub's Mac, but the runner ignores synthetic clicks; the entitlement-form screenshots need 10 minutes in Xcode (CALL_SHEET).
- Open: CarPlay cold launch (route engine without the phone's window scene); testKeyboard covers Map and Settings only (Log, Stages, Crew have no fields signed out).
- Exact next task: IDEAS P-03 (split index.html into modules), then U-15 (VoiceOver and Dynamic Type pass on the simulator, a testAccessibility in AppTourTests).

## Session 2026-10-28 (night): app review, Vetta, CarPlay
- Merged #228: recorded app tour (tools/app_tour.js with the co-driver's audio and captions; app-tour workflow with a simulator video and AppTourTests.testKeyboard over every text field), web/keyboard.js (owner's screenshots), 14 review fixes (docs/REVIEW.md), the Vetta name, MONETIZATION.md rewritten (free forever; Pro monthly/yearly/lifetime; founders; earned Pro; road-data framework).
- This PR (#229): CarPlay navigation app (CarPlay/ApexCarPlay.swift + web/carplay.js; entitlement only in simulator builds), single-pass roads (migration 0029 `road_ways.cls/len_m`: apply to both D1 when merged), owner-only road GeoJSON export (docs/ROAD_DATA.md), more review fixes.
- Open: the app-tour workflow's keyboard screenshots and simulator video to review; CarPlay cold launch (route engine without the phone's window scene); owner sign-off on Pro prices; owner trademark knockout for VETTA and the App Store name.
- Exact next task: review the app-tour artifact and fix what testKeyboard finds; CarPlay screenshots from the simulator for the entitlement form; then IDEAS (R-29 lane guidance, P-03 split index.html).

## Session 2026-10-28 (evening): CarPlay request readiness, naming
- This PR: CarPlay pre-request work from Apple's CarPlay Developer Guide (Oct 2026): voice prompts check `promptStyle` (native speech, and web clips ask the shell first; a generated tone for `short`), the App Store listing leads with navigation, docs/CARPLAY.md (form answers, requirement table, build plan).
- On hold, reverted from this branch: Pro entitlement server code (commit f670035; `git revert` of the revert brings it back) while the owner decides the free/paid split; MONETIZATION.md is to be rewritten for free forever + Pro subscription + lifetime, with a road-data business framework (owner approved the direction).
- Naming: owner wants a real foreign word; Vetta (Italian: summit) is the front runner (USPTO: no live marks in classes 9/42; vettadrive.com free). Single-pass roads to be scored with confidence weighting (owner approved; not built yet).
- Exact next task: after the owner submits the CarPlay request, the rename decision, then the MONETIZATION.md rewrite and the single-pass weighting.

## Session 2026-10-28 (afternoon): monetization and marketing plans
- Merged #224: D-11 dashcam overlay, P-01 battery cost, Q-07 road-data loop test, S-18 spot photos, A-02 browser mount calibration, R-04 measured stages.
- Owner switched focus (2026-10-28): monetization that keeps users first, and a marketing plan Claude runs; then back to IDEAS.
- This PR: docs/MONETIZATION.md (free app + one-time Pro, trial, tip jar, founding drivers keep Pro; L-02), docs/MARKETING.md (channels, launch region, timeline, how it runs autonomously, guardrails; L-06), drafts in docs/marketing/, owner asks at the top of OWNER_TODO.
- Exact next task: build the Pro plumbing behind the `pro` flag (off): server entitlement + JWS verification, StoreKit 2 in the shell, web/pro.js gates with the rule tests (MONETIZATION §6). Then road pages for search (MARKETING channel 1) and the road-of-the-week renderer. Products in App Store Connect wait on the owner's Paid Applications Agreement.

## Session 2026-10-28 (midday)
- Merged through #207: Q-09 sight offsets, Y-17 route latency, review fixes (migrations 0021–0022 applied to both D1).
- Merged #208: R-21 forecast costs in fun-route ranking (difference from the driest, all-or-nothing), R-22 "Route around it" for conditional closures (exclude_locations).
- Merged #209 Q-14 coverage map (migration 0023 `road_ways`; privacy page says the road's public map line is sent).
- This PR: R-12 set list, R-20 car-aware routing (migration 0024 cars.clearance/width_cm applied to both D1).
- #210 also: Z-11 Content-Security-Policy on every page (tools/csp.py; rerun it after editing an inline script, CLAUDE.md says so).
- Merged #215 also: Q-04 crowd curvature (migration 0027 applied), Q-03 asked of the owner, R-35 speed traps and S-07 comments dropped with reasons.
- This PR: A-02 browser mount calibration (web/live_pipeline.js + GPS cross-check); S-18 spot photos (web/spot_photos.js, EXIF removed, phone only; NSCameraUsageDescription); D-11 dashcam overlay (web/dashcam.js); blocked IDEAS rows marked owner/parked; P-01 battery cost per drive (web/battery_budget.js, iOS frames carry battery/charging); Q-07 road-data loop test (backend/test/loop.test.ts).
- Merged #223: F-02 offline map areas (web/offline_tiles.js, apexc:// protocol, IndexedDB).
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
- Exact next task: remaining IDEAS todo rows (R-29 lane guidance, R-04 measured data in candidate generation, P-03 split index.html); partial rows R-32, Q-13, R-33, F-02, Q-09.

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
- [x] **docs/BACKEND.md**: local-first backend design (Supabase + Google sign-in; invite-only then, open to anyone who signs in since 2026-10-30), points 3x/2x/1x per way+direction,
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
- All-Cloudflare backend (Workers + D1), not Supabase. Google sign-in, invite-only at the time (open since 2026-10-30), US only, under 20 users, all rights reserved.
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
