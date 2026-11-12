# STATE

## 2026-11-12 Hairpins a map line draws tight are kept, not dropped as GPS jitter (claude/project-thread-39xbx9)
- `detect_corners` (`core/road_dna.py`) and its port `detectCorners` (`web/apex_core.js`) dropped every corner under
  8 m radius as GPS jitter. A map line draws a hairpin with a few vertices metres apart, so it reads 5-6 m: all 34
  hairpins of the Stelvio's east ramp were dropped, and only 3s and 4s were left (IDEAS R-32).
- Now a turn of 135 degrees or more whose whole arc is at least 8 m x the turn is a hairpin at R = 8 m (its apex
  speed and compactness use 8 m). GPS jitter at a stop turns as far in a few metres (Dry Ridge: 370 degrees in 17 m)
  and is still dropped.
- The benchmark: the Stelvio is #3 of 31 stages (was #6), and it now has to stay in the top tenth. Its stage holds 33
  hairpins. `tests/test_benchmark_roads.py` measures "on the road" against the named line's segments, not only its
  points 100 m apart.
- Next: R-32's Big Sur (#5 of 12, a sweeper road behind Nacimiento-Fergusson).

# CALL SHEET

## 2026-11-12 A tight hairpin-sized turn is a hairpin, not jitter (claude/project-thread-39xbx9)

This changes the pace notes. A route through hairpins whose map line draws them tight used to get no call at all for
them, which was the unsafe way round; now each one is called a hairpin. The guard against jitter is the arc: a real
hairpin covers the road an 8 m radius needs, and stop-and-go jitter doesn't. Undo: the `MIN_RADIUS_M` branch in
`detect_corners` and `detectCorners` (back to `continue`), and `top: 0.20` for the Stelvio in `tests/benchmarks.js`.
