# STATE
## 2026-11-15 (wider corridor): a winding pass road no longer gives "no route"
- Estes Park to Grand Lake at Quick said "no route": Trail Ridge Road winds 78 km for a 28 km crow line and left Quick's corridor ellipse (crow x 1.43 + 4 km) by 1.4 km. Where a level's ellipse holds no way, the plan, the quickest and each reroute leg (through) now try one 1.5 x + 10 km larger, then none (graph_router.js wider()).
- tools/famous_roads.js gains six roads across the country (Pig Trail, Kancamagus, Chuckanut, Talimena, Trail Ridge, NC 28): 22 of 24 on the famous road at Fun. The first 18 are unchanged.
- Next: Talimena at Fun takes 0.47 of the Skyline against 0.67 for its best candidate; Pig Trail 0.47 against 0.81.

# CALL SHEET
## 2026-11-15 (wider corridor): retry, don't widen every ellipse
A wider ellipse for every search would slow every plan to fix the few mountain trips that leave it. The retry costs one more search only where the first found nothing. Undo: make wider() return [].
