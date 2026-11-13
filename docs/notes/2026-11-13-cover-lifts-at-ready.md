# STATE

## 2026-11-13 native speed: the cover lifts when the cockpit is ready, not on the first map tile (claude/project-thread-5sbga7)
- Done: the opening cover (boot.js) used to wait for the base map's first tile in our style, which comes over the network: at 4x CPU the page was ready at ~1.0 s but the cover stayed until ~3.3–3.7 s. It now lifts two frames after the cockpit is built (~1.0–1.2 s), and the map waits on its theme paper (U-68's `.unstyled`, unchanged) until its first tile draws, as Apple Maps shows its grid. Where to?, Just drive, the deck and the tab bar can be used about 2.5 s sooner on a cold start.
- Done: the map tiles last seen are kept on the phone (offline_tiles.js, at most 400, oldest dropped first, fetched again after 30 days), so a launch draws the map from the phone: on a relaunch at 4x CPU the first tiles are in at ~1.6 s, and with no signal the map now draws its last view (it stayed blank before). The bytes are copied before keeping (MapLibre hands the buffer on to its worker, detached).
- Tests: e2e "startup budget" checks the cover lifts within a second of ready with no tiles at all, and the map stays hidden on its paper; e2e "the map opens on what it last showed" keeps tiles online and draws them on a reload with no signal; tests/test_offline_tiles.py checks the cap and the 30-day refresh. "REVIEW.md 1.2 screen by screen" reads the hazard Undo in one go and records the status line (it failed twice in CI with the key back to Report; not reproduced locally in 3 runs).
- Next: build the Garage, Settings and look picker on first open; trim MapLibre's construction (~270 ms at 4x, a forced layout in `_containerDimensions`). Your data's offline size counts saved areas only, not the ~10-25 MB of recent tiles (Delete offline data does clear them).

# CALL SHEET

## 2026-11-13 the cover lifts at cockpit ready
- What: cockpit.js ends its boot with two requestAnimationFrame then `ApexBoot.done()`; the map 'load' handler still reveals the canvas on the first tile.
- Why: the cover was hiding a ready, usable app for up to ~2.5 s while a tile came over the network (big bet #10, native speed). The paper map under a built deck shows no stock or day colours, which is what the cover was for.
- Undo: delete the requestAnimationFrame line at the end of cockpit.js's boot.

## 2026-11-13 recent map tiles kept on the phone
- What: offline_tiles.js keeps every map tile it fetches (`recent`), capped at RECENT_MAX 400, the oldest dropped every 50 kept; a recent one is served for RECENT_DAYS 30, then fetched again (the kept copy still serves when the fetch fails).
- Why: Apple Maps and Google Maps open on their last view at once, with or without signal; ours waited on the network for every launch.
- Undo: in install(), drop the `keepRecent` line (servable() then only matters for copies already kept).
