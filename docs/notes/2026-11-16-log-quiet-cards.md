# STATE

## The Log's quiet lines are cards (UI thread, 2026-11-16)
- In the Roadbook look, the Log's fold-open lines (the year with its challenges, Your week, Your roads, corner by corner, Kudos for you) were bare lines ending in "+", sitting between the coach card and the Your driving card. Each is now a card of its own like Your driving: the raised fill, 56 pt tall, and a › that turns down when it opens. What it holds stays inside the card, and keys and chips inside sit on the panel colour so they still stand off it. `web/system.css`.
- Next: the drive page (with the analysis thread's words) and Your cars.

# CALL SHEET

## The Log's details.quiet take the card shape
- What: `[data-theme="roadbook"] .log-page details.quiet` gets `--raised` with `--r-card`, a 16 px summary, and a rotating › in place of +/−.
- Why: Nate (11-16): "always just kind of a list of things". On a page of cards, bare lines with a + read as leftovers. The spacing comes from the page's own 12 px gap, so cards sit evenly.
- Undo: delete the `details.quiet` rules at the foot of `web/system.css`.
