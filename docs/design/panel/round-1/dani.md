# Dani Okafor, the regular: round 1

Evidence is recording 6 (`scratchpad/r6`). Paths are relative to the pack; `tabs/phone.mp4 @ 04:00` is a time in that
video. Where I read the code to name a cause I say so.

## First impressions

Sunday, 5:50 a.m., driveway, coffee. The group chat says "6:15 at the Shell on Colerain". I open Vetta. The map is my
street, a plate says "Colerain Township · Dry · 59°", and under it one field, one red Start, and "Loop from here · 45 mi ·
On the twistiest roads nearby" (`first-run/phone/009-idle-map.png`). That is the right amount of app for a person
holding a mug. I'd tell the group chat that part, no notes.

Then I press Start and it's good. Honestly better than I expected. It says "Full notes", and twenty seconds later
"Tight right, careful" with 850 feet in hand at 67 (`billet/transcript.txt` 19:37:51), then "Very sharp left, almost
back on itself, long" and "Brake well before this one" with eight seconds to spare, then it shuts up on the straight
and says so. The strip on top reads like a note, the big dial at the bottom reads like a dial, and the Score shows up
after the first clean corner instead of nagging me from zero (`tabs/phone/009-driving.png`: 788 at Rec 0.84 mi). At End
I get the road's name, the distance, 788 in letters the size of my thumb and one sentence I actually believe, "Braking
finished by the middle of each corner, and nothing stands out to fix" (`tabs/phone/014-drive-ended.png`). I have paid
for apps that do less. This one's free. Yes, I'd screenshot that card.

So the drive is better with it than without it. That's the whole product and it works. Here's what I'd say in the chat
after the first weekend, though, and it's the thing I'm here to say to you: **it knows the road, but it doesn't know
me.** My Sunday is the same three roads in rotation. The app has driven them with me, scored them, named them, and the
next Sunday it opens the same way it opened the first time: a blank field and a generic loop. There's no "Dry Ridge Rd
· you've run it 4 times · best 788 · Drive it again". The Log is a filing cabinet; what I want is a glovebox with my
roads in it.

Second thing: the good roads are invisible until you ask. The idle map is a beige suburb (`first-run/phone/009`), and
the one switch that would show me where the twisty stuff is, "Twisty roads", ships off (`first-run/phone/010-layers.png`).
"Loop from here" is the idle map's only invitation, and in nine recorded flows nobody pressed it. I can't tell you if
the loop is any good, and neither can you.

Third: the replay ate the app. I opened a replay from the Log, pressed Done, and seventeen photos later I'm still looking
at "Replay finished · 788" with no tab bar (`tabs/phone/020-log.png` to `036-garage-8.png`). If that happens in my
driveway at 6:10 with three cars waiting, I force-quit and open Google Maps. Everything I love about this app is inside
the drive; everything that annoys me is in the fifteen seconds before and after it.

Would I tell the group chat? Yes, about the co-driver. Would I keep it on the home screen? Only if next Sunday it opens
on my roads.

## Proposals

### D-1 · Drive it again: my roads on the deck and on every drive's page

**Why.** The app forgets what it just taught me. After a drive the Log page offers Replay, Compare, Share, Share card,
Mark a stage (`tabs/phone/015-in-the-log.png`), and the one thing a regular wants, drive this road again, isn't there.
Next morning the deck shows the same "Loop from here · 45 mi" it showed a stranger (`free-drive/phone/021-after.png`,
taken right after a drive ended; identical to `first-run/phone/009`). The plan sheet's "places to go without typing" are
recent destinations and spots (`web/cockpit.js:3361`, read in code), not roads. The thing I come back for every Sunday
has no home in the app.

**Build.**
- A "Drive it again" key on the drive's page (`web/drive_view.js`), next to Replay. It builds a route from where I am to
  the road's start, then the road itself, using the drive's own track (`web/saved_routes.js` already packs a route for
  offline; pack the drive's shape the same way). Same key on the end card (`web/end_line.js`), as the third action.
- "Your roads" on the idle deck (`web/index.html` under `#loopSuggest`): up to three rows, one per road I've driven
  most recently, each "Dry Ridge Rd · 23 mi · best 788 · 4 runs", a tap builds the route. The rows come from
  `web/road_runs.js` (it already splits a drive into whole named roads). Roadbook the row like the route-bar, not a
  card. The generic loop stays as the last row when there's room, and is the only row until I've driven something.
- A drive with no named road long enough (the free-drive's Circle Freeway) gets no row; unknown stays unknown.

**Cost.** M.

**Done looks like.** A flow that ends a drive, returns to the map, and photographs the deck with the road just driven
on it; then opens that drive's page, taps Drive it again, and photographs the route card with the road's name and the
corner count.

### D-2 · Show me the good roads before I ask

**Why.** Getting to a good road is the first thing I judge, and the idle map tells me nothing. `first-run/phone/009` is
a street grid; the "Twisty roads" layer is off by default (`first-run/phone/010`, and `web/cockpit.js:135` `twisty:
false`, read in code), and the "Loop from here" invitation is a sentence, not a line on the map. Nine flows, 334 phone
photos, and not one shows a twisty-road highlight or a suggested loop drawn. I'm being asked to trust that the app
knows the roads near me with no proof on the screen.

**Build.**
- Twisty roads on by default on the idle map (the `toggles.twisty` default, and the `apex-twisty` layer's visibility at
  `web/cockpit.js:396`-`399`). Keep it amber as it is now; keep it off while driving if it costs frames.
- The suggested loop drawn as a ghost: when the map is idle and the deck shows "Loop from here", run the loop finder once
  in the background and draw its line dashed and dim, with the deck row renamed to what it found, "Loop from here · 45
  mi · via Dry Ridge Rd and Pippin Rd". `web/cockpit.js:4763` `paintLoopSuggest` is the place; the loop finder is behind
  `findLoopBtn`. If the finder takes more than a few seconds or fails, the row stays as it is and nothing is drawn.
- Add the loop to the recording: `UITests/ReviewFlows.swift` planning flow taps the deck row and photographs the loop
  on the map and its card.

**Cost.** M.

**Done looks like.** The first-run's idle map has amber on the roads that deserve it and a dashed loop leaving my
street; the planning flow has a photo of the loop's route card with corners and Twist on it.

### D-3 · Done means done: the replay must give the app back

**Why.** In the tabs flow the test opened the drive's replay (`tabs/phone/018-replay.png`), then tried to go to Log,
People and Garage. Every one of the next seventeen photos is the replay, first running (`020-log.png` to `023-log-3.png`,
"MEDIUM RIGHT", the Play key) and then "Replay finished · 788 ×" with Again, 1× 2× 4× 8× and Done (`024-friends.png` to
`036-garage-8.png`). No tab bar in any of them. The rig taps "Done" and the Replay chip before each tab
(`UITests/ReviewFlows.swift` `tab()` and `closeReplay()`, read in code) and it still didn't close. The page's
`closeReplay` returns early when `state.mode === 'live'` (`web/cockpit.js:6266`); a replay opened straight after a live
drive may be in exactly that state. Whatever the cause, a regular hits this on the first Sunday: end a drive, watch the
replay, want the map back.

**Build.** Make Done, the "Replay · road ×" chip and the Log tab all leave the replay no matter what mode the page was
in before it; show the tab bar whenever the replay transport is up (the replay is a page, not a drive); and make
`closeReplay` the one path that also restores the idle deck. Keep a regression step in the tabs flow that fails loudly
if the tab bar isn't back within a few seconds of Done.

**Cost.** S.

**Done looks like.** `tabs/phone/020-log.png` is the Log list, `024-friends.png` is People, `028-garage.png` is the
Garage.

### D-4 · The road's board: my friends' scores on the road I just drove, and one key to send it

**Why.** Three of us drive the same roads every week. The end card gives me my 788; the only comparison the app offers
is with "your best other drive on this road" (`web/drive_view.js:417`, read in code), and the crew page has a Vetta Score
board that ranks people, not roads (`web/crew_page.js:4`). What I'd actually show the chat is "Dry Ridge Rd: Dani 788,
Marcus 771, Jo 802". Nothing in the recording comes close: People is an invite button and an example row
(`signed-in/phone/001-friends.png`), Crews is "1 crew near you" (`003-crews.png`). Free forever means the thing that
brings us back has to be each other, and today the app can't tell me what my friends did on my road.

**Build.**
- On the end card and the drive's page, a "This road" block under the score: friends' best Vetta Score on the same
  named road (matched by `web/road_runs.js` names, in the same direction), newest first, me underlined as the crew board
  does. Friends who haven't shared scores (the Scores grant, `web/cockpit.js:4280`) don't appear, and the block says
  "Friends' scores show here once they share them" in one line, not a paragraph.
- Server: scores are already published per drive (`publishScore` in `web/sync.js`); add the road name and direction to
  the published score and an endpoint that returns friends' best per road. This is the L part.
- A "Send to the crew" key beside Share card that posts the share card and the board line into the crew chat
  (`web/crew_page.js` has the chat).

**Cost.** L.

**Done looks like.** The signed-in flow's drive ends with two names under the score, and the crew chat shows the card.

### D-5 · The route you just chose must stay on the map

**Why.** I pick Winton Woods, the card opens (`planning/phone/004-route-card.png`), I collapse it to see the route,
and the map recentres on my car with the route off screen: `planning/phone/007-route-bar.png` shows Jason Drive,
Jeremy Court and Lincolnshire Road and no red line. Review 5 said the same about recording 5. It's still there in
recording 6. For a regular this is the moment I decide whether the fun version of the route is worth +7 minutes, and I
can't see it.

**Build.** When the card collapses to the bar, fit the camera to the whole route with the car in it (the same fit the
card used when it opened), and hold follow until Start is pressed (`holdFollow` at `web/cockpit.js:852` exists for the
app's own camera moves). The bar's name should use the two-line style that exists (`.route-bar.two`,
`web/index.html:249`) instead of cutting "Middle School".

**Cost.** S.

**Done looks like.** `planning/phone/007` shows the whole red route, both ends, with the car at one of them.

### D-6 · Start from the car, every time, in one tap

**Why.** The free drive is the thing I'd use most on a weekday: no route, just the co-driver on whatever road I'm on.
The flow shows it works from the car's Drive key (`free-drive/car/001-idle.png`, `002-drive-started-from-car.png`) and
the phone follows. What's missing is the driveway case on the phone: Start is one tap, good, but the first 25 seconds
are "Calibrating · drive normally" with the Sight plate reading "--" (`free-drive/phone/002`, `003`) and the co-driver
silent until "Full notes" (`free-drive/transcript.txt` 20:01:27, 13 s after the car moved; `billet/transcript.txt`
19:37:33, 25 s). On the freeway the drive then runs five miles with "OPEN" stamped under the car and ends with "Not
enough clean corners for a score this time" (`free-drive/phone/020-drive-ended.png`). All honest. But a regular wants
the first thing the co-driver says to be about the road, not about itself.

**Build.** Say the road, not the state: the first line after Start is "Dry Ridge Road. Notes on." (the quiet line
already names the road, `free-drive/phone/002` "Quiet · Dry Ridge Road"), and "Full notes" is folded into it. Drop the
"Calibrating · drive normally" line from the status row when the phone was mounted on the last drive (keep it in the
car's card for a new mount). The end card for a drive with no corners should say what it was, "3.1 mi on Circle Freeway ·
no corners to score", in the score's slot, instead of "-- /1000" plus a sentence.

**Cost.** S.

**Done looks like.** The free-drive transcript's first line names the road; the end card for the freeway reads as a
drive, not a failed exam.

## What I'd protect

1. **The drive screen and the call timing.** The strip (distance, tulip, call, next as a code), the dial, the Limit sign,
   Sight, the drum, the Score that waits for a clean corner, and calls that land 4 to 9 seconds out with "careful" said
   twice in nine minutes (`billet/transcript.txt`, `tabs/phone/005-driving.png`). Don't let anyone add a thing to it.
2. **The route card's honesty about fun.** "23 min · +7 MIN FOR FUN", "For Buell Road 1.6 mi, Pippin Road 1.4 mi · 6
   more good corners", the two tiles "Fun 45 · 23 min · this one" / "Fun 37 · 16 min · 7 min quicker", and the
   Quick/Fun/Max fun switch (`planning/phone/004`, `005`). That's the pitch to my friends in one screen.
3. **The end card.** Road name, three numbers, the score big, one sentence, two keys, and the sign-off line in the
   co-driver's voice ("That's the last corner. Lovely road. Score seven hundred eighty-eight.", `tabs/transcript.txt`
   19:41:13). It's the screenshot. Leave it alone.
