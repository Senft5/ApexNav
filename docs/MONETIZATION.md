# Monetization (IDEAS L-02)

How Vetta makes real money without becoming an app people resent. Rewritten 2026-10-28 after the owner chose a
bigger model than a one-time unlock: **free forever for basic use, Vetta Pro by subscription or lifetime, and a road-data
business that sells answers about roads (never data about people)**. Prices and the exact free/Pro split are a proposal
for the owner to sign off (section 3); nothing is charged until then, and the Pro code ships behind the `pro` flag, off.

## 1. The promises (these never change)

1. **Free forever, and it means it.** Someone who never pays can drive, hear pace notes and spoken directions, find
   twisty roads, build loops, keep every drive in the Log, run convoys, join crews and report hazards. "Free forever"
   is marketing we can stand behind because basic use never needs a payment.
2. **Safety is never sold.** Hazard warnings, closures, the crash check, convoy hazard relays, typing lock, spoken
   directions and pace notes are free. So is CarPlay (a bigger screen is the safer screen).
3. **Contributors are never charged for what they built.** Measured road feel is free to see, and the people who
   measure the most get Pro free (section 4).
4. **Your own data is never held hostage.** Every drive stays viewable and exportable (GPX, Download my data) for free.
   Pro adds tools on top of your data; a lapsed subscription takes nothing away that you made.
5. **No ads, no tracking, and no selling data about people.** Not a driver's position, path, speed, times, scores or
   identity, to anyone (insurers and police included). Section 5 sells anonymous facts about roads.
6. **No dark patterns.** No paywall while the car moves, no paywall at launch, a locked tool mentions Pro at most once
   a week, no countdown timers, no fake discounts, cancel in two taps (Apple's own subscription screen).

## 2. Who we compete with (approximate US prices from memory; verify before any appears in marketing)

| app | what it does | model |
|---|---|---|
| Calimoto (motorcycles) | twisty routes, tracking | subscription, about $50–60 a year |
| Kurviger | curvy routing | tiers, about $10–30 a year |
| REVER | ride tracking, routes | subscription, about $30–40 a year |
| Sideways, Tornante, Pacenote Maps | voice pace notes, scenic routes | free or subscription (Oct 2026 listings) |
| APEX Pro | track lap timing hardware + app | hardware + subscription |
| **Vetta** | pace notes + navigation + measured road feel + crews | **free forever; Pro subscription or lifetime** |

What none of them have, and what Pro sells on: roads measured by drivers' phones (feel, not just shape), a technique
score that teaches, crew convoys with hazard relay, and (with the adapter) the car's own data.

## 3. Free and Pro (proposal for the owner's sign-off)

| area | free forever | Vetta Pro |
|---|---|---|
| Navigation, pace notes, directions, hazards, closures, crash check, CarPlay | all | — |
| Routes: fun routes, loops, Explore, stops, drag to reshape, GPX in and out, saved routes | all | — |
| Measured roads (crowd road feel) on the map and in routing | all | — |
| Convoys, crews, friends, kudos, spots, meets | all | — |
| Log: every drive, its map and corners, Driver Score, drive card, exports | all | — |
| Coaching | the score and its three parts | **corner-by-corner coaching**: where you lost smoothness, run-to-run comparison against your best (D-05), progress on the roads you drive most |
| Offline map areas | 1 area | unlimited |
| Videos (flyover, dashcam overlay) | with a small Vetta mark | clean, up to 1080p 60 |
| Track days (D-15) | — | lap and sector timing on raceways |
| Garage | 1 car | every car, scores per car |
| Car data (Vetta Adapter / OBD, future) | — | live engine data, throttle and brake traces, shift points, temperatures |
| Voices | the default co-driver | every co-driver voice |
| Year and week reviews | the headline | in full |

**Prices (proposal):** Vetta Pro **$5.99 a month**, **$39.99 a year** (a week's trial included), or **Lifetime $99.99**.
Small Business Program commission (15%) makes those about $5.09, $33.99 and $84.99 to us.

**Founders (the early-customer incentive):**
- Everyone with an account before the App Store launch (TestFlight testers, the beta crews in MARKETING.md) gets
  **Lifetime Pro free**, and a Founder mark on their profile that can't be bought later.
- The **first 1,000 Lifetime buyers** after launch pay **$69.99** and get the Founder mark too. The count is shown
  honestly ("612 of 1,000 left"), never a fake timer.
- Both are server-side grants or prices, not something bought with Octane (Apple guideline 3.1.1).

## 4. Pro earned by measuring roads

Road data is what makes Vetta better than a map and what the data business sells, so the people who measure roads
should be paid in Pro: **every 100 km of new road data (sections nobody had measured before) earns a free month**,
shown in the app as progress toward the next month. Delivered as App Store subscription **offer codes** the server
issues to the account (the mechanism Apple provides for granting subscription time). To confirm with App Review before
launch: that an earned offer code for contributing data is acceptable under 3.1.1 and 3.1.2.

## 5. The road-data business (framework now, sales later)

**What history says.** Buyers paid for specific road products: Michelin bought RoadBotics (pavement condition for
cities), Bentley Systems bought Blyncsy (road condition from imagery), Nexar sells road data to cities, Roadroid sold
phone-based roughness surveys. Companies that sold raw driver and location data struggled (Wejo went bankrupt in 2023;
Otonomo struggled and merged). Sell answers about roads; never data about people.

**Products, in the order they become possible:**

| product | buyer | what it is | needs |
|---|---|---|---|
| Pavement condition layer | city and county public works, state DOTs | roughness per 5 m section, as an IRI-calibrated index with confidence and month | calibration against IRI, enough passes in an area |
| Live hazard feed | DOTs, 511 services, fleets | confirmed potholes, debris, closures, with time and confidence | volume of reports |
| Road geometry and feel | map makers, driver-assistance and tyre companies | measured banking, crests, corner radius vs map | measured coverage |
| Driving-road guides | tourism boards, car and motorcycle brands | curated scenic and twisty roads with measured feel | road pages (Q-13) and coverage |
| Car-data aggregates (later) | aftermarket and parts makers | anonymous totals from adapters ("engines on mountain roads run X hot") | the adapter, consent |

**How the data is kept so it can be packaged (built, see docs/ROAD_DATA.md):** every measured section keeps its
road id and direction, the weighted value and a confidence from the number of passes, the month it was last measured,
the class of car that measured it (stiff, medium, soft suspension: never the car or the person), and the version of the
method. An owner-only export writes any area as GeoJSON for a pilot.

**Before anything is sold:**
1. **Consent.** Terms and the privacy page say that anonymous road measurements may be licensed to organisations (cities,
   map makers), and the App Privacy answers say so. Contributors opt in with the Road data switch, as now. Changed
   before the first pilot, not after.
2. **Map licence.** Our sections are keyed to OpenStreetMap ways, whose ODbL licence can require sharing a database
   built from it. A lawyer checks the delivery format first; the likely answer is to deliver positions and our own
   values, not OSM's data.
3. **Calibration.** A drive over a road with a published IRI survey, to map our roughness to IRI.

## 6. The numbers

Running costs at launch are about $175–260 a year (Apple developer program, Workers Paid, domain, router). Break-even is
a handful of subscribers. Rough first-year range (assumptions, not forecasts):

| | downloads | monthly active | Pro (subscription + lifetime) | app revenue | plus data |
|---|---|---|---|---|---|
| quiet | 2,000 | 30% | 4% | about $1,500 | none |
| steady | 10,000 | 35% | 5% | about $8,000–10,000 | a pilot (city) possible in year 2 |
| a hit in one community | 50,000 | 35% | 5% | about $40,000–50,000 | pilots in the launch region |

Subscriptions recur, so year two compounds; data contracts (tens of thousands a year each for a county-wide
pavement survey) are the upside.

## 7. How we will know it is balanced

Counted as app health is (Y-03: anonymous daily totals behind the same switch): Pro sheet shown, trial started,
subscribed, lifetime bought, restored, cancelled. App Store Connect gives conversion, retention and refunds.

| signal | healthy | if not |
|---|---|---|
| 1-star reviews naming price or "paywall" | under 5% | move what's named back to free |
| trial → paid | 30–50% | below 20%: Pro isn't worth it yet, build depth before pushing |
| monthly churn | under 6% | the paid tools aren't used weekly: look at which |
| free users month to month | flat or rising after Pro ships | the free tier got worse: undo the last move |

## 8. Building it (code plan, behind the `pro` flag)

1. **Entitlement on the server** (built and parked on the branch history, commit f670035: StoreKit 2 transaction
   verification pinned to Apple Root CA - G3, founding grant). Extend for subscriptions: `expiresDate` and renewals from
   App Store Server Notifications v2.
2. **StoreKit 2 in the shell**: products, purchase, `Transaction.currentEntitlements`, `Transaction.updates`, Restore.
3. **`web/pro.js`**: one table of Pro tools (section 3), gates as single calls, the Pro sheet, and tests that fail if a
   safety feature, an export or road data is ever behind a gate, or if the sheet can open while the car moves.
4. **App Store Connect**: products `com.senft.ApexNav.pro.monthly`, `.pro.yearly`, `.pro.lifetime`, and the Founder
   price. Needs the owner's Paid Applications Agreement first.
5. APP_REVIEW.md 3.1.1/3.1.2 rows, LISTING.md ("In-App Purchases"), privacy page, all in the PR that turns the flag on.
