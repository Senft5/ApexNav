# STATE
## Session 2026-11-17 (avoid loops): Avoid highways is a hard ban on loops too (claude/project-thread-39xbx9)
- Done: graph_router.js loop and roundTrip now run under withAvoid. While one runs, noHighway counts Avoid highways at any level, so a Quick loop with the switch on never drives a highway. It keeps off them in the legs (the ban), the snaps and the base costs, as Fun's loops do. Before, Quick loops only weighed highways down by LOOP_HWY_X. The switch is reset after each call. Test: test_a_quick_loop_with_avoid_highways_never_drives_one; on the motorway grid that loop goes from up to 1.3 km of motorway to none.
- Valhalla's Quick fallback still uses its own use_highways 0. Where that route still uses a highway, the card already says so (FunRoute.unavoided).
- Next: back to fun routing gaps (Fun on routes far from the owner's area: the famous roads survey, 5 of 24 not OK).

# CALL SHEET
## 2026-11-17 (avoid loops): a call-scoped flag instead of passing req through every loop helper
The loop helpers take the level only, and a dozen of them call noHighway. withAvoid sets a flag for the length of one call and resets it in a finally block. Undo: change loop and roundTrip in web/graph_router.js back to calling loopNow and roundNow directly.
