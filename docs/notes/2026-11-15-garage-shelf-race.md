# STATE

## 2026-11-15: the Garage shelf flow's race on CI
- On main, "the Garage on a phone" failed now and then (run 43661135403, shard 1/4). After Use on the second look, its shelf read back at 0.
- Cause, on a loaded runner: the test's swipe back to the first card leaves a snap animation still running at a few pixels. The test then set the shelf to the second card, and the animation's landing overwrote it. The app had already turned the shelf.
- Fix in the test: wait for the shelf to rest after the swipe, before setting it. Then wait up to 3 s for the chosen card to come to the edge before checking that it stays in view. The check itself is unchanged.
- App hardening: when the picker rebuilds its cards (a private look granted or taken back), the shelf forgets which look it last turned to. It then turns to the look in use again instead of resting at 0.

# CALL SHEET

## 2026-11-15: the shelf test waits for rest instead of reading at once
- What: e2e/smoke.js waits for the shelf's scroll to rest before setting it, and polls up to 3 s for the chosen card.
- Why: a smooth snap animation is not a defect. The assertion that the chosen look stays in view still has to hold.
- Undo: remove the two waits in that flow.
