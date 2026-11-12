# STATE
## Session 2026-11-12 (roam-c shared-tiles): a kept map tile belongs to every area that needs it (claude/roam-c-shared-tiles)
- Done: offline_tiles.js tags each kept copy with every area that fetched it (`areas`, read from an older copy's `area` too,
  `areasOf`); deleting an area drops only its tag and deletes the copy once no area holds it. Before, the last area to
  fetch a tile owned it: deleting a saved route's map took tiles a saved area round it still needed, and a copy kept again
  as it arrived lost its tag and was never deleted.
- Tests: e2e "offline tiles two areas share…" (fails on the old code).
- Next: none here.
