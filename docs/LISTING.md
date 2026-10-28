# App Store listing (IDEAS O-09)

Drafted from what the app does today (no CarPlay, no Android, no feature that isn't in the build: guideline 2.3.1).
The owner pastes it into App Store Connect → ApexNav → 1.0. `tests/test_listing.py` keeps every field inside Apple's
limits and away from speed claims (guideline 1.4, IDEAS guardrails). Change the text here first, then paste.

## Name (30)

ApexNav

## Subtitle (30)

Pace notes for back roads

## Promotional text (170)

A co-driver for the long way home: it reads the road ahead out loud, finds the twisty roads near you and scores how smoothly you drove them. Never how fast.

## Keywords (100, comma separated, no spaces)

pace notes,co-driver,twisty roads,scenic drive,back roads,road trip,corners,convoy,car club,driving

## Description (4000)

ApexNav is a co-driver for people who take the long way home. It reads the road ahead out loud, finds the roads worth driving near you, and scores how cleanly you drove them, never how fast.

PACE NOTES, SPOKEN
Corners are called before you reach them, in plain words or rally notes ("left 4 tightens"), with hazards other drivers reported, and crests and bumps on roads that have been measured. The voice runs on the phone and works with no signal. Calls are timed to your speed so you hear them at the entry, not the apex.

FIND THE GOOD ROADS
Ask for a loop of the length you want and ApexNav builds one from the twistiest roads around you, or plans a fun route to a destination. Mark the spots you love and loops lean toward them.

A SCORE FOR TECHNIQUE
Every drive gets a Driver Score from smoothness, braking and consistency. The Log shows your drives on the map, corner by corner, and how you are improving on the roads you drive most. Share a drive card with the road's outline and your score.

DRIVE TOGETHER
Start a convoy with friends and see each other on the map while you drive. Share planned routes with friends and crews, and report hazards (gravel, debris, an animal on the road) so the drivers behind you hear about them.

YOUR DATA STAYS YOURS
Drives are kept on your phone. Nothing is shared until you share it. Privacy zones keep home and work out of everything. Unknown values show as unknown, never guessed. Settings → Your data downloads your drives as GPX or erases them.

SAFETY
Typing is locked while you move. A crash check asks if you are OK after a hard impact and helps you call or text for help; it is a backup to your phone's own crash detection, not a replacement. Always drive within the law and the conditions, and keep your eyes on the road.

ApexNav accounts are by invitation for now. Driving, pace notes, loops and the Log all work without an account.

## URLs

| field | value |
|---|---|
| Support URL | https://apexnav.senftns.workers.dev/ (until a support page exists: O-08) |
| Privacy policy URL | https://apexnav.senftns.workers.dev/privacy.html (after the owner approves it: O-11) |
| Marketing URL | leave empty |

## Category

Primary **Navigation**, secondary **Travel**.

## Age rating answers

Every content question (violence, mature themes, gambling, horror, medical, alcohol, profanity): **None**.
Unrestricted web access: **No** (links open in Safari). **User-generated content: Yes** (handles, crew names, spots, shared
routes, hazard reports), with block, report and moderation in the app (guideline 1.2). Messaging and chat: **No**.
Location sharing with others: **Yes** (convoys, while one runs).

## App Privacy ("nutrition label")

From the real data flows (docs/BACKEND.md, web/privacy.html). Data processed in real time and not kept (convoy
positions, routing and search requests) is not "collected" by Apple's definition.

| data type | collected | linked to the user | tracking | purpose |
|---|---|---|---|---|
| Precise location | Yes: hazard reports and shared routes you make | Yes (kept with your account; never shown with your name) | No | App functionality |
| Precise location | Yes: road data, only with the switch on (map road id, 5 m section, four road measurements; never coordinates) | No | No | App functionality, product improvement |
| Name | Yes (from Google or Apple sign-in) | Yes | No | App functionality |
| Email address | Yes (sign-in) | Yes | No | App functionality |
| User ID | Yes (account id, handle) | Yes | No | App functionality |
| Other user content | Yes (crew names, spots, shared routes, scores you publish) | Yes | No | App functionality |
| Crash data | Yes (error counts with a scrubbed message, no identifiers) | No | No | App functionality |
| Contacts | **No**: the crash-check contact never leaves the phone | | | |
| Health, financial, browsing, search history, purchases, sensitive info | No | | | |

No third-party analytics or advertising SDKs. Tracking: **No**.

## Screenshots (6.9")

Five, from the bundled replays (they need no car): the cockpit with a note called, the loop builder with three routes,
the Log with a drive's corners, a drive card, a convoy on the map. Captions in sentence case, no speeds on screen.
