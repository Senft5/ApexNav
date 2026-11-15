# STATE

## 2026-11-15 The route card names your roadbook roads it drives (free roamer B)
- Done: plan a route (members) and its card's line leads with the roadbook roads it drives: "Drives The Dragon from
  Smokies classics, new to you" (not stamped yet), or "Drives 3 roads from your roadbooks, 2 new to you".
- How: web/roadbooks.js `onRoute` (stamp measure: coverage ≥ STAMP_AT, each road once) and `routeLine`; mount's
  `alongRoute` opens only books whose road boxes meet the route's box (at most 6, each once a page, forgotten after any
  write). cockpit.js `attachBooks` after a plan, then the card is painted again (`t.bookRoads`). No server change.
- Tests: tests/test_roadbooks.py; e2e "roadbooks on the route card".
