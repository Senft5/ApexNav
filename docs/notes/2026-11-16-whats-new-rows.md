# STATE

## What's new as rows with marks (UI thread, 2026-11-16)
- What's new (`web/whats_new.js` `show()`) now draws each line as a row: a 40 px ink-tile mark (Drive posts, Places on the map, Turn by turn, Traffic; a dot for anything else) beside a bold title over its words in dim text. Same four lines at most, same text.
- Next: the rest of the screen inventory (end card, Layers, Spots empty state, offline and routing-error states, permission sheet).

# CALL SHEET

## What's new rows get marks, not bullets
- What: each news line gets an ink-tile mark keyed by its title, with a plain dot fallback for titles without a mark.
- Why: the sheet was a block of sentences; marks make it scannable at a glance, like the rest of the redesigned sheets.
- Undo: revert the `MARKS`/`mark()` lines in `web/whats_new.js` and the `#newsSheet .news-row` rules in `web/index.html`.
