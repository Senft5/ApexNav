# STATE
## 2026-11-15 (road trips): Fun and Long way plan a long trip inside their budget
- A road trip whose highway-free way costs more than HWY_FIT_S (20 min) past the level's budget now takes highway where it must (graph_router.js fitHighway: the largest HWY_FIT_X highway cost that fits, by binary search). Denver to Ouray at Fun: 6.8 h over Fremont and Monarch Passes and US 550, where it was a 12 h highway-free way and the card answered with Quick. Cincinnati to Deals Gap at Fun: 5.9 h (I-75 then the Foothills Parkway) against 8.4 h.
- The A* bound's top speed (view vmax) now comes from edges of at least 200 m, capped at 40 m/s. One 60 m Ohio edge timed at 0.5 s (430 km/h) made every search in its view 3 x as blind, and Long way from Cincinnati to Deals Gap ran out of search ("no route"); it now plans (8.4 h, inside its 9.8 h budget).
- Unchanged: all 18 famous-road cases (tools/famous_roads.js) and the 15-area loop survey give the same routes.
- Next: long trips are slow (Cincinnati to Deals Gap: 6 s Quick, 14 s Fun on a desktop; the a > 0 searches settle 3-4 million edges and hit maxSettle at Long way). A bidirectional or two-level search for trips over LONG_KM is the next big routing item.

# CALL SHEET
## 2026-11-15 (road trips): a long Fun trip may use highway to stay in its budget
Fun and Long way keep off highways, and where the highway-free way was over twice the quickest, the card said Quick is the way. On a road trip that meant Quick's interstate all the way (Denver to Ouray), or a highway-free way 65 % longer than Fun's 35 % budget (Cincinnati to Deals Gap). Now, only where avoiding highways costs more than 20 min past the budget, the level uses highway for the transit and keeps the good roads: a short ride, whose highway-free way is rarely that much longer, is untouched. Undo: set K.HWY_FIT_S to Infinity in web/graph_router.js.
