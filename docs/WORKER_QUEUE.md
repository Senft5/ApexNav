# Work queue

The review loop (docs/LOOP.md) takes `todo` items in order, confirms each is still needed, and
either does it itself (`top`) or delegates it with a short brief to the tier named here
(`fast`, `mid`, `local`; models are listed in docs/LOOP.md). The tier is a starting point; the
loop may change it and escalates a failed attempt one tier. Item numbers refer to
docs/BRAND.md §7. Items 19 and the Jarvis removal in 22 delete owner-visible features and need
the owner's yes first; they are not queued.

Statuses: `todo`, `active`, `merged (#35)`, `dropped (reason)`.

## Priority: routing (owner request 2026-10-26; before any brand item)
Do these in order.
Today `here()` (web/index.html, ROUTING section) uses live GPS only while driving and otherwise
the replay cursor or the **map centre**; Plan has one "Where to" field; off route the cockpit just
shows "Driving · no route loaded" and never reroutes.

| id | tier | status | files | task |
|---|---|---|---|---|
| route-1 | mid | merged (#28) | web/index.html | Plan routes start from the phone's real position. Add `async locate()`: `state.live` if driving, else `navigator.geolocation.getCurrentPosition` (high accuracy, 10 s timeout, maximumAge 30 s). `routeTo`, `searchAndRoute` and Loop use it instead of `here()` (keep `here()` for anything that is not route planning). On failure never fall back to the map centre silently: toast "Couldn't get your location. Type a start or tap the map." and stop. |
| route-2 | mid | merged (#31) | web/index.html | Plan "Where to" becomes From + To. From defaults to "Current location" (uses `locate()`); typing a place there geocodes it with the same Nominatim call; a swap button between the fields; "Or tap the map" fills whichever field was focused last (To by default). Store the request on the track (`t.request = { from, to, via }`, `from: null` = current location) so a reroute can rebuild it. |
| route-3 | top | merged (#30) | web/reroute.js (new), tests/test_reroute.py (new) | Pure off-route state machine, UMD like web/sensors.js, node-tested like tests/test_web_core_parity.py. Per fix input `{t, distToRouteM, accuracyM, speedMps, progressM}`. Off route when `dist > max(40, 2·accuracy)` for 5 s in a row while moving > 2 m/s; back on route under 25 m; also off route when progress along the route falls ≥ 100 m (wrong way). One reroute request per off-route episode; 20 s cooldown; on failure back off 20/40/80 s, capped at 2 min. Tests: GPS jitter at a corner does not trigger; a real turn-off triggers once; rejoining before 5 s cancels; wrong-way triggers; the backoff schedule. |
| route-4 | top | merged (#34) | web/index.html | Top designs the wiring (state, rejoin search, request rebuild) and may hand the UI/voice half to mid. Wire route-3 into live mode: when off route, search the whole route for a rejoin (not only the 600-sample window after `cursorIdx`); on a reroute request rebuild from the current fix to `t.request.to` through the via points still ahead (loops: next unpassed loop waypoint, then the rest of the loop); keep the old route drawn until the new one arrives; voice "Rerouting" and "Back on route"; offline: "Off route · no signal to reroute" and keep the old route. Notes, pace and trip distance stay blank while off route (existing honesty rule). |
| route-5 | mid | merged (#37) | docs/STATE.md | Verify in the browser with a simulated GPS track that leaves and rejoins a route (desktop: replay a recorded drive's fixes into live mode). Real-phone test stays on the owner's list. |

## Brand (docs/BRAND.md §7)

| id | tier | status | files | task |
|---|---|---|---|---|
| brand-21a | local | merged (#23) | web/analysis.html | `.dv-z` zoom buttons 30 → 44 px high, drop their letter-spacing (inputs are already 44 px). First worker job, run by hand to prove the pipeline. |
| brand-21b | local | dropped (already done; stale comment fixed in #23) | web/index.html | Delete `.ink-btn.busy::before` and `@keyframes sweep` (and only the code that exists solely to drive the sweep); keep the busy label and progress bar. `.ink-btn.on` = ink fill, not accent. |
| brand-17 | mid | merged (#26) | web/index.html, web/instruments.js | Pace-note strip text per §7 item 17: `subFor()` returns `R 42 m · 31 mph` for corners, `Driven once` / `Confirmed` for hazards, `Camera` for cameras; the next-note mini tulip drops its repeated code label; Roadbook boxes show the code only when it differs from the call. |
| brand-18 | local | merged (#33) | web/drive_view.js | Corner label collisions per §7 item 18: draw a corner number only if it is ≥ 18 px from every already drawn label, else a 4 px dot; same for the Compare plan map. |
| brand-12 | mid | merged (#36) | web/drive_view.js | Drive summary hierarchy per §7 item 12 (score 44 px with `/1000` and the four part bars under it; one distance · time · corners line; remove Top speed, Peak lateral, Peak braking, Climb tiles from the summary only; hide the scrub readout until the first scrub). |
| brand-24a | local | merged (#38) | web/index.html | Replace inline `style="…"` spacing with `.mt-8`, `.stack-8`, `.stack-12` utilities on the 4 px grid (define them once in the page CSS). Spacing only; no visual change beyond rounding to the grid. |
| brand-24b | local | merged (#35) | web/analysis.html | Same as brand-24a for the analysis page. |
| brand-log | mid | todo | web/analysis.html | §7 items 11, 13, 14 remainder (audit 2026-10-26): drop the Log `<header>` (h1, subtitle, tab row); default view = drives list; Compare tab goes, Compare lives only in "Compare with…" from drive detail (preselect best other drive on the road); `.gain` uses `var(--gain)`; stage rows say runs not passes; "Friends and sync" heading → sharing controls sit with the Board. |
| brand-fix | mid | todo | web/index.html | Small §7 remainders: item 7 "Plan a route · Watch a replay" links under Start drive and live plate "Drive ● Rec"; item 8 denied-state wording ("Location is off. Settings → … → Allow") with Start drive disabled; item 15 inline logo.svg on step 1 and "Watch a replay" loads dry_ridge; item 22 "Speak road names" as a switch with its status line (not Jarvis); item 2 `.key` 15 px / 600; item 21 `.ink-btn.solid` 48 px. |
| brand-6 | mid | todo | web/instruments.js | §7 item 6: dials cluster cells LIMIT (unchanged) + ROAD = min(pace, sight) as the accent number, a 12 px eye glyph when sight < pace; unknown stays `--`; PACE and SIGHT cells go; the binnacle road-type line. |
| brand-5 | mid | todo | web/index.html, web/instruments.js | §7 item 5: switches become Notes (Auto → Full → Quiet), Voice, Cameras; Night Auto/On/Off; Road scores switch per §7. After brand-fix (same file). |
| brand-16 | mid | todo | web/index.html | §7 item 16 remainder: a route card after a build with "Drive it" and "Preview"; Spots note text per §2. After brand-5. |
| brand-9 | mid | todo | web/index.html, web/analysis.html | §7 item 9 remainder: Log/Stages tabs open `analysis.html?tab=log` / `?tab=stages` (analysis.html accepts both, old names still work); Settings plate is a gear glyph with an aria-label; "Replay a drive" leaves Plan. After brand-log and brand-16. |
| brand-25 | mid | todo | web/index.html, web/sync.js, web/analysis.html | §7 item 25 remainder: crew detail with its member list; Board filter chips "Friends / <crew>". After brand-9. |
| brand-1 | mid | todo | web/index.html, web/analysis.html, web/drive_view.js | §7 item 1 remainder: §2 rows 3, 4, 7 ([View] button), 10, 15, 16 verbatim. Last, after the other index/analysis items. |
| brand-23 | top | todo | project.yml, ApexNav assets | §7 item 23 remainder: wire web/brand/icon-1024.png as the iOS AppIcon (asset catalog + project.yml), verify the cloud xcodegen build. |
| brand-17b | — | dropped (no data) | web/index.html | §7 item 17 "Confirmed" hazard label: nothing in the data marks a hazard as confirmed; every hazard reads "Driven once" until multi-pass confirmation exists. |
