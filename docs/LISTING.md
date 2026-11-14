# App Store listing (IDEAS O-09)

Drafted from what the app does today (no CarPlay, no Android, no feature that isn't in the build: guideline 2.3.1).
The owner pastes it into App Store Connect → Vetta → 1.0. `tests/test_listing.py` keeps every field inside Apple's
limits and away from speed claims (guideline 1.4, IDEAS guardrails). Change the text here first, then paste.

**ASO pass (2026-11-14, launch marketing thread).** The name field carries the two search words people type ("twisty
roads") because Apple weights the name most; the app still shows as Vetta under its icon (`CFBundleDisplayName`).
Keywords never repeat a word from the name or subtitle (Apple already indexes those), and drop "navigation" (the
category) and "pace notes" (in the subtitle). If Apple says the name is taken, use "Vetta Drive: Twisty Roads" (25).
Promotional text can be changed any time without a review: refresh it monthly with what's new.

## Name (30)

Vetta: Twisty Roads & Drives

## Subtitle (30)

Co-driver & rally pace notes

## Promotional text (170)

Find the twisty roads near you, hear every corner called before you reach it, and see how cleanly you drove it. Share the best corner with your friends.

## Keywords (100, comma separated, no spaces)

scenic,route,planner,curvy,backroads,car,club,meet,crew,convoy,dashcam,clip,windy,road,trip,map,gps

## Description (4000)

Vetta is a co-driver for people who take the long way home. It calls every corner out loud before you reach it, finds the twisty roads near you, and gets you there and home again with turn-by-turn directions. Afterwards it scores how cleanly you drove.

PACE NOTES, SPOKEN
Corners are called before you reach them, in plain words or rally notes ("left 4 tightens"), with hazards other drivers reported, and crests and bumps on roads that have been measured. The voice runs on the phone and works with no signal. Calls are timed to your speed so you hear them at the entry, not the apex.

FIND THE GOOD ROADS
Ask for a loop of the length you want and Vetta builds one from the twistiest roads around you, or plans a fun route to a destination. Mark the spots you love and loops lean toward them. Plate-reading and speed cameras mapped on OpenStreetMap show on the map, and routes can avoid them.

TURN-BY-TURN NAVIGATION
Search for any address or place, choose between routes, and get spoken turn-by-turn directions ("In 0.3 miles, turn left onto Deals Gap Road") with the next turn on screen, distance and time left, and arrival time. Miss a turn and the route is rebuilt. Directions and notes keep working with the screen off and play over your music, which dips while a prompt plays.

A SCORE FOR EVERY DRIVE
Every drive gets a Vetta Score. The Log shows your drives on the map, corner by corner, and how you are improving on the roads you drive most. Share a drive card with the road's outline and your score.

FILM YOUR BEST CORNER
Mount the phone and Vetta films the drive with the back camera, then cuts your best corner into a vertical clip with its call and the grip you used drawn on it, ready for your friends' feed or a Reel.

DRIVE TOGETHER
Start a convoy with friends and see each other on the map while you drive. Share planned routes with friends and crews, and report hazards (gravel, debris, an animal on the road, a police car) so the drivers behind you hear about them.

YOUR DATA, YOUR SWITCHES
Drives are kept on your phone. Friends and your private crews see what you share with them, and each kind of sharing has its own switch. Privacy zones keep home and work out of everything. Unknown values show as unknown, never guessed. Settings → Your data downloads your drives as GPX or erases them.

SAFETY
Typing is locked while you move. A crash check asks if you are OK after a hard impact and helps you call or text for help; it is a backup to your phone's own crash detection, not a replacement. Always drive within the law and the conditions, and keep your eyes on the road.

Anyone can make an account (Sign in with Apple or Google) to add friends and join crews. Driving, pace notes, loops and the Log all work without one.

## URLs

| field | value |
|---|---|
| Support URL | https://vettadrive.com (the info page, with the contact address hello@vettadrive.com once Email Routing is on) |
| Marketing URL | https://vettadrive.com |
| Privacy policy URL | https://vettadrive.app/privacy.html |

The domains are Nate's (Cloudflare Registrar, 2026-11-14): vettadrive.com is the info page, vettadrive.app the web app and
API. Until the round-two thread has pointed them at the Worker, the same pages answer at apexnav.senftns.workers.dev; paste
the vettadrive URLs only once they load.

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
| Precise location | Yes: hazard reports and shared routes you make, and (signed in, switch on, the default) your saved routes and pinned places, kept on your account for your other phones | Yes (kept with your account; never shown with your name) | No | App functionality |
| Precise location | Yes: road data, only with the switch on (map road id, 5 m section, four road measurements, the road's public map line; never your position or path) | No | No | App functionality, product improvement |
| Precise location | Yes, only if you choose to be shown on the friends map with Exact (sent while driving, delayed as you choose, shown to friends or crews you pick, deleted when you choose Nobody) | Yes | No | App functionality |
| Coarse location | Yes, only if you choose to be shown on the friends map (the default is within a mile, 10 minutes late) | Yes | No | App functionality |
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

Made (2026-11-12): run `STORE=1 SHOTS_OUT=store-shots node tools/landing_shots.js` for six shots at 1320 x 2868 (the 6.9"
size, 440 x 956 points at 3x): the cockpit with a note called (`cockpit.png`), a loop with the others to choose from
(`store-loop.png`), the Log (`store-log.png`), the drive's page with its corners (`store-drive.png`, on Smoothness so no mph
shows), the drive card (`store-card.png`) and a crew's page (`crew.png`). The drive is the bundled Dry Ridge replay saved as a
drive, its own recorded numbers; its page says "Example drive". The cockpit shot still shows the replay's speed (49 mph) and
Sight against the rule above: either accept it (it is a replay, not a live drive) or pick a moment at walking pace with
`SHOT_AT`. The convoy is not scripted; the crew's page stands in for the social shot.
