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
| Each template used for its purpose: maneuver images show maneuvers only | Design decision: corner calls stay voice-only in CarPlay (a corner isn't a maneuver); hazards use navigation alerts |
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

## 3. What is built (2026-10-28) and how to try it

`CarPlay/ApexCarPlay.swift` and `web/carplay.js`: the page stays the one brain (routing, directions, notes, hazards); the
car's screen shows what it decides and sends back what the driver picks.

- **Root:** our map (route line, position, follow / follow with heading while guiding), Search and Places buttons, zoom,
  recentre and pan map buttons.
- **Search:** Apple's place search near you (CPSearchTemplate); **Places:** recent destinations from the phone.
- **Trip preview:** the cockpit's route options ("Fun 99 · 77 min") as up to three route choices with distance and time;
  picking one switches the route on the phone too; Drive starts the drive.
- **Guidance:** CPNavigationSession with the next maneuver (instruction, street, symbol, distance to it) and the trip's
  distance and time left; End on the car ends the drive; the car's own navigation starting ends it too.
- **Hazards:** every hazard the co-driver calls shows as a navigation alert for 8 s.
- **Not in CarPlay:** scores, crews, friends, Log, settings (guideline: nothing unrelated to the drive).

**Trying it** (Xcode on a Mac): every build carries `com.apple.developer.carplay-maps` (`project.yml`; Apple assigned it to
the account on 2026-10-29). Run the app in an iPhone simulator, then I/O → External
Displays → CarPlay. Screenshots of it are what the entitlement form wants.

## 4. Still to build (after the entitlement arrives)

1. **Entitlement and profile.** Granted 2026-10-29. `com.apple.developer.carplay-maps` is in ApexNav.entitlements for every
   build (project.yml). The App Store Connect API has no CarPlay capability type (it accepts 28, none of them CarPlay),
   so the App ID gets it either from cloud signing (`-allowProvisioningUpdates` on the TestFlight run) or, if that run
   fails to sign, from the portal: Identifiers → com.senft.ApexNav → Capabilities → CarPlay Navigation (OWNER_TODO).
2. **Scenes.** `UIApplicationSceneManifest` with the phone scene, `CPTemplateApplicationScene` and the Dashboard and
   instrument cluster scenes (guide p. 64); delegates keep the interface controller and window.
3. **Engine without the phone screen.** A shared drive engine the CarPlay scene can start on its own: the existing web
   cockpit in a window-less web view (it already runs routing, directions, notes and hazards), talking to the CarPlay
   scene through the same message bridge.
4. **Map.** MapKit in the base view with the route line, position and hazard pins, light or dark from `contentStyle`;
   map buttons for zoom in, zoom out and pan.
5. **Flow.** Root: map template with "Where to?" (search) and "Saved" (pinned places, saved routes, stages near you) →
   trip preview with up to three CPRouteChoices ("Quickest", "Twistiest", "Scenic") → navigation session with
   maneuvers, estimates and reroute → end.
6. **Hazards.** CPNavigationAlert for confirmed hazards ahead (gravel, debris, animal, closure), dismissed by time.
7. **Dashboard and cluster.** The second map and next maneuver; maneuver metadata for the instrument cluster or HUD.
8. **Testing.** CarPlay Simulator presets (748×456, 800×480, 1920×720, 900×1200; cluster presets), light and dark, a
   locked phone, radio playing, a phone call during a prompt (promptStyle none), then a real car.
9. **Review.** APP_REVIEW.md and LISTING.md updated (the listing may say CarPlay only once the build has it).
