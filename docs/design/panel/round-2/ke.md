# Round 2: Kenji Watanabe (KE)

44. I grew up driving Akagi and Haruna before the sun came up in a Gunma winter. These days it's Colorado and an NA
Miata, and I carry a camera on every pass. I judge whether an app makes me want to leave the house at 5 a.m., and
whether it remembers the road the way I do.

## 1. First impressions

The app knows a road's shape. It just never shows it to me.

Someone here understands corners. The welcome is a moving road book (first-run 002-007: "300 OPEN LEFT, TIGHTENS"),
and that's the best first five seconds of any driving app I've used. Tapedeck at night (tapedeck-night 040) has real
character: cyan VFD digits, the dot-matrix fox, and "That's the B-side done" at the end. The drive page's elevation
trace (guided-drive 289) is honest work. I respect all of that.

Then look at the moments where a photographer would stop the car. The drive ends, the card says **DRIVE SAVED, Dry
Ridge Rd**, and the map above it is black: one arrow, a POTHOLE plate, a CAFÉ plate and no road (guided-drive 286). In
the tabs flow it's the same, just an arrow on hillshade (tabs 015). The code already draws the trail and fits the
camera to it (`showEndTrail` in `web/cockpit.js`), but neither recording shows it. On a pass you look back at the road
you just drove. Here you look back at nothing.

Before the drive it's the same problem. The idle map suggests "Mount Hope Road · 11 good corners · Dry now" (first-run
009). That's a good sentence, but it sits next to a generic tulip glyph that would look the same for any road. The
route card puts a 9-mile drive in a window that shows about 300 m of red line beside a housing tract (planning 005). It
has "56 TWIST, 23 FLOW", which are numbers. It never shows me the road as a place: its silhouette, where it climbs,
where the light will be.

The Log is a lab notebook: a 600, four bars, a paragraph about coasting, then speed, g and g again (guided-drive 287,
289). Useful the morning after, but none of it is a memory. A drive that happened at 10:48 PM looks the same as one
that happened at sunrise. Nothing says it was dark, what the sky was doing, or that you stopped at the top.

The truth from where I sit: Vetta has built the instruments and forgotten the landscape. The road is always data and
never a place. It should make me want to go, and then let me keep the drive afterwards.

## 2. Proposals

### KE-1: The drive ends on the road's portrait (and the share card is that portrait)

**Why it matters.** The end of a drive is the emotional peak, and right now the screen is black. guided-drive 286 and
tabs 015 both show the end card over an empty map with no trail, even though `showEndTrail` exists. Either the fit
lands on the wrong spot or the layer draws under the basemap. Either way the user sees nothing. The share card
(`drive_card.js`) already makes a silhouette, but it's a button away, and on this screen the black map says "nothing
happened here".

**What to build.**
- Fix the end trail so it actually shows in both recordings. Check the layer order against the basemap and the fit
  after `map.stop()`. Add a rig assertion that the end card's map region contains route-coloured pixels.
- Put the road's portrait in the card's top half: the trimmed silhouette from `drive_card.js` (same 800 m trim, same
  privacy), drawn in the theme's ink, with the elevation profile as a thin band under it. Use the map trail only when
  it renders. Otherwise use the silhouette, which needs no tiles and works offline.
- Add one line of light and weather, from what's already known: "After dark · Dry · 57°" or "Sunrise drive · sun up
  7:41". This needs `sun.js` and the place plate's weather at the drive's start. Leave out anything unknown.
- Make Share card share exactly this picture, so the card you see is the card you send.

**Cost:** M.

**Done looks like.** In r8 guided-drive's drive-ended photo, the top half shows the shape of Dry Ridge Rd with its
climbs under it, and "After dark" appears under the name. I would screenshot it without being asked.

### KE-2: Show me the road before you ask me to drive it

**Why it matters.** The suggestion rows name a road and give a reason (round 1 landed that), but the glyph is the same
for Mount Hope Road and for "Loop from here" (first-run 009, tabs 022). The route card's map shows a sliver of the
route next to a school, and the most interesting things (the archetype, the shape, the climbs) are hidden or missing
(planning 004-005). `route_thumb.js` already draws a route as SVG, and `road_page.js` already knows a road's archetype
("Esses", "Switchbacks"). Neither reaches me when I'm deciding.

**What to build.**
- Replace each suggestion row's glyph with a `route_thumb` of that road's real geometry (north up, theme ink, 44 pt).
- On the route card, open with the map fitted to the whole route. Today the card covers all but a sliver of it.
- Put the road page's archetype word in the headline slot: "Dry Ridge Rd · Esses · climbs 482 ft".
- Tapping the road name in a suggestion row opens the road page (`road_page.js`), where the archetype is shown.
- Unknown archetype: no word.

**Cost:** M.

**Done looks like.** In r8 first-run 009 the two rows have different drawings, and you can tell the loop from the
straight-ish road at a glance. In planning 004 the whole route is visible above the card, with the archetype word.

### KE-3: Light is part of the road: "when to go" on the route card

**Why it matters.** Every good pass I know has a right hour. The app already computes the sun (`sun.js`) and low-sun
glare minutes (`FunRoute.glare`, the "Low sun ahead" line in `cockpit.js`). On the route card, though, the only sky
information is "Forecast along the way: no rain, ice or fog" (planning 005). The Sunday suggestion (round 1) is the
right place to say "go at dawn", and it doesn't.

**What to build.**
- Add one fact row to the route card: "Sun up 7:41 · down 17:12", computed at the route's midpoint. Add "low sun ahead
  ~4 min at 2.1 mi" when glare ≥ 3 min, which is already computed.
- When it's dark now, say so plainly ("After dark: no views, watch for deer"). Show the deer half only where the map
  has woodland. Otherwise drop it.
- The once-a-week Reminder (opt-in) may name the hour: "Sunrise 7:41 on Mount Hope Rd". No streak words, still at most
  one a week.

**Cost:** S.

**Done looks like.** In planning 005 there's a sun row with real times, and nothing on the card is invented.

### KE-4: A photo on the drive, taken parked

**Why it matters.** The brief asks for car photos. For people like me, the photo at the overlook *is* the drive. The
Log page (guided-drive 287) has replay, compare, share and three graphs, and no picture. `spot_photos.js` already
strips EXIF and keeps photos on the phone. `scenic.js` already knows the viewpoints along a route.

**What to build.**
- Add a photo slot at the top of a drive's Log page and on the end card. It uses the `spot_photos` pipeline: re-drawn,
  no EXIF, on this phone only. The camera and picker are offered only while parked or after End, never while moving.
- When a planned route passes a mapped viewpoint, the route card lists it as a stop ("Viewpoint at 6.3 mi"). The car
  says nothing about it while driving.
- The share card can use the photo as its background, with the silhouette over it.

**Cost:** M. APP_REVIEW: photo library and camera purpose strings.

**Done looks like.** A drive in the Log opens on my photo of the car at the top of the pass, with the road's line drawn
over it. I keep that page and I send it.

## 3. Did round 1 land?

- Mostly. The calls read clean in the transcript ("Careful, tight right", "Hairpin left, long").
- The suggestion row now names a road and a reason (first-run 009).
- Drive it again sits right on the end card (tabs 015).
- The end card exists and is big. Its map is still empty, which KE-1 fixes.

## 4. What I'd protect

- **The moving road book in the welcome** (first-run 002-007). It sells the product in one look. Don't replace it with
  slides or copy.
- **Tapedeck's character** (tapedeck-night 040, "That's the B-side done"). A theme with a real point of view is worth
  more than three tasteful ones.
