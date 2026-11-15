# STATE
## Session 2026-11-15 (road insights owner key): owner key set up, internal review view (claude/project-thread-26f4xi)
- Done: the owner's internal key (raw key in project files data-site/OWNER_KEY.txt, sha256 in wrangler.jsonc vars DATA_OWNER_KEYS); `&floor=app` for internal keys shows roads under the members' app rule; the viewer's "Include roads under 10 drivers" box.
- Next: per-section figures and IRI calibration (docs/ROAD_INSIGHTS.md §6).

# CALL SHEET
## 2026-11-15 (road insights owner key): the owner's key hash lives in wrangler.jsonc, not the dashboard
No Cloudflare API token can set Worker variables from here, and a sha256 of a random 256-bit key reveals nothing, so it is committed like GOOGLE_CLIENT_ID. The internal app-floor view shows nothing members can't already see in the app. Undo: remove the hash from wrangler.jsonc vars (revokes the key) or drop the floor=app branch in road_insights.ts.
