# STATE

## 2026-11-12: Compare and the road's drives say seconds to a tenth, in words
- Done: the Log's Compare cards and corner table, and a drive's "this road" table, give corner times to 0.1 s like the drive page (#518). The road table reads "1.2 s slower on 36 corners" / "quicker" / "level" instead of "+1.20 s on 36 corners (positive = it was slower)".
- Next: keep applying the UI/UX guide's analytics rules to the remaining driver analysis screens.

# CALL SHEET

## 2026-11-12: "slower/quicker" in words on the road table
- What: `slower()` in `web/analysis.html` replaces a signed number plus its "(positive = it was slower)" key.
- Why: Nate's no-footnotes rule and the guide's every-number-labelled rule; a key to decode a sign is a footnote.
- Undo: put `fmtS(o.delta_s)` and the key back in the `dvRoadTable` row.
