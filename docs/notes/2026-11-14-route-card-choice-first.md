# STATE

## 2026-11-14 the route card leads with its one choice (claude/project-thread-5sbga7)
- Done: on the route card the choice (Quick / Fun / Long way, or a loop's length and ways) comes straight under the stat line; what the ranking did ("Better route found …") sits under the choice it changed; the profile comes after. On an iPhone the three level cards are now above Start, where they sat at the fold behind it.
- Tests: e2e REVIEW.md 1.2 (the card's order, top to bottom: headline, stats, the choice, profile, the groups, the links); plan flow (a) (Start never moves while the card fills in) and the route card flows pass.
- Next: tappable places on the map, prototyped behind apex.mapPlaces (#703), ready for Nate's yes.

# CALL SHEET

## 2026-11-14 the route card's choice over its profile
- What: in index.html `#routeProgress` and `#routeCardProfile` move from above `#routeCardLoop` / `#routeCardFun` to after `#routeCardLevelsNote`.
- Why: Apple Maps' route card leads with the routes to pick from. Ours put the profile and the progress line first, so the level cards (the card's one control) sat at the fold behind Start. Nothing under the choice jumps it now while the profile loads.
- Undo: move the two elements back above `#routeCardLoop` and swap `#routeCardFun` / `#routeCardProfile` in the REVIEW.md 1.2 order check.
