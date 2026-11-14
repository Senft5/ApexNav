# Social engine: faceless short video (TikTok, Reels, Shorts)

Nate (2026-11-14): social media only until it's proven. No clubs, meets, DMs, group or Reddit posts, creators.
Nobody on camera: every post is footage the app made. Same file to all three apps, posted about 7 PM Eastern with
each app's own free scheduler (TikTok web, Meta Business Suite, YouTube Studio). Music is added inside each app from
its licensed library, never baked into the file. Rules: MARKETING.md sections 2 and 8 (no speed on screen, never
"fast", "race", "beat the time"; real footage and numbers only).

## The week

| day | post | in the app | length |
|---|---|---|---|
| Mon | Corner of the week | Log → drive → best corner → Share (corner_clip.js) | 10–15 s |
| Tue | Road reveal | Replay → Video (flyover_video.js) | 15–25 s |
| Wed | Ghost run | Log → compare → side by side (ghost_clip.js) | 10–20 s |
| Fri | Weekend loop | Where to? → loop; screen-record the route being drawn (route_reveal.js) | 10–15 s |
| Sat | The score | End card → Share card (drive_card.js), as a photo or carousel | photo |

Bio link: vettadrive.com during the beta; from launch day, straight to `https://apps.apple.com/app/id<APP_ID>?pt=<PT>&ct=social`
(the same App Store id and provider token the Social thread's `APP_STORE_ID` / `APP_STORE_PT` in web/cockpit.js use), so
App Store Connect counts social downloads with no page in between.

Bank 10 before the first goes up. After 30 days, double the type with the most views; "proven" means downloads
from the `ct=social` App Store link in App Store Connect.

## Captions (one hook line, one Vetta line, 3–5 tags)

**Corner of the week**
```
{One line on the corner: "The left after the bridge tightens twice."} The co-driver called it.
Vetta calls every corner before you get there. Free on iPhone, link in bio.
#drivingroads #backroads #{car} #{place} #cartok
```

**Road reveal**
```
{N} corners in {M} miles, {T} min from {city}. {Road name}, {county}.
Found by Vetta, the app that finds the twisty roads near you. Link in bio.
#drivingroads #roadtrip #{place} #scenicdrive #cartok
```

**Ghost run**
```
Same corner, {two weeks} apart. Smoother on the right.
Vetta films your drive and puts your best pass beside this one. Link in bio.
#drivingroads #{car} #carsoftiktok #driving
```

**Weekend loop**
```
Your Saturday drive, sorted: a {N}-mile loop from {town}, {K} good corners.
Vetta builds loops from the twistiest roads near you. Link in bio.
#weekenddrive #backroads #{place} #drivingroads
```

**The score**
```
Scored {score}. Where did I lose it? (Hint: corner {k}.)
Vetta scores how smoothly you drove, corner by corner. Link in bio.
#{car} #drivingroads #cartok
```

Tags to rotate in: car `#miata #gr86 #brz #civicsi #gti #mustang #e46 #wrx #porsche`; place `#cincinnati #ohio
#kentucky #indiana #ohiodrives`. Never more than 5; never the same set twice in a row.

## Hooks that fit the brand (first 2 seconds, on screen)

- "Would you take this one blind?"
- "The co-driver saw it before I did."
- "This road isn't on anyone's list. It should be."
- "{N} corners. One straight."
- "Rate this line, 1 to 10."
