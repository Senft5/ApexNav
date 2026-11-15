# STATE
## Session 2026-11-15 (trunk stretch): a pass on a long US route is a rider's road (claude/project-thread-39xbx9)
- Done: web/graph_router.js hwyOf. A two-way trunk was a highway to Fun and Long way unless its whole name across the view had TRUNK_FUN_KM corner points a km. Now a stretch of it (the trunk within TRUNK_STRETCH_M / 2, 4 km, of an edge's middle) with that many is a rider's road too, while its straight miles stay a highway.
- Result: US 550 from Silverton over Molas and Coal Bank passes (1.5 to 2.1 points a km) was a highway, because "US 550" also names 0-point valley miles to New Mexico (0.73 a km over the view). Now 21 km of it is a rider's road. The Ouray loop at 150 km now goes over both passes there and back, 138 km (it was 73 km to Silverton and back). The famous roads, the two road trips and the 14-area loop survey are otherwise unchanged (Million Dollar Highway at Fun 43.1 to 44.2 min, still 0.95 on it). Around Cincinnati only KY 11 changes, 10 % of it. hwyOf on a 1.5 M edge road-trip view takes 105 ms, up from 44.
- Next: Fun's goodness-weighted searches on road trips still settle about 1 M edges each.

# CALL SHEET
## 2026-11-15 (trunk stretch): a trunk judged by its stretch, 8 km, as well as by its name
A name across a view mixes a mountain pass with the plains, and the result even changed with how far the view reached. Eight km is long enough that one bend at a junction doesn't make a road a rider's road, and short enough to find a pass. The name-wide rule stays, so nothing that was a rider's road becomes a highway. Undo: set TRUNK_STRETCH_M in web/graph_router.js K to 0.
