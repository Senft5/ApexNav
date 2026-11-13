# Launch readiness (2026-10-28)

One list of what an App Store launch of Vetta needs, with where each stands. "Built" means in the repo and tested; the
owner's rows are also in docs/OWNER_TODO.md. Apple's rules in detail: docs/APP_REVIEW.md; CarPlay: docs/CARPLAY.md.

## 1. App Store and Apple's terms

| item | status | who |
|---|---|---|
| App record name **Vetta** (fallback "Vetta Drive"), subtitle, description, keywords, promo text | Drafted in docs/LISTING.md, limits and speed-claim rules tested (tests/test_listing.py) | owner pastes |
| Screenshots, 6.9" iPhone | Made 2026-11-12: six at 1320 x 2868 from `STORE=1 node tools/landing_shots.js` (LISTING.md says which); the owner picks the set and the order | owner picks and uploads |
| App Privacy answers | Traced in LISTING.md to what the app sends; road class (a public map attribute) added 2026-10-28, not personal data | owner pastes |
| Age rating, category (Navigation), export compliance (`ITSAppUsesNonExemptEncryption: false`) | Set / in LISTING.md | owner confirms |
| Review access (2.1) | No gate since 2026-10-30 (REVIEW_PEOPLE P-02): a reviewer signs in with Apple or Google and is a member. The old review code still answers yes for builds from before; the notes (drives need a car, the bundled replays show the cockpit) go only into App Store Connect, never the public repo | owner pastes |
| Sign in with Apple next to Google (4.8) | Built | — |
| Account deletion in the app (5.1.1(v)) | Built, and the Apple token is revoked on deletion (#503); that call waits for the owner's Sign in with Apple key and three Worker secrets (OWNER_TODO.md), and deletion works without them. Turning off Apple sign-in for Vetta in iOS Settings signs the app out (#514) | owner: key |
| No speeding prompts (1.4.1): never a speed above the limit as a target | Built: scores are smoothness, the binnacle's Sight cell is a braking range (the speed you could stop from within what you can see), shown red when you're above it, and the review notes say so; the demo replay keeps to the limit (docs/REVIEW.md #1–2) | — |
| Driver distraction: typing locked while moving, no Pro sheet while moving | Built (in_car.js); Pro rules are tests once Pro ships | — |
| In-app purchases (3.1.1 / 3.1.2) | Not shipped. Plan in MONETIZATION.md; needs the owner's yes to the prices and the Paid Applications Agreement | owner |
| CarPlay entitlement | Built and in simulator builds; the owner submits the request (CARPLAY.md section 1) with simulator screenshots | owner submits |
| Terms and Privacy pages | Live under the Vetta name (web/terms.html, web/privacy.html); the road-data licensing sentence goes in before any data pilot (ROAD_DATA.md) | — |
| Third-party licences | web/licenses.html, THIRD_PARTY_NOTICES.md | — |
| Support URL and contact address | Needs the domain and an address (CAN-SPAM for email too) | owner: domain |

## 2. Running it

| item | status |
|---|---|
| Backups | Built: D1 Time Travel, a weekly copy to KV by cron, monthly export by hand (BACKUPS.md). Note a Time Travel bookmark before every hand-applied migration (0029 was additive, applied 2026-10-28) |
| Clean-up | Built: daily sweep of expired sessions, codes and invites |
| Errors | Built: the page reports error counts (no content, no place) to the Worker, and the iPhone app sends iOS's crash and freeze reports (MetricKit, #523) to the same place; health counts per day |
| Abuse | Built: rate limits per route, moderation and reports, blocks |
| Kill switches | Built: feature flags from the Worker (track mode, taste, crowd curvature; Pro will be one) |
| Security headers | Built: Content-Security-Policy on every page (tools/csp.py), session token in the Keychain |
| Offline | Built: website requests give up after 30 s like the app's (#538), and the website opens from its kept copy when the network answers nothing (#552); notes and directions run without signal once a route is loaded; offline map areas; reports wait and send later; a whole drive records, scores and saves with no signal (checked 2026-11-12), and the map says when it has no map |
| Costs | Workers Free today; Workers Paid ($5/month) once traffic or 30-day Time Travel matter. **Free has hard daily caps across the account**, and once one is used up, everything fails until midnight UTC: D1 allows 100,000 rows written a day, and road-data upload writes at least 200 rows per km driven (one per 5 m bin, measured in the local D1 on 2026-11-13; index writes add more), so at most about 500 km of uploaded driving a day uses it all and sign-in, publishing and the rest stop with it. The API then answers 503 `service_unavailable` with Retry-After. Other caps: 5 million D1 rows read, 100,000 requests and 1,000 KV writes (photos) a day. Free also allows only 10 ms of CPU a request (Paid: 30 s). In the local test Worker, the road data for a map view of 10,000 bins (`/api/roads`, 50 ways) took about 20 ms beyond the database read, so busy areas will likely fail with error 1102 on Free once enough roads are measured. Move to Paid before more than a handful of people upload drives |
| Monitoring an outage | Built: the status workflow checks the site, `/api/health` and the weekly backup and daily sweep every 30 minutes and opens an "outage" issue (GitHub emails the owner); STATUS.md | — |

## 3. Quality bar before submitting

- The app tour (browser with sound, and the simulator) has no open S1 or S2 rows in docs/REVIEW.md.
- `testKeyboard` passes: no text field under the keyboard on any tab.
- TestFlight build driven on a real road: notes on time, directions, a reroute, a hazard report, the drive saved, the
  Live Activity, CarPlay audio. The owner's drive is the last gate; Claude can't drive.
- VoiceOver and larger text on every screen (IDEAS U-15), checked in the simulator.

## 4. Brand and legal around the name

| item | status | who |
|---|---|---|
| Name in the app, listing, pages, marketing | Done (code identifiers keep ApexNav; users never see them) | — |
| Trademark: attorney knockout for VETTA in classes 9 and 42, then USPTO filing | Not started | owner |
| Domain vettadrive.com / vettadrive.app, email routing | Not bought | owner |
| Social handles (same handle everywhere) | Not made | owner |
