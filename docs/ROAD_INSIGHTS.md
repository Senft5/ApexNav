# Road insights: the plan for a sellable data product

Plan only (2026-11-15). **Nothing is sold, and no sale or export feature is built.** Vetta would sell **aggregate facts
about road sections**, never a drive, a trip, a path or a person. This builds on docs/ROAD_DATA.md (what each 5 m
section keeps) and docs/MONETIZATION.md §5 (the road-data business).

## 1. What to sell, and who buys it

| product | what the buyer gets | buyers | realistic price (our estimate, as a small new seller) | needs first |
|---|---|---|---|---|
| **Pavement condition** | roughness per section, IRI-calibrated, with confidence and month | city/county public works, state DOTs | $10k–40k a year per county; more per state district | IRI calibration, coverage in one metro |
| **Corner and braking hotspots** | per section: speed percentiles (p50/p85), share of hard braking, peak lateral g, by month | DOT safety teams (HSIP, Vision Zero), insurers' *road* risk models | $10k–50k per county study; $25k–150k a year statewide | k-thresholds (§3), lawyer review |
| **Road geometry and feel** | measured banking, crests, true corner radius vs the map | map makers, driver-assist and tyre companies | $50k–250k a year, only with wide coverage | large coverage (years out) |
| **Road use by hour** | a relative busy-ness index per road by hour of week (an index, not counts) | planners, tourism boards | low; $5k–20k per study | hour-of-drive data, now off (§4) |
| **Cohort reports** | e.g. "corner speeds on rural roads by age band", as a PDF report | insurers' research teams, car brands | $5k–25k per report | age band, large k (§3) |
| **Driving-road guides** | curated great roads with measured feel | tourism boards, car and motorcycle brands | $2k–20k per campaign | road pages and coverage |

**Who we won't sell to:** police or anyone for enforcement, anyone for pricing or scoring an individual driver, and data
brokers (resale is banned by contract, §5).

**What the market says** (anchors, not quotes for us):
- **StreetLight** (big incumbent, all trip types): San Mateo County's C/CAG contract was $275k year 1, $363k years 2–3.
  State DOTs buy "regional subscriptions" (VDOT, MnDOT); prices are rarely published.
- **INRIX / HERE probe speeds**: negotiated per deal and per road mile. USDOT's I-95 study priced probe speed data at
  about $900 per centreline mile up front vs $26,000 for roadside sensors (2010 figures).
- **Arity** (Allstate): sells driving-behaviour data gathered through other apps' SDKs; sued by Texas in Jan 2025.
- **Wejo** collapsed into administration in 2023: $8.4M revenue against a $159M loss in 2022, data sold at a loss.
  **Otonomo** also struggled and merged away. Raw driver data is a bad business; road answers sell (Michelin bought
  RoadBotics, Bentley bought Blyncsy).

**Honest caveats:** our drivers are enthusiasts on fun roads, so speed and use data are not representative of all traffic
(fine for pavement and geometry, a weakness for speeds and volumes). Selling enthusiast corner speeds also carries a
trust risk: "Vetta sells how fast you take corners" is a bad headline. Pavement is the safest first product.

## 2. The legal path (United States)

| rule | what it means for us |
|---|---|
| **FTC Act §5** | The FTC banned X-Mode/Outlogic (Jan 2024) and InMarket (Jan 2024) from selling precise location data, sued Kochava (2022), and settled with Gravy/Venntel and Mobilewalla (Dec 2024). Lessons: calling data "anonymized" protects nothing, consent must be informed, and a privacy page that says "sells no data" makes any sale deceptive until it is changed. In Jan 2025 the FTC also moved to bar GM from sharing driving data with consumer reporting agencies. |
| **State privacy laws** (about 20 states, incl. TX, VA, CO, CT, and our neighbours IN and KY from 2026; Ohio has none yet) | Precise geolocation (within 1,750 ft) is **sensitive data**: opt-in consent to process it, and a data protection assessment before selling. Texas applies to small businesses too, and it sued GM (2024) and Allstate/Arity (2025). |
| **Maryland MODPA** (in force Oct 2025) | Bans *selling* sensitive data outright, even with consent. Personal data from Maryland users can never be sold; only true aggregates can. |
| **California CCPA/CPRA** | A "Do not sell or share" link and "Limit use of my sensitive information" if we sell personal information. Applies above $25M revenue, 100k consumers, **or 50% of revenue from selling personal info**. |
| **The way through: deidentified data** | All these laws exclude deidentified data if (1) it can't reasonably be linked to a person, (2) we publicly commit not to re-identify it, and (3) every buyer is contractually bound not to. Section aggregates that pass §3 are built to meet this test. A lawyer confirms it before the first sale. |
| **Apple** | Guideline 5.1.2: no sharing user data without permission. Apple counts **sharing user or device data with data brokers as tracking**, which needs the ATT prompt. Aggregates with no user or device id are not tracking; anything per user or per device would be, so it is never sold. The App Privacy answers must say data is collected for "analytics / product" and "not linked to you" before launch. |
| **OpenStreetMap ODbL** | Sections are keyed to OSM ways; deliver our own values with positions, and have a lawyer check the format (ROAD_DATA.md §4). |

## 3. Privacy techniques (the rules every release must pass)

1. **Aggregate to road sections only.** Section × direction × period (a month, or a quarter on quiet roads). Never a
   trip, a sequence of sections, an origin or destination. Origin–destination products are never built.
2. **k-anonymity floor.** A cell is released only with **≥ 10 distinct contributors** in that period; **≥ 20** when split
   by age band or hour. Below that it is withheld (unknown stays unknown), not rounded.
3. **Through roads only.** Motorway to tertiary and long unclassified roads; never residential, service, tracks, dead ends,
   or sections within 300 m of a road's end. Trip ends are already trimmed 0.5–1.5 km and privacy zones skipped.
4. **Coarse time and people.** Month, never the day. Hour-of-week only as an index on through roads. Age in broad bands
   (18–24, 25–34, 35–49, 50–64, 65+), dropped where a band falls under k.
5. **Differential privacy on the release.** Bound each contributor to one value per cell per period, then add calibrated
   noise to counts and means (an open library such as OpenDP), with a fixed privacy budget per release (start at ε ≈ 1
   a month). On busy roads the noise is invisible; on thin ones it hides any one person.
6. **A re-identification test before every release**, written down: try to pick out one known test driver (the owner's
   own drives) from the release. If it can be done, the release doesn't ship.

## 4. Consent and policy changes needed before any sale

1. **A separate opt-in switch** for sold insights ("Share road insights with partners"), **off by default**, apart from
   "Help improve Vetta roads" (internal). Plain words on what is sold and to whom; the reward can be Pro months, as
   MONETIZATION §4 gives measurers.
2. **Privacy page and Terms** (web/privacy.html says today "sells no data" and "never your position, your path, speeds or
   times"): rewrite to say exactly what aggregates are licensed, the public no-re-identification promise, and the
   buyer list (cities, DOTs, map makers). Changed and announced **before** the first pilot, never after.
3. **Hour of drive and speed per section:** collected only after the privacy page says so (it promises that today). Both
   are already open owner decisions in docs/OWNER_TODO.md (Q-03 speed ratio, R-36 quiet hours, built and off).
4. **Age band:** optional, in the profile, broad bands only, never required and never shown to anyone.
5. **"Do not sell or share" link** on the site and in Settings once anything is sold, even below the CCPA thresholds.
6. **A written data protection assessment** (required in VA, CO, CT and others for sensitive data and sales).
7. **Buyer contract:** no re-identification, no resale, no joining with other location data, no use about individuals,
   no enforcement use, audit right, delete on termination.
8. **MONETIZATION.md promise 5** gets reworded to "no data about people; aggregate facts about road sections may
   include speeds", with the owner's sign-off.

## 5. When is it worth selling

- **Per section:** ≥ 10 distinct contributors a period (§3), or it isn't released at all.
- **Per product:** a buyer wants most of an area, not a few roads. Target **≥ 70% of a county's arterial and collector
  miles** released in the last 12 months. Our rough guess is **1,000–3,000 monthly active contributors in one metro**
  (Cincinnati first) to get there, because enthusiasts cluster on fun roads.
- **Realistic timing:** a free pilot with one county engineer (Hamilton County or ODOT District 8) once one metro is
  covered; first paid deal in year 2. App subscriptions are the money until then.

## 6. Next steps (in order)

1. **Now:** keep collecting under today's privacy page; the anonymous drive upload stays internal only and is never sold.
2. ~~Count distinct contributors without ids~~ **done** (§7): per road and direction, all time; per period is still to do.
3. **IRI calibration drive** on a road with a published survey (ROAD_DATA.md §4).
4. **Owner (docs/OWNER_TODO.md):** a privacy lawyer reviews §2–§4 (flat-fee review, a few thousand dollars).
5. Release pipeline: k filter and DP noise **done** (§7, internal keys only); the written re-identification test is next.
6. Change consent and policy (§4), then run the free pilot, then price the first deal.

## 7. What is built (2026-11-15)

**data.vettadrive.com**: a map viewer (web/insights.html) and an API (backend/src/road_insights.ts). Nothing is sold.

- **Viewer:** colours roads by roughness, banking, off-camber, crests, flow or hard braking; tap a road for its figures.
  Without a key it shows **web/insights-sample.geojson**: real OpenStreetMap road lines with **made-up** values, labelled
  as made up everywhere (tools/insights_sample.py builds it). With a key it shows the real released roads in view.
- **API:** `GET /api/data/v1/roads.geojson?bbox=s,w,n,e` (key, ≤ 1° a side), `GET /api/data/v1/meta` (public).
- **Rules in code:** through roads only; **≥ 10 distinct established drivers** per road and direction (`road_floor` now
  keeps up to 50 hmac holders, never ids, so it can count past two; no new table); month only; values clipped and
  Laplace-noised (ε = 1 per metric per month, scale from the driver count, the same draw on every ask); confidence as a
  band (fair, good, high), never a count.
- **Keys:** `python tools/data_key.py` makes one. Its sha256 goes in `DATA_OWNER_KEYS` (internal, works now) or
  `DATA_API_KEYS` (a partner: refused with `partner_access_not_open` until the `road_data_partners` flag is turned on,
  which waits for §4).
- **Not yet:** per-section (5 m) figures, IRI calibration, hour of day, age bands, per-key usage metering.
