# STATE
## Session 2026-11-13 (security): sweep of the routes merged this afternoon (claude/project-thread-4lms1f)
- Drive posts (#674): a post to friends reached a friend the author had turned sharing off for (grants.share_scores, the
  per-friend switch a Score falls under); now it doesn't. A post to a crew stayed in the crew after its author left; now it
  goes with them. backend/src/drive_posts.ts POST_SEEN, test in drive_posts.test.ts.
- Saved routes and places (#686): a removal of an id the account never had was stored as a row (uncapped, 25 a call, until
  the 60-day sweep). Now a removal only marks a row that is there. member_items.ts itemsPut.
- Map data uploads (#680): the GitHub OIDC check let in any workflow on main by repository name. Now it also needs the
  repository and owner ids, one of the two upload workflows (workflow_ref) and a push, schedule, dispatch or workflow_run
  event. github_oidc.ts; data_store.test.ts. If a new workflow uploads map data, add its file to WORKFLOWS.
- Also read: push status (#665, no person or key named; APNs probe cached an hour), backup paging (#646), road data per
  way (#634, still shownSql with road_floor), /api/me contribute (#625), service check (#631). Nothing else found.

# CALL SHEET
## 2026-11-13 (security): drive posts follow the per-friend Share switch (claude/project-thread-4lms1f)
A post carries the drive's Score, and Share off for a friend is how a member keeps their Scores from that friend; posting to
"Friends" means the friends they share with. A crew post is an explicit choice of that crew, so it needs no grant, but only
while the author is a member. Undo: the two added EXISTS lines in POST_SEEN (backend/src/drive_posts.ts).
