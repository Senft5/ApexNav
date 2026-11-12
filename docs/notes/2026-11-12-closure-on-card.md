# STATE

## 2026-11-12 The route card says when a route still drives a reported closure (claude/project-thread-39xbx9)
- `cockpit.js` `closedOnCard`: a planned route or loop that passes within 40 m of a member's "Road closed" report (the
  hazards for its area in hand) says "Passes a reported road closure" first on the card's line. Our router goes round
  closures where it can (#541); this is for when there was no way round, or a report landed after the plan.
- A slow hazards answer now paints the card again for everyone, not only with Avoid police on.
- e2e: "a reported road closure the route still drives is on the route card".
- Next: the same offer for a convoy leader's live closure call, if convoys get one.

# CALL SHEET

## 2026-11-12 A closure on the route is said on the card, no switch (claude/project-thread-39xbx9)

Closures aren't an Avoid switch (nobody wants a closed road), so this isn't "Couldn't avoid ...": it is its own short
line, said first. Signed out there are no reports and nothing is said. Undo: the `closed` line in the card's paint and
`closedOnCard`.

## 2026-11-12 A closure that lands on the route ahead mid-drive: Go round (claude/project-thread-39xbx9)
- `cockpit.js` `closedAheadTick` offers a member's "Road closed" report within 40 m of the route 0.5 to 25 km ahead
  once, with Go round (`goRoundClosed`: the rest of the plan routed with `avoid.closed`), the way police reports are.
  There is no switch, and "No way round that closure" is said when the new way still passes it.
- `closuresAround` (Valhalla's exclusions, and `closedForTrip`) also takes the closures the drive has fetched itself, so
  one that landed after the trip's were fetched is excluded too.
- e2e: "a road closure, driving: a closure reported on the route ahead is offered once with Go round ...".
