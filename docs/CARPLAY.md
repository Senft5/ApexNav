# CarPlay

Vetta's CarPlay plan: the entitlement request, what Apple's CarPlay Developer Guide (October 2026) requires of a
navigation app, where the app stands, and what gets built once the entitlement is granted. IDEAS C-01, C-02.

## 1. The request (the owner submits it)

Form: https://developer.apple.com/contact/carplay/ (signed in as the Account Holder of the developer account). Apple
reviews whether the app fits the category and assigns the entitlement to the account; nothing has to be built in CarPlay
first (CarPlay code can't even run until the entitlement is granted). The form's exact fields may differ from these;
use the answer that matches each question.

| question | answer |
|---|---|
| Entitlement / category | **CarPlay Navigation app** (`com.apple.developer.carplay-maps`) |
| App name | Vetta |
| Bundle ID | com.senft.ApexNav |
| Apple ID (App Store Connect) | 6827831098 |
| On the App Store? | Not yet: in TestFlight, first submission planned after CarPlay is in place |
| Countries | United States |
| Other platforms | iPhone only (Android Auto later) |

**Describe your app (short):**

> Vetta is turn-by-turn navigation for drivers who choose the scenic, winding way. Drivers search for a destination,
> choose between route options (the quickest, or one over more enjoyable roads), and follow spoken turn-by-turn
> directions with the next maneuver, distance remaining and arrival time. Off-route detection rebuilds the route. It
> also warns of hazards other drivers reported ahead (debris, gravel, closures) and calls upcoming corners by
> severity, like a rally co-driver, so the driver knows what the road does next.

**How will your app use CarPlay?**

> The full navigation flow in CarPlay with the CarPlay framework's navigation templates: destination search
> (CPSearchTemplate) and lists of saved places and recent destinations (CPListTemplate); trip previews with up to three
> route choices (CPTrip, CPRouteChoice); active guidance with CPNavigationSession, CPManeuver symbols in light and dark
> variants, instruction variants, and continuously updated travel estimates; rerouting; and reported road hazards as
> CPNavigationAlert. Our own map is drawn in the base view (route line, position, hazards) with zoom and pan buttons
> and touch gestures. Voice prompts use the .playback category, .voicePrompt mode, duckOthers and
> interruptSpokenAudioAndMixWithOthers, are active only while speaking, and respect promptStyle. We plan to support the
> CarPlay Dashboard and instrument cluster scenes and share upcoming maneuvers with the vehicle. Nothing in CarPlay
> asks the driver to use the iPhone, and there are no social features, scores, games or settings in CarPlay.

**Anything else Apple should know:**

> Spoken directions and corner calls work without signal once a route is loaded, which matters on rural mountain
> roads. Typing is locked on the iPhone while the car is moving. We will follow the CarPlay guidelines and respond to
> any feedback from Apple or automakers.

**Screenshots** (the form asks for them): `docs/carplay/1-search.png` (destination search), `2-route.png` (route
card with time, distance and route options), `3-guidance.png` (guidance: the next turn, distance to it, time left and
arrival). They are the real cockpit with live map tiles and the public router, taken by `node tools/carplay_shots.js`;
screenshots from a TestFlight build on the phone work as well or better.

Then agree to the **CarPlay Entitlement Addendum** (the owner reads it; it is a legal agreement).

## 2. Requirements and where we stand

From the guide's "Guidelines for all CarPlay apps" and "Additional guidelines for CarPlay navigation apps".

| requirement | status |
|---|---|
| Designed primarily for the category: turn-by-turn directions with upcoming maneuvers | Yes on iPhone: place search, route choice, spoken directions (V-04), next turn in the note strip, live ETA, reroute. The App Store listing now leads with navigation (docs/LISTING.md) |
| Voice prompts: `.playback`, `.voicePrompt`, `.duckOthers` + `.interruptSpokenAudioAndMixWithOthers`, active only while playing | Done (`configureVoiceSession`, ApexNavApp.swift). Low-priority cruise lines (not maneuvers) mix without ducking (V-08) |
| Check `promptStyle` before each prompt: none = silent, short = a tone, normal = speak | Done: native speech and the web voice clips both ask the shell first; the shell plays a short tone for `short` |
| Base view draws only the map; all controls through templates | Built (`CarPlay/ApexCarPlay.swift`): MapKit route line and position; search, places, End and map buttons are templates |
| Pan button when panning exists; touch gestures only for pan, zoom, pitch, rotate | Built: zoom in, zoom out, recentre and pan map buttons; panning through the template's panning interface |
| Each template used for its purpose: maneuver images show maneuvers only | Design decision (reversed 2026-10-29, docs/CALL_SHEET.md): a corner you must slow for is a maneuver, so the next corner or turn, whichever is first, is the card's maneuver, with a corner tulip; `CAR_CORNERS = 'tight'` (web/index.html) keeps only 1, 2 and hairpins if review disagrees. Hazards use navigation alerts |
| Stop guidance immediately when the car's own navigation starts (`mapTemplateDidCancelNavigation`) | Built: ends the drive |
| All CarPlay flows possible without touching the iPhone, including with it locked | Partly: search, route choice, start, guidance and end all work from the car while the app is running on the phone (locked is fine: background location and audio keep it alive). Still to build: starting the route engine (the cockpit page) when CarPlay launches the app cold, in a window-less web view |
| Never tell the driver to pick up the iPhone | Built: the only CarPlay error says what happened ("Couldn't plan the route yet. Try again in a moment."); starting from the car skips the phone's explainer sheet |
| No gaming or social networking in CarPlay; nothing unrelated to the drive (settings, account) | Crews, friends, kudos, scores, Log and Settings stay on the iPhone |
| Map appropriate in each supported country | United States only at launch |
| Light and dark map (`contentStyle`) | Built: the MapKit base view follows the car screen's appearance |
| Maneuver symbols at the guide's sizes, light and dark variants | Built: SF Symbols per Valhalla maneuver type, as template images CarPlay tints for light and dark |
| Templates within depth limits (navigation: 5) | Plan below uses at most 3 |
| Widgets in CarPlay (iOS 26): a widget that only opens the app on iPhone sets `disfavoredLocations([.carPlay])` | The Start-a-drive widget opens the app; once Vetta is a CarPlay app it opens it in CarPlay too, so it is set when the CarPlay build lands |
| Live Activities in CarPlay (iOS 26) | Already shown: without the small family CarPlay uses the compact Dynamic Island views (distance, next note). The small family can be added with the CarPlay build |

## 3. What is built (2026-10-29, rebuilt after the owner's first drive) and how to try it

`CarPlay/ApexCarPlay.swift`, `web/carplay.js` and the car's map (`web/carmap.html`, `web/carmap.js`). The cockpit page stays
the one brain (routing, directions, notes, hazards, the voice); it runs in `ApexEngine` (ApexNavApp.swift) whether or not
the phone's window was ever opened, so the car can open Vetta cold. Mockups: docs/design/carplay (blue tags Apple draws,
yellow tags we do).

- **Our map in the base view:** the phone's theme (Roadbook, Tapedeck, Billet: the same OpenFreeMap style, palettes, hill
  shading and contours, web/basemap.js), day or night from the car's screen; the route, every corner's rating at its apex
  (tight ones filled), the hazard plate for reported hazards, the position puck; following the car heading-up while
  guiding, the whole route in a trip preview. It takes no touches: Apple's templates own every control.
- **Root:** Where to? and Loops on the left, Places on the right; pan, zoom in, zoom out and the voice (mute) as map buttons.
- **Where to?:** Apple's place search near you; **Loops:** 30 minutes, 1 hour or 2 hours, a twisty loop from where you are;
  **Places:** recent destinations from the phone.
- **Trip preview:** up to three route choices ("Fun 99 · 77 min", "32.6 mi · 186 corners"); picking one switches the route on
  the phone too; Drive starts the drive.
- **Guidance:** the maneuver card in the theme's dark (`guidanceBackgroundColor`) with the road book's tulip as the symbol
  (drawn by the page, web/carplay.js tulipSVG; corners, interleaved with turns, cornerTulipSVG), distance and time to it, trip estimates; End; the car's own navigation
  starting ends ours. While driving the map buttons are Report, voice, zoom in and zoom out.
- **Hazards:** a called hazard is a navigation alert with the hazard plate; passing a reported one asks "Still there?" with
  Still there and Gone; Report opens a grid of the six kinds.
- **Voice:** the theme's voice pack, played by the shell (`ApexClipPlayer`), so a locked phone still speaks in the pack's
  voice, ducking the car's audio.
- **Dashboard and instrument cluster:** our map again in the CarPlay Dashboard and, in cars that have one, the instrument
  cluster; the system shows the maneuver from the navigation session.
- **Not in CarPlay:** scores, crews, friends, Log, settings (guideline: nothing unrelated to the drive).

**Trying it** (Xcode on a Mac): run the app in an iPhone simulator, then I/O → External Displays → CarPlay; or the
`carplay-shots` workflow on GitHub's Mac (workflow_dispatch) for screenshots.

## 4. Still to do

1. **Lane guidance** (`CPLaneGuidance`, iOS 17.4+) once the router's lane data reaches the page's steps.
2. **Testing in cars and presets:** CarPlay Simulator presets (748×456, 800×480, 1920×720, 900×1200; cluster presets), light
   and dark, a locked phone, radio playing, a phone call during a prompt (promptStyle none), then a real car.
3. **Review.** APP_REVIEW.md and LISTING.md updated (the listing may say CarPlay only once the build has it).
