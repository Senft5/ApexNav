# STATE

## 2026-11-15 A public roadbook's link shows its roads on the map (free roamer B)
- Done: Share on your public roadbook now also sends its link card: a 1200 x 630 JPEG of its roads on the real map (all
  in the accent, on a white casing), with its name, facts and VETTA under it. A link to it pasted into Messages, X,
  Discord or Slack shows that picture large (og:image + twitter:card summary_large_image); without one, the app icon.
- How: web/roadbooks.js `sendCard` (post_map.js map picture via page.mapUnder, the overview SVG over it, canvas → JPEG,
  PUT once per change of name/facts/roads; also on saving a book as public). backend/src/roadbooks.ts `cardPut`
  (owner, public, sniffed JPEG ≤ 600 KB) / `cardGet` (public, not hidden) / `cardErase` (book delete, account delete),
  R2 MEDIA `roadbook/<id>`. link_preview.ts uses it when R2 has it. No migration.
- Tests: backend/test/link_preview.test.ts; tests/test_roadbooks.py (cardLines); e2e "sharing your public roadbook
  sends its link card".
- Next: the same card for a Feed post's road and a stage (both need a public, signed-out view first).
