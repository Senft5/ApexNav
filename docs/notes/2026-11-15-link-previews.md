# STATE

## 2026-11-15 Link previews for shared links (free roamer B)
- Done: a vettadrive.app link pasted into Messages, Instagram, X, Discord or Slack shows a card instead of a bare URL.
  A public roadbook's link: "Smokies classics · a roadbook on Vetta", "7 roads · 84 mi · kept by @sam. <its about>".
  Invites, crews, convoys, friends, posts: a line of what the link is, never whose or where. A plain visit: Vetta's line.
- How: backend/src/link_preview.ts (`previewFor`, `tags`, `withPreview` with HTMLRewriter), called from hosts.ts for
  GET / and /index.html (already run Worker-first). One D1 query, only for a ?roadbook= link with a valid id; public,
  non-empty and not reported only. Cards with a query cache 5 minutes. No migration.
- Tests: backend/test/link_preview.test.ts.
- Next: a real picture per card (the roadbook's roads on a map as a PNG; crawlers mostly refuse SVG) needs an image
  renderer in the Worker (resvg wasm) or a pre-rendered image in R2 when a book goes public.

# CALL SHEET

## 2026-11-15 Link preview card uses the app icon, not a map picture (free roamer B)
- What: og:image is /brand/icon-1024.png for every card; twitter:card is "summary" (square).
- Why: iMessage, X and Facebook want PNG/JPEG; rendering a map PNG in the Worker needs a wasm renderer, a bigger change.
- Undo: delete the withPreview call in backend/src/hosts.ts.
