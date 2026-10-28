# Monetization (IDEAS L-02)

How ApexNav pays for itself without becoming an app people resent. Drafted 2026-10-28 from the owner's brief: "a
balance that brings profitability without turning away prospective users". Nothing here is live until the owner
approves the price and the free/Pro split (docs/OWNER_TODO.md), and the code ships behind the `pro` flag, off.

## 1. The promise we keep

ApexNav's mission says **zero subscription**. That stays, because it is also the best marketing line we have: every
serious competitor rents itself out by the year (approximate US prices from memory, not yet checked; verify in the
App Store before any of them appears in marketing copy):

| app | model | yearly cost |
|---|---|---|
| Calimoto (motorcycles) | subscription | about $50–60 |
| Kurviger | subscription tiers | about $10–30 |
| REVER | subscription | about $30–40 |
| Roadtrippers | subscription | about $36–60 |
| Waze, Google Maps | free with ads and tracking | $0 and your data |
| **ApexNav** | **free, plus a one-time Pro unlock** | **$0, or one payment once** |

Rules that hold whatever else changes:

1. **Free is a whole app, not a demo.** Someone who never pays can drive, hear pace notes, find twisty roads, build
   loops, keep every drive in the Log, run convoys, join crews and report hazards. A free user should recommend us.
2. **Safety is never sold.** Hazard warnings, closures, the crash check, convoy hazard relays, typing lock, spoken
   directions and pace notes stay free forever. So does CarPlay when it ships (a bigger screen is the safer screen).
3. **The road network is never sold back to the people who built it.** Contributing road data and seeing what
   members measured is free. Contributors earn Octane (cosmetic, S-10) and their names on nothing.
4. **Your own data is never held hostage.** Every drive stays viewable and exportable (GPX, Download my data) for free,
   for ever. Pro adds tools on top of your data; it never takes your data away when a trial ends.
5. **No ads, no tracking, no selling data.** Not even "privacy-friendly" ads. It is what the listing already says.
6. **No paywall while the car moves.** The Pro sheet never opens during a drive or above walking speed, never as a
   launch screen, and a locked feature asks at most once a week. No countdown timers, fake discounts, pre-ticked
   boxes, or "are you sure you want to stay basic?" second screens.
7. **Apple's rules (3.1.1):** every unlock goes through In-App Purchase on iOS; Restore Purchases is always visible;
   Family Sharing is on. Octane can never buy Pro (it would be an unlock outside IAP).

## 2. What is free and what is Pro

The name is **ApexNav Pro**: a product name people understand at a glance. BRAND.md's ban on "pro" and "unlock" as
hype words still holds for every other line of copy (the Pro sheet says "Get Pro", "Try Pro free", never "unlock").

Pro is **depth and creation**: tools for people who drive a lot, plan at a desk, make videos, or go to track days.
They are the people most willing to pay, and holding them back costs a casual driver nothing.

| area | free | Pro |
|---|---|---|
| Pace notes, directions, hazards, closures, crash check | all | — |
| Fun routes, loops, Explore, stage discovery, measured roads | all | — |
| Log | every drive, its map, corners, Driver Score, drive card, GPX export, Download my data | **progress tools**: stage delta against your best on a road (D-05), year and week reviews in full (D-20, D-24), "which road was better" history (S-17) |
| Convoys, crews, friends, kudos, spots, meets | all | — |
| Offline map areas (F-02) | 1 area | unlimited areas |
| Videos: flyover (D-10), dashcam overlay (D-11) | export with a small ApexNav mark in the corner | no mark, higher resolution (1080p / 60 fps where the phone can) |
| Track day mode (D-15) | — | lap and sector timing on raceways |
| Garage (R-20, D-19) | 1 car | unlimited cars |
| Route planning | stops, drag to reshape, saved routes, GPX import | — (kept free: planning is how people find out the app is good) |
| Voices (V-xx) | the default co-driver voice | extra co-driver voices as they ship |
| Spot photos (S-18) | all | — |
| Cockpit accents | bought with Octane (earned only) | — |

Why the watermark rather than a lock on videos: a free user's video with the ApexNav mark is our cheapest ad. Locking
it would remove both the user's fun and the ad.

**Founding drivers.** Everyone with an account before the App Store launch (TestFlight testers and the beta crews,
see MARKETING.md) gets Pro for life, recorded on the server. It thanks the people who measured the first roads, and
it means nobody who has a feature today loses it. (This is an entitlement we grant, not a purchase, which Apple
allows; it is not bought with Octane.)

## 3. Price

| item | type | price (US) | notes |
|---|---|---|---|
| **ApexNav Pro** | non-consumable IAP | **$24.99** | less than half of one year of any subscription above. Launch price **$19.99** for the first 30 days, said plainly ("launch price until 30 Nov"), then $24.99 |
| **Pro trial** | non-consumable, $0 | free | 14 days of every Pro tool, started by the user (never automatic, never asks for payment details). Apple's recommended pattern for trying a one-time unlock. When it ends, Pro tools lock again; nothing made during the trial is deleted |
| **Fuel the road crew** (tip jar) | consumable IAP | $2.99 / $6.99 / $14.99 | buys nothing, says thanks; a small "Supporter" mark on your profile if you want it. In Settings → About only, never prompted |

Proceeds: enrol in Apple's **Small Business Program** (15% commission under $1 M a year), so $24.99 nets about $21.

Web and (later) Android: the same Pro on the same account, bought through Stripe on the website, honoured in the
app (guideline 3.1.3(b) multiplatform services: allowed as long as iOS also offers IAP, and the app never links out
to buy). Not before iOS launch.

## 4. The numbers

Running costs today are almost nil (Cloudflare free tier). At launch, with the router decision (OWNER_TODO Y-04):

| cost | per year |
|---|---|
| Apple Developer Program | $99 |
| Cloudflare Workers Paid (router container, 30-day backups) | $60 |
| Domain (MARKETING.md asks for one) | about $15 |
| **Total** | **about $175** (about $260 if the router is a $7/mo VPS instead) |

**Break-even on cash: about 9–13 Pro sales a year.** Rough first-year range (assumptions, not forecasts; the real
numbers come from App Store Connect after launch):

| | downloads | active after a month | buy Pro | revenue | after costs |
|---|---|---|---|---|---|
| quiet launch | 2,000 | 30% | 4% of active | about $500 | about +$300 |
| steady (the plan in MARKETING.md works) | 10,000 | 35% | 5% | about $3,700 + tips | about +$3,500 |
| a hit in one community (a viral video, a magazine piece) | 50,000 | 35% | 5% | about $18,000 + tips | about +$17,800 |

One-time revenue tails off once early adopters have bought, so long-term profit needs a stream of new drivers, not a
higher price. Later options, all opt-in, all still no subscription: **Pro 2** as a paid upgrade only when it is a
real new version (owners of Pro 1 keep everything); **club packs** for car clubs that run events (crew event tools
beyond what friends need, priced per club once); **curated route packs** by named local drivers with revenue share.
None are built until there are clubs or creators asking.

Rejected, with reasons: ads (break the promise and the privacy stance), selling or "anonymised" licensing of
driver data (same), subscriptions (mission), paid hazard alerts or police/camera alerts (safety is never sold),
affiliate links for tyres and parts (App Review rule in APP_REVIEW.md: no links that sell; also feels like an ad),
loot-box or paid Octane (3.1.1 and it would cheapen Octane).

## 5. How we will know it is balanced

Counted the way app health already is (Y-03: anonymous daily totals, no identifiers, behind the same switch):
Pro sheet shown, trial started, purchased, restored. App Store Connect gives downloads, conversion and refunds. Watch:

| signal | healthy | if not |
|---|---|---|
| 1-star reviews mentioning price or "paywall" | under 5% of ratings | move the item that is named back to free |
| trial → purchase | 15–30% | below 10%: Pro is not worth it yet, build depth before pushing; above 40%: price is low |
| active free users month to month | flat or rising after the paywall ships | the free tier got worse: undo the last move |
| refund rate | under 3% | the sheet promised something the feature doesn't do: fix the copy |

## 6. Building it (code plan, behind the `pro` flag)

1. **Entitlement on the server.** `members.pro_source` (`founding`, `purchase`, `trial`, `web`) and `pro_until`
   (null = for ever). `POST /api/pro/verify` takes the StoreKit 2 signed transaction (JWS), checks its certificate
   chain to Apple Root CA G3, the bundle id and the product id, and records it; `GET /api/me` carries `pro`. A
   founding grant is one SQL update at launch.
2. **StoreKit 2 in the shell.** `Product.products(for:)`, `purchase()`, `Transaction.currentEntitlements` at launch
   and `Transaction.updates` for purchases made elsewhere (Family Sharing, refunds). Bridge messages `proProducts`,
   `proBuy`, `proRestore`; the shell posts `pro` state to the page. Works offline from the device's own entitlement;
   the server copy is for web and Android.
3. **`web/pro.js`.** `ApexPro.has(feature)` from one table (section 2), pure and tested. Each gate is a single call in
   index.html; the Pro sheet is one view (what each tool does, price from StoreKit, Restore, Try free for 14 days).
4. **Rules as tests.** A test fails if a gate is reachable while a drive runs, if a safety feature or GPX/data export
   is behind a gate, or if the sheet has no Restore. APP_REVIEW.md 3.1.1 row and LISTING.md (Pro in the description,
   "In-App Purchases" line) are updated in the same PR that turns the flag on.
5. **App Store Connect.** The products (`com.senft.ApexNav.pro`, `.pro.trial`, `.tip.small|medium|large`) can be
   created through the API key once the owner has signed the **Paid Applications Agreement** and set up banking and
   tax (only the Account Holder can).
