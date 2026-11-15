# STATE
## Session 2026-11-14 (open gates): Fun and Long way take gated park roads and parkways (claude/project-thread-39xbx9)
- Done: web/graph_router.js openGates (in view()): a barrier=gate on tertiary and up, with no access=private, is open, edge and node. tools/famous_roads.js (rider roads across the lower 48 on the live tiles) committed: on build us-2026-46 11 of 17 at Fun before; after, Angeles Crest 0.17 to 0.70 on it, the Blue Ridge Parkway at Quick 0.12 to 0.88, Beartooth Long way 0.75 to 0.98 and 46 min shorter, Going-to-the-Sun 16 min shorter.
- The tool now plans with the app's avoid defaults (unpaved avoided, as cockpit.js) and reads VA 16 by its OSM name (B F Buchanan Highway): Back of the Dragon is 0.90 at Quick, 0.45 at Fun.
- Bugs: Fun still prefers US 221 to the Blue Ridge Parkway (1.3 corner points a km against 5.6: the parkway sweeps, and its scenery scores 0.60 like the roads beside it). The Snake (US 421) is missed at Fun and Long way (TN 91 and county roads instead), and SE Ohio prefers ridge county roads to OH 555, 78 and 26.
- Next: why Fun leaves US 421 (The Snake) and VA 16 for side roads (tools/famous_roads.js snake backdragon).

# CALL SHEET
## 2026-11-14 (open gates): a gate on a through road costs nothing (claude/project-thread-39xbx9)
OSM gates (barrier=gate, lift_gate, swing_gate, sliding_gate; not chain or kissing_gate, no access=no) on park roads are their winter closures, open most of the year, and the router charged each the private-road toll (x10 time + 600 s) plus 120 s at the node. Now on class tertiary and up without the private flag the gate is ignored (K.OPEN_GATE_CLS); closures come from the road feeds. Residential, service and track gates still block. Undo: delete the openGates(...) call in view().
