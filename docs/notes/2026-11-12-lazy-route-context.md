# STATE

## 2026-11-12 The route-context providers that only answer a plan load after launch (claude/project-thread-39xbx9)
- `web/lazy.js` has a new group `ctx` with 11 providers: graph, router edges, terrain, conditions, wildlife, events,
  live hazards, photos and the three OpenStreetMap ones, about 200 KB. They load once the map is idle after launch,
  or with the first plan that needs them (`cockpit.js` `needCtx`, awaited by `contextOn`, `stagesWithContext` and When
  to go). The registry, ctx_util, crowd, driver, car, iOS context, crew meet, osm_common and context_grid stay at
  launch, because the page reads them directly.
- Startup budget (e2e): 3.14 MB in 122 scripts, down from about 3.33 MB in 133.
- The offline shell (`sw.js`) keeps the lazy route_ctx files too: `lazyOf` reads `route_ctx/` paths.
- Next: the startup budget can come down to match (`BOOT` in e2e/smoke.js) once a few more merges show where it sits.

# CALL SHEET

## 2026-11-12 Plan-only route context off the launch path (claude/project-thread-39xbx9)

A plan that starts before the idle load waits for the local files (milliseconds in the app), which is still inside the
first route's budget. If a file fails to load (an offline website), the plan goes on with the providers it has, as
when one is missing, and the next plan asks again. Undo: put the 11 `<script>` tags back in index.html and drop the
`ctx` group and the `needCtx` calls.
