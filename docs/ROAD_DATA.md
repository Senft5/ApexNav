# Road data: what is kept, what is shown, what could one day be licensed

The crowd road data is Vetta's moat and the base of the road-data business in docs/MONETIZATION.md section 5. This page is
the data model as built, the rules for showing it, the owner-only export, and what must happen before anything is sold.
Nothing is sold today.

## 1. What each 5 m section keeps (`road_bins`, backend/src/contribute.ts)

A road is an OpenStreetMap way, split into 5.0 m sections counted from the way's first node, per direction of travel.
For each section and direction:

| field | meaning |
|---|---|
| `n` | passes merged (a pass = one drive's chunk over it; the same drive retried counts once) |
| `rough_mean`, `rough_m2` | roughness (vertical g rms), Welford mean and spread; recent passes lean harder once there are many (Q-12) |
| `camber_mean`, `camber_m2`, `camber_n` | banking in degrees (+ into the turn), from the passes that could measure it |
| `crest_peak` | the strongest unweighting over a crest, 0..3 g |
| `k_mean`, `k_n` | the driven path's curvature (1/m), to correct corners the map simplified (Q-04) |
| `last_on`, `changed_on`, `smooth_run` | freshness: the newest pass's day (never sent to phones), the day a repave restarted the section (sent as a month) |

And per way (`road_ways`): the public map line (≤64 points), its box, and since migration 0029 its **road class** (`cls`,
the map match's Valhalla class) and **map length** (`len_m`). Both describe the public map, never a drive.

**Never kept with the road data:** who drove it, a position or path, speeds, times of day, the drive id after merging, the
car. `rank_slots` remembers the first two distinct drivers of a road+direction only as an opaque holder, for pioneer
points and the two-driver rule; account deletion removes the person, and the merged numbers stay anonymous.

## 2. What is shown, and how sure (backend/src/roads.ts)

- **Open roads show from their first pass** (owner decision 2026-10-28): motorway, trunk, primary, secondary, tertiary,
  and unclassified roads with at least 1.5 km of map line (the rural back roads). One pass counts at lower weight: the
  phone's route scoring weights one pass at 3/4 of two (web/contributor.js `measuredAdjust`).
- **Everything else needs two different drivers** (IDEAS Z-08): short unclassified roads, residential and service roads,
  tracks, and any way whose class is unknown. These may be a dead end or the lane to someone's house; showing one person's
  drives there would show where they live. (Residential and service roads are also never sent by the phone.)
- **Confidence, not counts.** The coverage map gets a level per direction (`conf`: 1 one pass, 2 two to four, 3 five or
  more); nobody sees how many people or drives measured a road. Per-section `n` reaches members' phones only for the math.

## 3. The export (owner only)

`GET /api/ops/roads.geojson?bbox=s,w,n,e` (≤2° a side; 404 for anyone but the owner) returns a GeoJSON FeatureCollection,
one LineString per road+direction (drawn in the direction measured), under the same rule as §2. Properties:

| property | meaning |
|---|---|
| `way`, `dir` | OSM way id, 0 = along the way's node order, 1 = against |
| `cls` | road class, or null |
| `confidence` | 0..1 from the most passes on any section: 1 − 1/(1 + passes) (one pass 0.5, two 0.667, five 0.833) |
| `rough_g` | pass-weighted mean roughness (g rms) |
| `banked`, `off_camber` | share of camber-measured sections banked into the turn (≥ 3°) or away (≤ −3°) |
| `last_month` | the month it was last measured (YYYY-MM), never the day |
| `method_version` | `METHOD_VERSION` in roads.ts (2026-10); bumped when measuring or merging changes meaning |

**Planned, not built:** the class of car that measured a section (stiff, medium, soft suspension) so roughness from a
sports car and an SUV can be told apart. Phones don't send it yet; it will be a coarse class from the Garage, never the car.

## 4. Before anything is sold

1. **Consent.** Terms and the privacy page say that anonymous road measurements may be licensed to organisations
   (cities, map makers), and the App Privacy answers match. Changed before the first pilot, not after; contributors stay
   opt-in with the Road data switch.
2. **Map licence.** Sections are keyed to OpenStreetMap ways (ODbL). A lawyer checks the delivery format first; the
   likely answer is to deliver positions and our own values rather than OSM's data.
3. **Calibration.** A drive over a road with a published IRI survey, to map `rough_g` to IRI (what public works buy).
4. **Only facts about roads.** Never a person, a path, a time or a car; no buyer gets anything §1 doesn't keep.
