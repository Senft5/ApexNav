# Worker queue

The 30-minute review loop takes the first `todo` item, checks it is still needed, writes a
precise task (exact file, selectors, strings) and dispatches it to the local worker with
`python tools/local_worker.py dispatch`. The loop updates the status here when it merges or
drops an item. Item numbers refer to docs/BRAND.md §7. Items 19 and the Jarvis removal in 22
delete owner-visible features and need the owner's yes first; they are not queued.

Statuses: `todo`, `active`, `merged (#30)`, `dropped (reason)`.

## Priority: routing (owner request 2026-10-26; before any brand item)
Do these in order. `who` = `worker` (dispatch with an exact spec) or `reviewer` (needs design
and tests: the loop implements it itself on a `claude/` branch, across ticks if needed).
Today `here()` (web/index.html, ROUTING section) uses live GPS only while driving and otherwise
the replay cursor or the **map centre**; Plan has one "Where to" field; off route the cockpit just
shows "Driving · no route loaded" and never reroutes.

| id | who | status | files | task |
|---|---|---|---|---|
| route-1 | worker | merged (#28) | web/index.html | Plan routes start from the phone's real position. Add `async locate()`: `state.live` if driving, else `navigator.geolocation.getCurrentPosition` (high accuracy, 10 s timeout, maximumAge 30 s). `routeTo`, `searchAndRoute` and Loop use it instead of `here()` (keep `here()` for anything that is not route planning). On failure never fall back to the map centre silently: toast "Couldn't get your location. Type a start or tap the map." and stop. |
| route-2 | worker | todo | web/index.html | Plan "Where to" becomes From + To. From defaults to "Current location" (uses `locate()`); typing a place there geocodes it with the same Nominatim call; a swap button between the fields; "Or tap the map" fills whichever field was focused last (To by default). Store the request on the track (`t.request = { from, to, via }`, `from: null` = current location) so a reroute can rebuild it. |
| route-3 | reviewer | merged (#30) | web/reroute.js (new), tests/test_reroute.py (new) | Pure off-route state machine, UMD like web/sensors.js, node-tested like tests/test_web_core_parity.py. Per fix input `{t, distToRouteM, accuracyM, speedMps, progressM}`. Off route when `dist > max(40, 2·accuracy)` for 5 s in a row while moving > 2 m/s; back on route under 25 m; also off route when progress along the route falls ≥ 100 m (wrong way). One reroute request per off-route episode; 20 s cooldown; on failure back off 20/40/80 s, capped at 2 min. Tests: GPS jitter at a corner does not trigger; a real turn-off triggers once; rejoining before 5 s cancels; wrong-way triggers; the backoff schedule. |
| route-4 | reviewer | todo | web/index.html | Wire route-3 into live mode: when off route, search the whole route for a rejoin (not only the 600-sample window after `cursorIdx`); on a reroute request rebuild from the current fix to `t.request.to` through the via points still ahead (loops: next unpassed loop waypoint, then the rest of the loop); keep the old route drawn until the new one arrives; voice "Rerouting" and "Back on route"; offline: "Off route · no signal to reroute" and keep the old route. Notes, pace and trip distance stay blank while off route (existing honesty rule). |
| route-5 | reviewer | todo | docs/STATE.md | Verify in the browser with a simulated GPS track that leaves and rejoins a route (desktop: replay a recorded drive's fixes into live mode). Real-phone test stays on the owner's list. |

| id | status | files | task |
|---|---|---|---|
| brand-21a | merged (#23) | web/analysis.html | `.dv-z` zoom buttons 30 → 44 px high, drop their letter-spacing (inputs are already 44 px). First worker job, run by hand to prove the pipeline. |
| brand-21b | dropped (already done; stale comment fixed in #23) | web/index.html | Delete `.ink-btn.busy::before` and `@keyframes sweep` (and only the code that exists solely to drive the sweep); keep the busy label and progress bar. `.ink-btn.on` = ink fill, not accent. |
| brand-17 | merged (#26) | web/index.html, web/instruments.js | Pace-note strip text per §7 item 17: `subFor()` returns `R 42 m · 31 mph` for corners, `Driven once` / `Confirmed` for hazards, `Camera` for cameras; the next-note mini tulip drops its repeated code label; Roadbook boxes show the code only when it differs from the call. |
| brand-18 | todo | web/drive_view.js | Corner label collisions per §7 item 18: draw a corner number only if it is ≥ 18 px from every already drawn label, else a 4 px dot; same for the Compare plan map. |
| brand-12 | todo | web/drive_view.js | Drive summary hierarchy per §7 item 12 (score 44 px with `/1000` and the four part bars under it; one distance · time · corners line; remove Top speed, Peak lateral, Peak braking, Climb tiles from the summary only; hide the scrub readout until the first scrub). |
| brand-24a | todo | web/index.html | Replace inline `style="…"` spacing with `.mt-8`, `.stack-8`, `.stack-12` utilities on the 4 px grid (define them once in the page CSS). Spacing only; no visual change beyond rounding to the grid. |
| brand-24b | todo | web/analysis.html | Same as brand-24a for the analysis page. |
