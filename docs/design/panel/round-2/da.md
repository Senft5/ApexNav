# DA, Dani Okafor, the regular: round 2

Evidence is recording 7 (`scratchpad/r7`). `tabs/phone/016` means that flow's photo. Times are in that flow's video.

## First impressions

Sunday again, coffee, driveway. This time the app opens on my roads. After the tabs-flow drive the deck says "Carolina
Trace Road · 1.3 mi · best 793 · 1 run · Drive", with a second row above it, "Morgan Road · Not driven yet · 3.6 mi from
here · 13 good corners · Drizzle now" (`tabs/phone/021-replay-closed.png`). That is exactly the glovebox I asked for, and
the "not driven yet" row is a better idea than the one I proposed: it tells me where to go as well as where I've been. The
drive's page has "Drive it again" next to Replay (`tabs/phone/016`). Whoever built it, thank you. I'd tell the chat.

The replay also lets go now: Done, and I'm on the map with the tab bar (`021`). I stopped holding my breath.

So here's what's left, and it's the same complaint one level up. The deck now says where the good roads are, and the map
still doesn't show me. `first-run/phone/009-idle-map.png`: a dark street grid, one red arrow, a plate, and below it "Mount
Hope Road, 11 good corners, 6.6 mi". Where is Mount Hope Road? No line, no amber, no hint of which way. The twisty layer
is on by default now and I can't see a trace of it at this zoom. A row of text asking me to trust it is the same problem as
last round in a nicer font.

Second, the route is still not on the map when I look at it. The card opens with the map squeezed into a sliver above it,
the route's first few hundred feet and a dot (`planning/phone/004-route-card.png`). Collapse it to the bar and the car sits
under the weather plate at the top edge with the route running off the screen (`006-route-bar.png`). 9.0 miles, 34
corners, and I can't see the shape of it. That is the moment I decide whether the fun version is worth +7 minutes.

Third, the free drive still opens on the app talking about itself ("Full notes.", `free-drive/transcript.txt`, 02:11) and
the first status line a minute in is "Quiet · Dry Ridge Road · bumps and cameras only" (`free-drive/phone/002`). The road
is named in a status row, not by the co-driver. Fine on a freeway, flat in a driveway.

And the thing my group chat actually wants isn't a leaderboard I thought it did last round. It's "here, drive this".

## Proposals

### DA-1 · Draw the road: a deck row shows its line on the map

**Why.** I can't judge a suggestion I can't see. `first-run/phone/009` has two rows that name roads and a map showing
neither. In 290 guided-drive photos plus nine other flows there isn't a single photo of an amber road or a dashed
suggestion. Call sheet: "Dani's ghost loop isn't built", and the twisty layer on by default hasn't made a visible mark.

**Build.**
- Selecting a deck row (a tap on the row body, not the Drive/Plan key) fits the map to that road's line and draws it in the
  route red, dashed, with the start dot. The key still starts the route. A second tap on the body clears it.
- For "Not driven yet" rows the geometry is already in the tiles the row was found in (`web/your_roads.js`); for my roads
  use the drive's own track.
- Idle at rest, draw the first row's line dim and dashed without a tap, and fit it with my position in view, so the first
  frame shows one road with a name on it. If no geometry, draw nothing.
- Add to `UITests/ReviewFlows.swift` first-run: photograph the idle map with the line, and the row-tap.

**Cost.** M.

**Done looks like.** `first-run/phone/009` has a dashed line leaving the arrow, labelled Mount Hope Road, and a tap on the
row photographs the whole road with the arrow in frame.

### DA-2 · The route stays whole on screen

**Why.** Same finding as round 1's D-5, and it was not built. `planning/phone/004` shows the map in 390 px of a 2000 px
screen with the route's first leg and the car; `006` shows the collapsed bar with the car at the top edge and the route
leaving frame. The card promises "6 more good corners, +7 min" and I can't see any of them.

**Build.** When the card opens, fit the camera to the route and my position within the visible rectangle above the card
(padding by card height, not full screen). When it collapses to the bar, refit within the larger rectangle. Hold follow
off until Start (`holdFollow` in `web/cockpit.js`). Use `.route-bar.two` so "To Winton Woods Middle School" doesn't cut.
Add a check to the planning flow that the route's far end is inside the screen.

**Cost.** S.

**Done looks like.** `planning/phone/006` shows the whole red line with both ends and the car at the start, and the bar's
name is whole.

### DA-3 · The first thing the co-driver says is the road

**Why.** Round 1's D-6 (one vote) is untouched. `free-drive/transcript.txt` 02:11 "Full notes." and `tabs/transcript.txt`
01:53 "Full notes." are the opener; the road is only in the status row. A co-driver who opens with "Full notes" is
announcing a setting. The one who says "Dry Ridge Road. Full notes." is announcing a road, and it costs two words.

**Build.** The opener on Start becomes "<Road>. Full notes." when the road is known (and "Full notes." when it isn't:
unknown stays unknown). Same for Quiet: "<Road>. Quiet from here." Keep the voice packs' own phrasing around it. No new
screen, no calibration line change. Check the car's opener uses the same string.

**Cost.** S.

**Done looks like.** `free-drive/transcript.txt` first line names Dry Ridge Road; `tabs/transcript.txt` the same.

### DA-4 · Send the road, not the score: a link that opens the road as a route

**Why.** My chat doesn't need a leaderboard first, it needs "drive this one". The drive's page has Share, Share card and
Mark a stage (`tabs/phone/016`); the share card is a picture of my 793. Nothing sends the road itself. A friend who gets
"Carolina Trace Road, 1.3 mi, 3 corners" should tap it and get the route card in Vetta, same as the crew-link welcome flow.
This also needs no scores server, no friends graph, and nothing to opt into, so it fits "free forever".

**Build.** A "Send the road" key on the drive's page and next to "Drive it again" on the deck rows: the system share sheet
with a line of text and an `apexnav://` / universal link carrying the drive-it-again waypoints (up to 7 points, which the
"Drive it again" code already builds). Opening it shows the route card with the road's name and corner count; if the app
isn't installed, the link opens the store page. No name or score in the link unless I tick one.

**Cost.** M.

**Done looks like.** The tabs flow photographs the share sheet from the drive's page, and a follow-up photograph shows the
route card opened from the link.

## Did round 1 land?

- D-1 (your roads and Drive it again): yes. Deck rows with best score and runs (`tabs/phone/021`), plus "Not driven yet"
  rows, and "Drive it again" on the drive page (`016`). The end card's third key I didn't verify.
- D-3 (replay gives the app back): yes. `021-replay-closed.png` is the map and tab bar, then Log, People, Garage follow.
- D-5 and D-6: not built, they are DA-2 and DA-3. D-2 landed half: twisty layer on, ghost loop not drawn (DA-1).

## What I'd protect

1. **The drive screen.** In `free-drive/sheet-phone.png` it is still the strip, dial, Limit, Sight, Score that waits. Don't add to it.
2. **The route card's numbers.** 9.0 mi, 23 min "+7 MIN FOR FUN", 34 corners, the profile with corner ticks, Twist 56, and "Surface --" and "Cameras --" honestly empty (`planning/phone/004`).
