# STATE

## 2026-11-13: Kudos for you, shaped like the feed, one rule
- Done: on the Log, each row under Kudos for you now matches a Friends lately row: **@dan** gave you kudos, with the stage and day in small type under it. One rule separates Kudos for you from Friends lately, where there were two (the disclosure's hairline and the panel's). The e2e friends' activity flow checks the row text and that the panel has no top rule after the disclosure.
- Next: keep looking for doubled rules on the Log and People.

# CALL SHEET

## 2026-11-13: one rule after a Log disclosure
- What: `.log-page details.quiet:not([hidden]) + .panel:not(.index-panel) { border-top: 0; }` in web/signature.css, and kudos rows built like feed rows in web/analysis_page.js.
- Why: Nate wants a clean, consistent social feed; the doubled line and the different row shape looked sloppy.
- Undo: drop the CSS rule and go back to the one-sentence kudos row.
