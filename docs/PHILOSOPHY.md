# APEX NAV — PRODUCT PHILOSOPHY & ARCHITECTURE MANIFESTO

> **Core Thesis**: Existing apps for car people fail because they are either sterile telemetry spreadsheets that look like noisy scientific plots, or clunky social apps bolted onto generic consumer maps. **ApexNav is a tactile motorsport instrument and countermeasure co-driver built for spirited driving—combining the physical soul of a Singer / Group B / Halda Tripmaster cockpit with crowdsourced road-character intelligence, DeFlock/police radar, automatic lead-car convoy telemetry relay, and a zero-snitch enthusiast economy.**

## 1. Visual & Industrial Design Philosophy: "Hardware, Not Web Boxes"
- **Banned Anti-Slop Patterns**: No translucent dark-gray blurred floating boxes, no cyberpunk neon cyan/magenta gradients, no emojis, no blacked-out 3D building boxes, no flickery satellite draped over coarse DEM meshes, and no raw 5-meter confetti speckles.
- **80 / 20 Hardware Split**:
  - **Top 80% — High-Contrast Topographic Stage Map**: Switchable between **Daylight Rally Topo Paper** (warm parchment `#F4EFE6`, terracotta/burnt-sienna routes, charcoal contour lines, olive hillshade) and **Night Stage VDO Phosphor** (matte obsidian `#111210` with warm tungsten-amber `#E89B3C` and cream `#EAE3D2` high-contrast vector roads).
  - **Bottom 20% — Halda Tripmaster Binnacle**: Edge-to-edge brushed-anodized aluminum instrument bezel (`#161615`) with mechanical rolling drum odometers, twin Singer/VDO circular analog dials (Speed/Pace needle + Spirit-Level G-Ball & Camber inclinometer), and physical toggle switches.

## 2. Macro Road Extrapolation Engine (The 4-Axis Stage DNA)
Aggregates 5.0m physics bins into coherent **Road Sectors (`250m – 2.5km`)** scored 0–100 across:
1. **`TECH` (Technicality)**: Corner density, curvature variance $\sigma(\kappa)$, hairpins, and grade transitions.
2. **`FLOW` (Flow & Rhythm)**: Sweeper consistency, positive banking ($\phi > +2^\circ$), and speed continuity.
3. **`SURF` (Surface & Chassis Confidence)**: Smoothness (inverse of $>8\text{ Hz}$ vertical RMS), absence of mid-corner potholes and blind crest unweighting, weighted by the user's **Garage Car Spec**.
4. **`CLEAR` (Stealth / Low Heat)**: Freedom from Flock LPR cameras, speed traps, and dense intersections.

## 3. Speed-Aware Route Line & Adaptive Rally Co-Driver
- **Speed-Aware Braking Ribbon**: Compares live approach speed $v$ against corner target speed $v_{\text{apex}} = \sqrt{R_c \, g \, (\mu_{\text{eff}} + \tan \phi)}$, dynamically shifting the upcoming corner entry ribbon from **Warm Cream/Amber** to **Signal Vermilion Red** when braking is required.
- **Adaptive Co-Driver**: Quiet in cruise (warns only on Flock LPR, cops, convoy hazards, and severe potholes); automatically wakes into full WRC Pace Notes when spirited driving is detected or when `STAGE` is toggled.

## 4. Live Convoy "Lead-Car IMU Relay" & Countermeasures
- **Auto IMU Spike Relay**: When the lead car in a convoy hits a severe pothole ($>0.35g$ vertical spike) or hard-brakes mid-corner ($<-0.55g$), it automatically relays a geo-pinned alert to trailing convoy cars with a 3-second cancel override, alongside physical toggle switches for `COP`, `FLOCK LPR`, `GRAVEL`, and `REGROUP`.

## 5. Zero-Snitch Privacy & "Octane" Bounty Economy
- **Zero Self-Incrimination**: Public road profiles strip individual speeds, timestamps, and user IDs; only speed-invariant road physics and hazard pins are shared.
- **Octane & Pioneer Bounties**: Earn 1× Octane/km on any drive and 3× Pioneer Bounties for mapping unprofiled backroads, adding multi-pass verification, or verifying Flock LPR / pothole hazards.
