# STATE

## 2026-11-15 · Your own best on the drive page (the own ghost's Next)
- Done: a drive that covered one of your stages sets its pass against your quickest other run there on a road like this one, when no friend's run is there (signed out, offline, or none shared): "Dry Ridge vs your best", "1.2 s behind your best · set Nov 1", and the stretches that decided it ("Where your best was quicker" / "Where you were quicker"), with no duel key. A friend's run still comes first.
- `web/analysis_page.js renderGhost` falls back to `ApexGhostDuel.bestOwn` over the passes job's corner-cut splits (the same splits a friend shares); `bestOwn` now also says which pass it picked (`pass`), so the panel dates it.
- Next: on the cockpit, say where the stage was won or lost at its finish against your own best (the stretch that cost most), not just the total.
