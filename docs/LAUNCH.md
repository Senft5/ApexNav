# Launch readiness (2026-10-28)

One list of what an App Store launch of Vetta needs, with where each stands. "Built" means in the repo and tested; the
owner's rows are also in docs/OWNER_TODO.md. Apple's rules in detail: docs/APP_REVIEW.md; CarPlay: docs/CARPLAY.md.

## 1. App Store and Apple's terms

| item | status | who |
|---|---|---|
| App record name **Vetta** (fallback "Vetta Drive"), subtitle, description, keywords, promo text | Drafted in docs/LISTING.md, limits and speed-claim rules tested (tests/test_listing.py) | owner pastes |
| Screenshots, 6.9" iPhone | To make: the app tour (tools/app_tour.js, the app-tour workflow) gives real frames; a set of 5 from the simulator run | Claude, then owner uploads |
| App Privacy answers | Traced in LISTING.md to what the app sends; road class (a public map attribute) added 2026-10-28, not personal data | owner pastes |
| Age rating, category (Navigation), export compliance (`ITSAppUsesNonExemptEncryption: false`) | Set / in LISTING.md | owner confirms |
| Review access past the invite-only sign-up (2.1) | Built (review code, only its hash in the repo); the notes and code go only into App Store Connect, never the public repo | owner pastes |
| Sign in with Apple next to Google (4.8) | Built | — |
| Account deletion in the app (5.1.1(v)) | Built; revoking the Apple token needs the owner's Sign in with Apple key | owner: key |
| No speeding prompts (1.4.1): never a speed above the limit as a target | Built: scores are smoothness, the binnacle shows sight distance (not a speed), pace marks are capped at the limit, the replay keeps to it (docs/REVIEW.md #1–2) | — |
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
| Errors | Built: the app reports error counts (no content, no place) to the Worker; health counts per day |
| Abuse | Built: rate limits per route, moderation and reports, blocks |
| Kill switches | Built: feature flags from the Worker (track mode, taste, crowd curvature; Pro will be one) |
| Security headers | Built: Content-Security-Policy on every page (tools/csp.py), session token in the Keychain |
| Offline | Built: notes and directions run without signal once a route is loaded; offline map areas; reports wait and send later |
| Costs | Workers Free today; Workers Paid ($5/month) once traffic or 30-day Time Travel matter |
| Monitoring an outage | Health counts show drops; no alerting yet. Before launch: a free uptime check on `/api/health` emailing the owner | owner sets up (5 min) |

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
