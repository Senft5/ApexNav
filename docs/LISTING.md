# App Store listing (IDEAS O-09)

Drafted from what the app does today (no CarPlay, no Android, no feature that isn't in the build: guideline 2.3.1).
The owner pastes it into App Store Connect → Vetta → 1.0. `tests/test_listing.py` keeps every field inside Apple's
limits and away from speed claims (guideline 1.4, IDEAS guardrails). Change the text here first, then paste.

## Name (30)

Vetta

## Subtitle (30)

Navigation for back roads

## Promotional text (170)

Turn-by-turn navigation for the long way home: spoken directions and pace notes for every corner, routes over the twistiest roads nearby, and a score for smooth driving.

## Keywords (100, comma separated, no spaces)

navigation,gps,pace notes,co-driver,twisty roads,scenic drive,back roads,road trip,convoy,car club

## Description (4000)

Vetta is turn-by-turn navigation for people who take the long way home. Search for a destination, pick the fun route or the quick one, and follow spoken directions with the next turn on screen and a live arrival time. Along the way it reads every corner out loud like a rally co-driver, and afterwards it scores how cleanly you drove, never how fast.

TURN-BY-TURN NAVIGATION
Search for any address or place, choose between routes, and get spoken turn-by-turn directions ("In 0.3 miles, turn left onto Deals Gap Road") with the next turn on screen, distance and time left, and arrival time. Miss a turn and the route is rebuilt. Directions and notes keep working with the screen off and play over your music, which dips while a prompt plays.

PACE NOTES, SPOKEN
Corners are called before you reach them, in plain words or rally notes ("left 4 tightens"), with hazards other drivers reported, and crests and bumps on roads that have been measured. The voice runs on the phone and works with no signal. Calls are timed to your speed so you hear them at the entry, not the apex.

FIND THE GOOD ROADS
Ask for a loop of the length you want and Vetta builds one from the twistiest roads around you, or plans a fun route to a destination. Mark the spots you love and loops lean toward them.

A SCORE FOR EVERY DRIVE
Every drive gets a Vetta Score. The Log shows your drives on the map, corner by corner, and how you are improving on the roads you drive most. Share a drive card with the road's outline and your score.

DRIVE TOGETHER
Start a convoy with friends and see each other on the map while you drive. Share planned routes with friends and crews, and report hazards (gravel, debris, an animal on the road) so the drivers behind you hear about them.

YOUR DATA STAYS YOURS
Drives are kept on your phone. Nothing is shared until you share it. Privacy zones keep home and work out of everything. Unknown values show as unknown, never guessed. Settings → Your data downloads your drives as GPX or erases them.

SAFETY
Typing is locked while you move. A crash check asks if you are OK after a hard impact and helps you call or text for help; it is a backup to your phone's own crash detection, not a replacement. Always drive within the law and the conditions, and keep your eyes on the road.

Vetta accounts are by invitation for now. Driving, pace notes, loops and the Log all work without an account.

## URLs

| field | value |
|---|---|
| Support URL | https://apexnav.senftns.workers.dev/about.html (the landing page; its footer needs the owner's contact address, O-11) |
| Marketing URL | https://apexnav.senftns.workers.dev/about.html |
| Privacy policy URL | https://apexnav.senftns.workers.dev/privacy.html (after the owner approves it: O-11) |

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
| Precise location | Yes: road data, only with the switch on (map road id, 5 m section, four road measurements, the road's public map line; never your position or path) | No | No | App functionality, product improvement |
| Name | Yes (from Google or Apple sign-in) | Yes | No | App functionality |
| Email address | Yes (sign-in) | Yes | No | App functionality |
| User ID | Yes (account id, handle) | Yes | No | App functionality |
| Other user content | Yes (crew names and mottos, crew chat messages, build threads and replies, spots, shared routes, scores you publish) | Yes | No | App functionality |
| Photos or videos | Yes: photos you add to your profile, your cars, a crew or a build thread (redrawn on the phone, every metadata segment removed on the server; no location) | Yes | No | App functionality |
| Crash data | Yes (error counts with a scrubbed message, no identifiers) | No | No | App functionality |
| Other diagnostic data | Yes (daily totals: routes found/failed, uploads failed, mount set time; switch in Settings) | No | No | App functionality, analytics |
| Customer support | Yes (Settings → Feedback: what you write, with optional diagnostics: app version, device type, screen, language, error count) | Only when you ask for a reply (your handle) | No | App functionality |
| Contacts | **No**: the crash-check contact never leaves the phone | | | |
| Health, financial, browsing, search history, purchases, sensitive info | No | | | |

No third-party analytics or advertising SDKs. Tracking: **No**.

## Screenshots (6.9")

Five, from the bundled replays (they need no car): the cockpit with a note called, the loop builder with three routes,
the Log with a drive's corners, a drive card, a convoy on the map. Captions in sentence case, no speeds on screen.
