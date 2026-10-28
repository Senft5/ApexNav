# App Store review readiness

What Apple's App Review Guidelines ask of ApexNav, what already holds, and what is still open. Every agent that
changes the iOS shell, sign-in, social features, data collection or the store listing checks this page first and
updates it in the same PR. Guideline numbers refer to https://developer.apple.com/app-store/review/guidelines/.

Checked 2026-10-28 against main and App Store Connect (read through the API key in the cloud session:
`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID`).

## App Store Connect today

| item | state |
|---|---|
| App record | ApexNav, `com.senft.ApexNav`, Apple ID 6827831098, version 1.0 "Prepare for Submission" |
| Builds | uploaded by CI on every app-changing merge to main (docs/TESTFLIGHT.md); 342.1 and 349.1 VALID, no export-compliance question |
| TestFlight | internal group "First Testers", access to all builds |
| Bundle ID capabilities | In-App Purchase (Apple's default) and Sign in with Apple (enabled 2026-10-28 through the API). A second, unused App ID `com.senft.ApexNav.JNX759T5W6` (App Groups) exists from an earlier attempt; harmless, the owner may delete it |

## Holds today

| guideline | how |
|---|---|
| 5.1.1(v) account deletion in the app | Account → Delete account (`DELETE /api/me`, erases the account and what others hold about it) |
| 5.1.1(ii) permission strings | location, always-location and motion strings in project.yml say what each is for |
| 5.1.2 diagnostics | app health counts (Y-03) are anonymous daily totals with a switch in Settings → Your data, declared as Other diagnostic data, not linked (docs/LISTING.md) |
| 5.1.2 data use and sharing | road data is opt-in (ROAD DATA switch), never coordinates or speeds (contributor.js), random private km at each trip end, privacy zones (Z-02) |
| 1.2 user-generated content | block from every social surface, one report sheet, 3 reports hide an item, owner moderation queue (#120). Crew drives (S-06) are reportable too (kind `event`); remove cancels the drive |
| 2.5.2 no downloaded code | the web cockpit is bundled in the app (`web/` as a folder resource); the web view loads only `apexnav://` pages, http(s) opens in Safari (#135). No page loads a remote script, and the website's live voice engine (transformers.js from a CDN) is never loaded in the app: the switch is hidden and `voice.js` refuses (`tests/test_no_downloaded_code.py`) |
| 2.5.4 background modes | `location` for spoken turn-by-turn directions (V-04) and pace notes and recording a drive with the screen off; `audio` for spoken notes over other audio. Both are core features a reviewer will see in a drive |
| 4.0 design, iPhone only | `TARGETED_DEVICE_FAMILY = 1`; Dynamic Type on reading pages (U-15) |
| 5.2 third-party content | OpenStreetMap/OpenFreeMap attribution on the map and in Settings → Sources and licences |
| Export compliance | `ITSAppUsesNonExemptEncryption = NO` (HTTPS only) |
| 1.4.1 safety claims | Crash check (D-17) is described in the app and policy as a backup to the phone's own crash detection, never a replacement; it never calls or texts by itself (the driver or someone with them taps `tel:`/`sms:` links), so it makes no claim it can't keep. Keep listing copy the same: no "we call for help" |
| 1.4 physical harm | no speed leaderboards or top-speed records anywhere (guardrails in IDEAS.md), typing locked while moving (C-08), performance timing parked (D-14). Keep listing copy about flow, smoothness and finding good roads, never racing or speed |

## Open before the first App Store submission

| id | guideline | what | who |
|---|---|---|---|
| O-11 | 5.1.1(i), 1.2 | **Privacy policy and terms of use** (drafted: web/privacy.html, web/terms.html; linked in Settings and at sign-in; waiting on the owner's approval and a contact address) as pages on the site, linked in Settings and at sign-in, with the policy URL in App Store Connect. Terms must include a no-tolerance rule for objectionable content and abusive users (1.2). Claude drafts from the real data flows; the owner approves the legal text (Z-07) | Claude, then owner |
| O-05 | 4.8, 5.1.1(v) | **Sign in with Apple** (built: native sheet, Worker verification, entitlement, capability. Open: on account deletion the Apple token must be revoked through Apple's REST API, which needs a Sign in with Apple key the owner creates). The app offers Google sign-in, so it must also offer Sign in with Apple (or an equivalent that limits data to name and email and lets people hide their email). Native `ASAuthorizationAppleIDProvider` in the shell, the token verified by the Worker against Apple's keys (`aud` = bundle ID), the `com.apple.developer.applesignin` entitlement, and the capability on the bundle ID (the API key can enable it) | Claude |
| O-12 | 2.1 | **Reviewer access** (built: a review code in "Join with an invite" makes the account a member; only its sha256 is in `auth.ts`; the plain code and the notes go only into App Store Connect's private App Review Information). Sign-in needs a membership invite, so App Review needs a way in: a review account or a reviewer sign-in code in the App Review notes, plus notes explaining that drives need a car (the bundled replays show the cockpit without one) | Claude, owner pastes the notes |
| O-09 | 2.3 | **Listing** (drafted in docs/LISTING.md, limits checked by tests/test_listing.py; screenshots still to make)**:** description, keywords, support URL, screenshots (6.9" iPhone), App Privacy answers (precise location: collected for app functionality, not linked to identity when shared as road data; account email and name: linked; crash data: not linked) | Claude drafts, owner submits |
| O-13 | 4.2 | **Not a thin web wrapper.** The app's value is native: CoreMotion IMU at 100 Hz, background GPS, the voice route to the car stereo, CarPlay (C-01/C-02 when the entitlement comes). Keep adding native surfaces (Live Activity U-11, widgets U-10) and say so in the review notes | Claude |

## Rules for every PR

- No new data leaves the phone without an on-screen reason and a switch; add it to the privacy policy in the same PR.
- No new permission without its Info.plist string saying what it is for, asked at the moment it is needed.
- No paid feature or unlock outside In-App Purchase (3.1.1). Octane rewards stay cosmetic and free.
- No external links that sell anything. Nothing that ranks speed.
