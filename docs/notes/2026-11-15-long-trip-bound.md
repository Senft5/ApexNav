# STATE
## 2026-11-15 (long-trip search bound): road-trip plans search their corridor, not the whole map
- Past LONG_KM (150 km crow) a plan bounds its searches by one backward Dijkstra on the edge times to the goal (graph_router.js timeTo; one more off the highways for Fun and Long way's banned searches), and, once the budget is known, never enters a node that no route inside the budget can pass (a forward one from the start plus the backward one, over limitS).
- Cincinnati to Deals Gap: Quick's own search 1.5 M edges to 44 k, each step of its bisection 1.1-2.2 M to 114 k, the highway-free search 2.4 M to 0.55 M; Quick 6.8 s to 3.7 s, Fun 14 s to 6 s (its soft cap), and Long way plans inside its budget. Denver to Ouray Quick 5.0 s to 1.1 s.
- Same routes: the 18 famous-road cases, the 15-area loop survey, and Cincinnati to Deals Gap / Denver to Ouray at Quick and Fun.
- Next: the goodness-weighted searches (a > 0, Fun's bisection) still settle about 1 M edges on a road trip; the time bound is weak there. A bound on the weighted cost (a backward Dijkstra per weight, cut at an upper bound) is the next step if phones still time out.

# CALL SHEET
## 2026-11-15 (long-trip search bound): three node-time arrays kept on the view
timeTo keeps up to three Float32 arrays (plus a byte each) per node on the view, about 21 MB each on a 600 km trip's 4.3 million nodes, so a road trip's plan doesn't redo them per search. Short trips (under LONG_KM) never make them. Undo: drop `timeTo: true` from planNow's opts0.
