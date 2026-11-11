# VETTA — PRODUCT PHILOSOPHY

Rewritten 2026-11-10 from the design and philosophy red team (findings PH-02, BR-01, TE-04, TE-05, UX-01). The old
manifesto described a different product; what was dropped from it, and why, is in section 6 so nobody rebuilds it from
memory. Where this file and the code disagree, the code is the fact and this file is the bug. Visual detail lives in
`docs/BRAND.md` and the tokens in `web/themes.js`; this file says what the product is for.

## 1. What Vetta is

**Vetta is the co-driver for people who take the long way home.** It finds good roads, reads the road ahead out loud
as rally pace notes, scores how cleanly you drove it, and keeps a shared road book with your friends.

- **Navigation is the vehicle; the co-driver is the reason.** Vetta does turn-by-turn to an address (CarPlay requires it,
  and a driver has to get to the good road and home again), but that is not the pitch. Nav-parity work (lanes, traffic,
  chargers, calendar) gets the minimum needed to not be in the way. See BRAND.md §1 "What Vetta refuses to match".
- **For:** enthusiasts in their own road cars on public back roads, often with a small group of friends.
- **Not:** a racing app, a speed-trap app, a lab tool, a gamer dashboard.

## 2. Principles

1. **Commitment, said honestly.** The Vetta Score rewards using the grip a corner offers, smoothly: Pace (40 %, full
   credit from 85 % of the corner's estimated grip limit, penalised past it), Smooth, Brakes and Rhythm
   (`core/drive_analysis.py`). It never uses absolute or top speed. Crew boards add up shared Scores; Stage times and gaps
   are shared only with the friends and crews you switch on (owner, 2026-11-10). Copy never claims "never how fast";
   it says what the score rewards. No public speed or time leaderboards; lap times only on a mapped raceway.
2. **Unknown stays unknown.** A value that was not measured is `--` or `null`, never 0 and never a guess. A route from map
   shape alone says "From the map only". This rule covers our own certainty too: a measurement shown without saying how
   sure it is (banking from one phone, one pass) is a partial lie. See §4.
3. **Your drives never become evidence against you.** Traces, speeds and times stay on the phone. What is shared is road
   physics (banking, roughness, crests) as anonymous 5 m bins, never a path; friends and crews see only what you switch on
   for them, per friend and per crew. The rules in force are in `docs/ROAD_DATA.md` and `docs/SOCIAL.md` §1.
4. **Cameras and police, in the open.** Vetta shows plate-reading (ALPR) and speed cameras from OpenStreetMap and can
   route around them, and drivers report police as a hazard and as a convoy leader call (owner, 2026-11-10). This is
   legal in the US and common in navigation apps; the listing names it plainly and APP_REVIEW.md covers it. Never
   reported: drunk-driving checkpoints (App Review guidelines allow only checkpoints the police publish). Routing around them is built: Avoid → Cameras,
   and Avoid → Police reports (drivers' live Police reports and a convoy's Police call, `docs/ROUTING.md`; owner, 2026-11-11).
5. **Friends, not the public.** No public boards. Convoys leave nothing stored. Sharing is said once, at the moment you share.
6. **Free to drive.** Driving, pace notes, directions, routes and loops, safety, privacy controls, your drives and your
   exports are free and stay free. Vetta Pro is optional and must never gate safety, privacy or your own data
   (`tests/test_pro.py`). **Pro is looks only** (owner, 2026-11-10): themes (with their voices) and crew liveries. Route
   tuning is free. One Pro member is enough to dress a whole crew.
7. **Your road measurements may be licensed.** The anonymous road data (never people, paths, speeds or times) may one day
   be licensed to cities or map makers (`docs/MONETIZATION.md`, `docs/ROAD_DATA.md` §4). Contributors are told before the
   first sale, in the app and the privacy page, not after.
8. **Calm until the road gets interesting.** The co-driver is quiet in town and on straights and wakes for corners,
   hazards and cameras. One hero number, one call, one warning state on the drive screen.

## 3. The road scores (core/road_dna.py, web/apex_core.js)

Measured 5 m bins are grouped into road sectors (250 m to 2.5 km) and scored 0 to 100. The code names are on the left;
the app says the words on the right (BRAND.md §3).

| code | app word | what it measures |
|---|---|---|
| `TECH` | Technical | corner density, curvature variance, hairpins, grade changes |
| `FLOW` | Flow | sweeper consistency, banking into the turn, speed continuity |
| `SURF` | Surface | smoothness (inverse of > 8 Hz vertical RMS), mid-corner bumps, blind crests |
| `CLEAR` | Clear road | few plate-reading cameras and few junctions; `null` without camera data, never 100 |

## 4. How sure we are (the measurement's limits, said out loud)

- **Banking (camber)** is the gap between the lateral acceleration the turn implies and the one the phone feels
  (`core/live_pipeline.py`). The phone sits on a sprung body, and body roll is **not modelled**: it shifts every corner
  the same way, so averaging many passes does not remove it, and soft cars read corners as less banked. Until a roll
  model or a surveyed reference road exists, banking is shown with how sure it is (one pass, passes that agree, passes
  that differ) and as an approximate figure, never as a precise survey number.
- **The braking ribbon** colours the next 300 m by current speed against a corner speed estimated from map shape, banking
  when measured, and an assumed tyre grip (`MU_EFF_DEFAULT`, dry road), lowered on rough surface. It is an estimate, not a
  target, and is covered in APP_REVIEW.md under 1.4.1.
- **Roughness** depends on the car and the mount; a suspension class from the Garage is planned, not built (ROAD_DATA.md).

## 5. What is actually built (so nobody plans around a ghost)

- **Built:** a web cockpit (`web/`, plain JS, the same page on the website and inside the iOS app's WKWebView); a native iOS
  shell (`ApexNavApp.swift`) for sensors, audio, sign-in and StoreKit; `ApexKit` (Swift: IMU pipeline, mount calibration,
  odometer, journal); a native CarPlay map (`CarPlay/`, MapLibre Native); a Python core (`core/`) that is the reference for
  the math and is parity-tested against `web/apex_core.js` and the Swift live pipeline; a Cloudflare Worker + D1 backend.
- **Signal processing that exists:** zero-phase Butterworth low/high-pass in the offline profiler (`core/kinematics.py`),
  a streaming > 8 Hz high-pass and mount calibration in the live pipeline. The shell lowers music while a call plays.
- **Not built:** a C++ core, an Android app or Android Auto, a Kalman filter, FFT analysis, the "audio DSP bus" that
  drives music stems from driver workload. Treat any doc that describes these as a plan, not a fact.

## 6. Dropped from the old manifesto, and why

| dropped | why |
|---|---|
| "Countermeasure co-driver", "police radar", "zero-snitch enthusiast economy" | The words framed the product as evasion. The features that survive (cameras, police reports, §2.4) are described plainly instead. |
| `CLEAR` as "Stealth / Low Heat" | CLEAR is "Clear road": few plate cameras and few junctions. |
| Octane and "Pioneer bounties" | Renamed Points (first to map a road ×3); points buy cosmetics only. |
| The Halda / Singer / VDO / Group B binnacle: brushed aluminium, drum odometers, toggle switches, the five hex colours | Other people's marks, and not what ships. The look is BRAND.md's Roadbook: paper, ink and one red pen, with the gauges as the only instruments. Theme skins are listed in `web/themes.js`. |
| Physical switches for COP, FLOCK LPR, GRAVEL, REGROUP | The cockpit has Notes, Voice and Cameras; hazards are one Report sheet. |
| A STAGE switch that wakes full pace notes | Notes: Auto / Full / Quiet. |
