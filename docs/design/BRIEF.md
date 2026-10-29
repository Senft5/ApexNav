# Design brief: Vetta

## The owner's words (2026-10-29, verbatim)

> I was going to send a bunch of screenshots of ui issues and bugs, but i realized that the main issue isn't even the bugs,
> it's the design philosophy in general. [...] I want the app to feel more fun and less like a list of capabilities with
> boring buttons. Not goofy, but not sterile. I enjoy the roadbook theme, but I feel like we need more themes as well at some
> point to seal the deal, likely hidden behind the pro membership. One could be a vintage head unit (the beautiful lcd with
> the dolphin) or clean sterile skeumorphic metal with glowing red gauges and indicators. Each theme will come with a voice
> pack that suites its character, and we will do away with custom voices. No emojis should be used in the design. Everything
> should be bespoke and tactile. Visual design should speak to function. It should be intuitive enough for a new user to pick
> it up and use every basic function, yet advanced enough behind the scenes and under the hood that a power user can take full
> advantage of special routing parameters and event organization and crew pages. Crew pages should be highly customizable and
> more pro "boosters" (prob shouldn't steal the discord term) should equal more customization. We also need things like photo
> uploads for cars and pfp and crew photos and such. I would also like something akin to martini works build threads that
> allows users to share their car build over time and get feedback and suggestions and chat. Also something that allows you
> to see other users on the map with an opt in and map layer toggle.

("The beautiful lcd with the dolphin": the late-90s/2000s Alpine/Kenwood/Pioneer head-unit look: segmented VFD/LCD glow,
spectrum bars, animated mascot-style dot-matrix graphics. "Martini Works build threads": a car-forum build log, one post per
stage of a build, photos, comments.)

## What Vetta is

Free-forever navigation for people who take the long way: turn-by-turn directions plus rally-style spoken pace notes for every
corner, routes over the twistiest roads nearby, measured road feel (bumps, banking, crests) crowd-sourced from phones, the
Vetta Score for every drive, crews and convoys. iPhone app (a web cockpit in a native shell) with CarPlay. Brand: docs in
this folder (BRAND.md, PHILOSOPHY.md). Pro is planned (subscription or lifetime), not shipped.

## What exists today (screens in screens/, day-* and night-*, 390x844 JPEGs)

- **Onboarding**: 3 steps (logo + tagline; pick a co-driver voice; sign in or not now).
- **Map (cockpit)**: map with the vehicle, a "Where to?" bar with Start, a side tab opening switches (notes level, voice,
  cameras, twisty roads, measured roads, 3D terrain, haptics, night), the tab bar (Map, Log, Stages, Crew, Settings).
- **Plan sheet**: search, From field, Tap the map / Open GPX, Loop (15/30/45 mi, 1 h, 2 h), Explore (15/30 min), Roads
  (Quick/Fun/Max fun), Avoid (highways, tolls, ferries, unpaved, towns, cameras), Hairpins/Sweepers fewer/more.
- **Route card**: name, distance/time/corners, scenic stops and fuel, climb, road character ahead, forecast, Fun/Twist/Flow
  bars, camera/road-feel line, route options, Drive it / Preview / Save / Share / Share ETA / GPX / Pin place.
- **Driving**: road book strip on top (distance, tulip diagram, call; next two notes), map, drive status (Rec, time left,
  arrival), Report / End drive, the binnacle (speed dial, Limit, Sight = the speed you could stop within what you can see,
  odometer, a g-ball "brake" dial), lane arrows at junctions. Hazard report sheet. Replay of a demo drive.
- **Log**: totals, year so far, week, monthly challenges, drive list; a drive's detail (replay, compare, share, tags, notes,
  Driver Score, corner traces, grip circle).
- **Stages**: user-made timed stretches of road, created from a drive's elevation profile.
- **Crew**: signed out (sign in); member (you, invite, friends, convoy, routes shared with you, spots near you, crew drives,
  garage, crews, crews near you, points board).
- **Settings**: road data, privacy zones, crash check, units, driving side, look (theme Roadbook only today, accents), voice,
  feedback, your data, spots, map motion, sources.
- **CarPlay**: built (map, search, places, trip preview with route choices, turn-by-turn, hazard alerts), no screenshots yet.

## What the owner wants from you

A full design review and a direction, not bug-fixes:
1. **Diagnosis**: why it feels like "a list of capabilities with boring buttons" (screen by screen, with the screenshots).
2. **Design philosophy**: principles for "fun but not goofy, bespoke and tactile, visual design speaks to function, no
   emojis", and how the roadbook theme becomes a system other themes can plug into.
3. **Information architecture and flows**: easy for a new user to do every basic thing; power under the hood (routing
   parameters, event organisation, crew pages) without cluttering the basics. Progressive disclosure, where each thing lives.
4. **Themes as Pro**: at least Roadbook (current, refined), a vintage head unit (VFD/LCD, dot-matrix), and machined metal
   with glowing red gauges. What a theme changes (type, colour, gauges, map style, motion, sound, the voice pack that comes
   with it); custom voices go away. What stays identical across themes for safety (hazard colours, legibility, layout of
   driving-critical information).
5. **New social surfaces**: highly customisable crew pages where more Pro supporter "boosts" (name it; not "boosts") unlock
   more customisation; photo uploads (car, profile, crew); build threads (a car's build log over time with photos, feedback,
   suggestions, chat); friends on the map (opt-in, a map layer toggle, privacy defaults).
6. **Mockups** for the key screens so the engineer can build from them: at minimum the map/cockpit idle, the plan flow, the
   route card, driving (in two themes), a crew page, a build thread, and the theme picker.
