# STATE

## 2026-11-14 a friend's profile shows their drives (claude/project-thread-5sbga7)
- Done: a friend's profile now lists their posted drives (title, Score, distance, the road on the map, kudos and comments), newest first, under who they are and above Unfriend. This is what any social app's profile opens into. Before, it was a few lines of text. GET /api/feed takes ?by=<handle>: that person's posts only, and only the ones the Feed would show you anyway (same POST_SEEN rule). No DB change.
- Tests: backend drive_posts.test.ts "?by= is one person's posts" (a friend sees them; a stranger sees none; @ and case are ignored). The e2e friend profile flow checks the Drives section with the post, above the foot.
- Next: your own profile (Garage → You) with your posts the same way.

# CALL SHEET

## 2026-11-14 profile drives come from the feed endpoint, not a new one
- What: ?by=<handle> on GET /api/feed instead of a /api/users/:handle/posts route.
- Why: one visibility rule (POST_SEEN) and one card renderer; a stranger's profile can never show more than your feed.
- Undo: drop `after:` in the profile's ApexProfileView.show call in cockpit.js; the backend filter is harmless left in.
