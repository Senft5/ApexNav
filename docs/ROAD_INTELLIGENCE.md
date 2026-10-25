# APEX NAV — ROAD INTELLIGENCE & ROUTING DESIGN

> Why we win: Calimoto, Kurviger and CorsaView rank roads mostly by *how curvy the
> line on the map is*. We rank roads by **what driving them feels like** — in time,
> in three dimensions, for *your* car — and we correct the map with physics measured
> by every phone that drives it. Routing then chains the best roads together the way an
> experienced local would, not the way a shortest-path solver would.

Status markers: **[built]** in code and tested · **[next]** scheduled · **[later]** designed, not started.

---

## 1. Principles

1. **Score the experience, not the polyline.** Curvature per kilometre is a property of
   the map; what a driver feels is lateral load, braking, rhythm and vertical motion
   *over time*. Every feature below is computed from a simulated drive (§2), never from
   raw geometry alone.
2. **Time, not distance.** Four corners in a kilometre is frantic at 70 mph and dull at
   20. Rates are per minute at the reference pace.
3. **Direction matters.** A road climbed and the same road descended are different
   stages. Every score exists per direction.
4. **Three dimensions.** Crests, compressions and corners on gradients are where roads
   become memorable. Elevation comes from the DEM everywhere and from the barometer
   where we have drives.
5. **Personal.** A Miata and a 911 Turbo drive different roads well. The car profile
   changes the simulated drive itself, so scores change for physical reasons, not by
   fiddling weights.
6. **Confidence is part of the score.** L0 = map + DEM only, L1 = one IMU pass,
   L2 = multi-pass verified. Unknown stays unknown (`null`).
7. **Zero-snitch.** Crowd signals are shared only as ratios relative to the same driver's
   own pace (§4.1). No absolute speeds or timestamps leave the phone.

---

## 2. The Reference Lap (the central idea)

For any path with geometry (and elevation), simulate a *sane, skilled* driver in the
user's car. This is a quasi-steady-state lap simulation, the standard tool of race
engineering, run on public roads with street limits.

Per 5 m sample `i` along the path:

| Limit | Formula | Source |
|---|---|---|
| Corner | `v_c = sqrt(R g (mu_lat + tan phi))` (manifesto) | curvature, camber (crowd) |
| Sight | `v_s`: reaction + braking distance fits in visible road: `v t_r + v^2/(2 a_b) = S` → `v_s = a_b (-t_r + sqrt(t_r^2 + 2 S / a_b))` | §2.1 |
| Grip derate | `mu_lat` x (1 − roughness derate), wet/gravel later | crowd SURF, surface tag |

Then two passes:

- **Backward (braking) pass**: `v_i <= sqrt(v_{i+1}^2 + 2 a_b ds)`. This is the
  **braking envelope** — the fastest you can be at `i` and still make everything ahead.
  It drives the vermilion ribbon and the PACE bug. **[built]**
- **Forward (acceleration) pass**: `v_{i+1} <= sqrt(v_i^2 + 2 a_acc(v_i) ds)` with
  `a_acc(v) = min(mu_lon g, P/(m v)) − drag − g sin(grade)`. This is what the car can
  actually do, so short straights don't count as "fast" for a low-power car. **[next]**

The reference lap is `min(forward, backward)` and gives `v(s)`, `t(s) = ∫ ds/v`,
`a_lat = v^2 kappa`, `a_lon = dv/dt`, and `a_vert = v^2 kappa_v` (vertical curvature).
**All scoring features in §3 are read off this simulated drive.**

There is **no fixed speed cap.** On a long straight with a long sightline, the physical
envelope is high; we show it honestly next to the posted limit (§2.2) and let the driver
see both.

### 2.1 Sight distance **[built: vertical + horizontal geometric]**
- **Vertical (crests)**: ray-cast along the elevation profile from eye height 1.08 m to
  an object height 0.60 m (AASHTO stopping-sight values). The first sample `j > i` where
  the line of sight dips below the road surface between `i` and `j` bounds `S_v(i)`.
  Uses barometric elevation on recorded drives and DEM elevation on routes.
- **Horizontal (corners)**: the inside of a curve is blocked by trees, banks and
  buildings at lateral offset `M` from the driving line. Sight distance follows the
  chord: `S_h = R · 2 · acos((R − M)/R)` for `M < R`. We do not yet know `M`; we use
  `M = 4 m` (wooded verge, conservative), later refined from landcover (forest vs field)
  and from crowd behaviour (§4.1: drivers who lift where geometry says they needn't are
  telling us the corner is blind).
- `S = min(S_v, S_h)`, capped at 400 m (beyond that it no longer constrains a car).

### 2.2 Posted limits **[built in cockpit]**
Map-matched from OpenStreetMap `maxspeed` via Valhalla `trace_attributes`. Shown as a
separate marker on the speed dial. Never blended into physics.

---

## 3. Features (per direction, per window of reference-lap time)

Grouped by what they measure. Each is normalised with a saturating curve
`100 (1 − e^{−x/x0})` with `x0` set so a famous benchmark road scores ~85 (calibration
set, §6).

### 3.1 Rhythm & flow
- **Lateral engagement** — fraction of time with `|a_lat| > 0.25 g`. Roads where you are
  *loaded* most of the time.
- **Corner cadence** — corners per minute, and the regularity of their spacing
  (coefficient of variation of inter-corner times). A steady beat is flow; random spacing
  is work.
- **Transitions (esses)** — `a_lat` sign changes within 3 s with < 0.1 g of braking in
  between: weight thrown side to side without scrubbing speed. The single best predictor
  of "this road is fun" in driving folklore; nobody else measures it.
- **Braking demand** — braking energy per minute, `Σ max(0, −Δ(v²/2))`. Divided by
  lateral engagement gives **point-and-squirt vs flowing**: high ratio = brake, turn,
  accelerate (tight towns, junctions); low ratio = momentum road.
- **Throttle opportunity** — fraction of time power-limited in the forward pass. Car
  dependent: a powerful car enjoys short straights between corners; a light car wants
  them gone.
- **Dead time** — fraction of time at the envelope ceiling with `|a_lat| < 0.05 g`
  (boring straights).

### 3.2 Three-dimensional character
- **Vertical events** — `a_vert = v² kappa_v`: unweighting (< −0.15 g over crests) and
  compression (> +0.15 g in dips) per minute.
- **3D corners** — corners whose apex coincides with grade change (corkscrews) or
  unweighting (light over a crest mid-corner: high skill, high reward, high risk).
- **Relief** — metres of climb + descent per minute.

### 3.3 Challenge & commitment
- **Severity mix** — share of 1-3 corners and hairpins.
- **Blind fraction** — corners where sight distance < stopping distance at the corner
  limit. Raises TECH, lowers confidence, and is penalised hard on single-lane roads.
- **Decreasing radius** — "tightens" corners per minute (the classic trap).

### 3.4 Surface & chassis (crowd)
- **Spatial roughness** — the >8 Hz vertical band re-sampled from time to *distance*
  using speed, giving a speed-invariant roughness spectrum (IRI-like) so a fast and a
  slow driver measure the same road.
- **Verified impacts** — multi-pass bumps (§4.3).
- **Surface tag** — `paved_smooth / paved_rough / compacted / gravel` from Valhalla.
- **Car weighting** — ride height and suspension stiffness scale the penalty for
  compressions, crests and roughness (GT3 hates heaves; a GTI shrugs).

### 3.5 Interruption & heat (CLEAR)
- Junctions per minute where we lack priority, traffic signals, stop signs.
- Town transits: posted limit ≤ 35 mph, residential landuse.
- ALPR cameras within 60 m (OSM/DeFlock).
- **Enforcement likelihood**: posted limit far below the road's physical envelope on
  long straights is where speed traps live. Shown as heat, never as advice.

---

## 4. Crowd intelligence (what only we can know)

### 4.1 Pace-normalised corner behaviour **[next]**
For each drive, the driver's **pace factor** `p = median(v_meas / v_ref)` over cornering
samples. At each corner apex the **deviation** `d = (v_meas / v_ref) / p`.
- Drivers consistently slower than geometry predicts (`d < 0.85`) → hidden difficulty:
  blind crest, gravel, broken surface, decreasing radius, bad map geometry. The pace note
  gains "caution", confidence drops, sight offset `M` for that corner grows.
- Consistently faster (`d > 1.1`) → better than it looks: banked, open sightline.
- Only `d` is uploaded — a ratio relative to the driver's own pace. It reveals nothing
  about how fast anyone drove.

### 4.2 Geometry correction **[later]**
OSM corners are often simplified polylines; real radii hide between vertices. Yaw rate
over speed gives true curvature at 100 Hz. Crowd passes overwrite map curvature where
they disagree, so pace notes improve for everyone, including people without sensors.

### 4.3 Bayesian hazard verification **[next]**
Each pass over a 5 m bin is an observation. Hazard presence is a Beta posterior updated
by hits and clean passes, with recency decay (potholes get filled). A bump is
`verified` at posterior > 0.8 with ≥ 2 independent drivers. Only verified hazards are
called in cruise. (Motivation: on our own data, 1 of 7 single-pass bumps repeats.)

### 4.4 Camber truth **[built]**
`a_y = v ω_z cos φ − g sin φ`, turn-relative, aggregated over passes.

---

## 5. Scores, archetypes and personalisation

### 5.1 The four axes (manifesto) as compositions
| Axis | Built from |
|---|---|
| **TECH** | cadence, severity mix, hairpins, transitions, blind fraction, 3D corners, decreasing radius |
| **FLOW** | lateral engagement, cadence regularity, low braking-per-engagement, transitions, low dead time, positive camber |
| **SURF** | spatial roughness, verified impacts, surface tag, crest/compression severity — weighted by car |
| **CLEAR** | ALPR, junctions/signals, town transits, enforcement likelihood (null without data) |

### 5.2 Archetypes
Sectors are also labelled with a character a human recognises:
`Switchbacks · Technical · Esses · Flowing sweepers · Fast open · Rollercoaster · Connector · Town`.
Rule-based first (thresholds on §3 features), clustering once crowd data exists.
The UI leads with the archetype ("Esses, 3.1 mi, climbing") — far more useful than "74".

### 5.3 Adaptive sectors **[next]**
Fixed 500 m bins cut great roads in half. Sectors are found by change-point detection
(PELT) on the feature time series, bounded 250 m – 2.5 km (manifesto), and always broken
at junctions — because a junction is where a route can join or leave. A **stage** is a
maximal run of high-scoring sectors between junctions; stages are the unit of routing.

### 5.4 Personal score
`score = confidence × Σ_k w_k · axis_k` with `w` from the driver's preference (sliders,
then learned, §6) and the car profile already baked into the reference lap. Archetype
preferences ("I love esses, hate switchbacks") add a multiplicative bonus.

---

## 6. Validation — how we know the scores are right
1. **Archetype unit tests** **[built for current features]** — synthetic esses must out-FLOW a
   straight with one hairpin; switchbacks must out-TECH sweepers; a straight must score
   lowest everywhere. Orderings, not magic numbers.
2. **Benchmark roads** **[later]** — a calibration set of famous roads (Tail of the
   Dragon, Hwy 1 Big Sur, Stelvio, Route 33 Ojai...) scored from map + DEM; they must rank
   in the top decile of their region.
3. **Preference learning** **[later]** — after a drive: "Which was better, A or B?"
   Pairwise answers fit a Bradley-Terry model over feature weights, per user and
   globally. This is how the score stops being our opinion.

---

## 7. Routing

### 7.1 Problems
- **A → B, spirited**: maximise `Σ score · time` subject to
  `time ≤ (1 + ε) · fastest`, ε chosen by the driver ("+15 min for better roads").
- **Loop**: orienteering — maximise reward within a time budget, start = end,
  penalise re-using a road in the same direction.
- **Explore**: "best stages within 30 min of here".

### 7.2 Architecture: stage discovery + stage chaining
We do not need our own routing engine to start. We need to know *which roads are
worth driving*; a commodity router (Valhalla) connects them.

1. **Stage discovery** **[next]** — road lines in the region come from the vector tiles
   the map already loads (OpenFreeMap `transportation` layer), elevation from the
   Terrarium DEM tiles already loaded for hillshade. Each candidate road is
   reference-lapped in both directions and scored. No backend, works anywhere on Earth,
   at L0 confidence; crowd data upgrades it.
2. **Connector costs** — Valhalla `sources_to_targets` matrix between stage ends, with
   `use_highways` low.
3. **Chaining** — orienteering heuristic (greedy insertion + 2-opt; exact ILP for
   ≤ 25 stages). Choose each stage's direction by score and car (climb the technical
   one, descend the flowing one).
4. **Route & verify** — Valhalla route through stage entry/exit + shaping points; then
   re-score the *returned* geometry with the reference lap and reject solutions where the
   router shortcut a stage.
5. **Set list** — order stages so intensity builds, rests, and finishes high; avoid
   three max-TECH stages back to back (fatigue is a safety issue).
6. **Sun glare** — penalise headings within 20° of the sun's azimuth when it is below
   15° elevation (solar position is pure math).

### 7.3 Later
Our own routing graph with the fun score baked into edge costs (Valhalla/GraphHopper
custom costing, self-hosted), so the optimiser sees every road, not just discovered
stages.

---

## 8. Build order
1. Sight distance + posted limits, no cap **[built]**
2. Reference lap forward pass with car profile; time-domain features §3.1-3.3; archetype
   tests **[next]**
3. Adaptive sectors + archetype labels
4. Bayesian hazard verification + pace-normalised corner deviation (needs the multi-drive
   store)
5. Stage discovery from vector tiles + DEM; loop/A→B chaining via Valhalla
6. Benchmark set + preference learning
