# Worker queue

The 30-minute review loop takes the first `todo` item, checks it is still needed, writes a
precise task (exact file, selectors, strings) and dispatches it to the local worker with
`python tools/local_worker.py dispatch`. The loop updates the status here when it merges or
drops an item. Item numbers refer to docs/BRAND.md §7. Items 19 and the Jarvis removal in 22
delete owner-visible features and need the owner's yes first; they are not queued.

Statuses: `todo`, `active`, `merged (#PR)`, `dropped (reason)`.

| id | status | files | task |
|---|---|---|---|
| brand-21a | merged (#23) | web/analysis.html | `.dv-z` zoom buttons 30 → 44 px high, drop their letter-spacing (inputs are already 44 px). First worker job, run by hand to prove the pipeline. |
| brand-21b | todo | web/index.html | Delete `.ink-btn.busy::before` and `@keyframes sweep` (and only the code that exists solely to drive the sweep); keep the busy label and progress bar. `.ink-btn.on` = ink fill, not accent. |
| brand-17 | todo | web/index.html, web/instruments.js | Pace-note strip text per §7 item 17: `subFor()` returns `R 42 m · 31 mph` for corners, `Driven once` / `Confirmed` for hazards, `Camera` for cameras; the next-note mini tulip drops its repeated code label; Roadbook boxes show the code only when it differs from the call. |
| brand-18 | todo | web/drive_view.js | Corner label collisions per §7 item 18: draw a corner number only if it is ≥ 18 px from every already drawn label, else a 4 px dot; same for the Compare plan map. |
| brand-12 | todo | web/drive_view.js | Drive summary hierarchy per §7 item 12 (score 44 px with `/1000` and the four part bars under it; one distance · time · corners line; remove Top speed, Peak lateral, Peak braking, Climb tiles from the summary only; hide the scrub readout until the first scrub). |
| brand-24a | todo | web/index.html | Replace inline `style="…"` spacing with `.mt-8`, `.stack-8`, `.stack-12` utilities on the 4 px grid (define them once in the page CSS). Spacing only; no visual change beyond rounding to the grid. |
| brand-24b | todo | web/analysis.html | Same as brand-24a for the analysis page. |
