# Vetta: the People tab, and what the social side is for

Reviewer: critic and consumer-social hand, with the code open (read only).
Evidence: 133 screenshots of the web cockpit at iPhone 16 Pro size (393 x 852 at 3x) in headless Chromium, the
Worker stubbed with a realistic account (eight friends, one request in, three crews, a planned Sunday run, a convoy
invite, two shared routes, three spots), plus the empty account, the signed-out, not-yet-a-member, no-handle and
offline states, in Roadbook (day), Tapedeck (night) and Billet (day). Shots are in
`/tmp/claude-0/-home-user-ApexNav/9a2652f3-c166-5611-ac03-2aa60a003319/scratchpad/people_review/shots/` (the harness
is `shoot.js` beside them; all data is stubbed in the script, never in the app). A path like `083-roadbook-full-crews-page-1of4.png`
below is a file in that folder. Where a finding comes from the code alone I say so. The owner's Friends | Crews split
(CALL_SHEET 2026-10-30) is the frame of everything below; I do not argue with it, I build on it.

The short version. The owner's instinct this morning was right and the rebuild fixed exactly what he named: the
friends list is first, there is one Invite key, friend things and crew things are on different sides. What the
rebuild could not fix, because nobody asked it to, is the premise under both sides. The social side of Vetta is still
a **directory**: eleven rows of nouns (Friends, Requests, Routes shared with you, Spots near you, Friends on the
map, Points board; Crew drives, Crews near you, Start a crew, Convoy, Crews this month), each a filing drawer, each
opening a sheet with a list in it. Nothing on either side is in **time**. Nothing says what happened since you last
looked, what is on this weekend, or what last Sunday was like. In a spirited-driving app the social object is not a
person and not a group; it is **the run**: the Sunday, planned on Wednesday, driven at seven, remembered by Monday.
Vetta has every part of the run built (crew drives, roles, regroup points, the convoy, the board, chat, the pinned
route) and shows them as five unrelated features in five places. Put the run at the centre of the Crews side and the
people at the centre of the Friends side, make both tell time, and the social side goes from a competent settings
page to the thing crews show each other in the car park. That is the whole review; the rest is how.

---

## 1. The critique

### What a social side is for, here

Strava's social side works because the object everyone shares is the activity, and every social feature (kudos,
comments, clubs, segments, the feed) is a view of activities. Find My works because the object is a person's
position now, and the whole app is one map of them. Discord works because the object is the channel, a room that is
always on. Waze works because the object is the road right now. Each of them picked one object and let everything
hang from it.

Vetta's social code has four objects, Friend, Crew, Drive (the planned one) and Convoy (the live one), and treats
them as peers. They are not peers. A crew exists to run drives; a convoy is a drive while it is happening; a friend is
someone you want in the car behind you. The run is the spine. Friends and crews are who comes; the convoy is the run
at 7 a.m.; the board, the chat and the shared route are the run's planning and its memory. When you see it this way,
most of the People tab's awkwardness is the same mistake made eleven times: the parts of one thing filed under
different names.

Here is the evidence, in the order a person meets it.

### Signed out: a good door

`001-roadbook-out-signed-out-friends-1of2.png`, `003-...-crews-1of2.png`. The logo, "Drive with friends", three glyphs
(Friends on the map, The board, Shared routes), one line of promise ("Vetta is invite-only. Nothing is shared unless
you switch it on."), the sign-in keys, the legal line. Crews says "Drive as a crew" with its own three glyphs. This is
the right amount: it says what each side gets you and asks for nothing until you want it. Keep it. Two faults, one
serious. On Billet the sign-in key is dark grey text on a dark grey key, unreadable
(`009-billet-out-signed-out-friends-1of2.png`); the cause is `html[data-theme="billet"] .ink-btn` (web/index.html:707)
painting its gradient and ink over `.ink-btn.solid` (:856), so every primary key on the social side under Billet
(Sign in, Send an invite link, Accept, Join crew, Invite or add a friend, Start a convoy, Plan it) is a ghost
(`078-billet-full-friends-invite-1of2.png`, `074-billet-full-friends-list-1of2.png`). I confirmed the computed style:
text `rgb(28,29,31)` on `linear-gradient(#2E2F33, #1C1D1F)`. The second fault is the word "invite-only", which
appears six times across these screens and in the invite sheet. It was a decision for a group of under twenty
(STATE 2026-10-26); the UI has turned a stage into a creed. More on that under the invite.

### Signed in, not yet a member: the first dead end

`013-roadbook-nonmember-non-member-friends-1of2.png`. "Join with an invite. Vetta is invite-only. Paste your invite."
A field, a Join key, and under them Sign out, Download my data, Delete account. A person who has just signed in with
Google, with no invite in hand, is offered three ways to leave and no way in. Worse, the Crews side
(`015-...-crews-1of2.png`) tells someone who arrived by a **crew** link that it will not do: "Join Vetta with your own
invite first, then answer it here." So a crew owner who wants to bring a new person in must send two links, a
friend invite and a crew invite, and the newcomer must redeem them in the right order. In Discord one link is the
whole onboarding. In Apple Invites one link is the whole onboarding. The crew link should be the invite: redeem it,
become a member, join the crew, be friends with the person who sent it (the account-invite redemption `POST /api/invites/redeem` and the crew join `POST /api/crews/join`, both in
`backend/src/index.ts` → `social.ts`, are separate today and `crews/join` requires a member; the Crews side already previews
the crew before the yes, `130-roadbook-full-link-crew-crew-invite.png`, which is the right pattern to extend).

### The empty account: a directory of nothing

`023-roadbook-empty-empty-friends-1of2.png`. "No friends yet. Invite someone to Vetta, or add a member by their
handle.", the Invite key, then four rows that each open an empty sheet: Requests, Routes shared with you, Spots near
you, Friends on the map ("Nobody sees you"). The Crews side (`027-...-crews-1of2.png`) is longer: "Your crews" (a
paragraph), "Crews near you" (none), "Start a crew" (a Private/Public switch, a name field and Create, inline),
"Crew drives" (a paragraph), "Convoy" (a paragraph, a "How this works" disclosure, a name field, Start a convoy).
Someone with no friends is offered a convoy. This is the filing cabinet with the drawers pulled out. A new account
should see one thing on Friends, the Invite, with the best reason to use it, and one thing on Crews: find one nearby
or start one, with the drive-planning and convoy keys appearing only when there is a crew to plan for. The rows cost
nothing to draw and they cost the newcomer the one impression that matters: that there is something here.

### Friends, full: the best idea on the tab, and then nothing to do with it

`049-roadbook-full-friends-list-1of2.png`. Eight rows, each a face, a handle and where they are: "On the road ·
Cherohala Skyway" with a red dot, "Seen 2 min ago", "Seen 15 min ago", "Seen 3 h ago", "Seen 26 h ago", then three
"Not sharing where they are". The ordering (on the road, then last seen, then silent) is exactly right and the live
line with the road name is the single most Vetta thing on the whole tab. For a moment it is Find My for drivers.

Then you tap @cara. `052-roadbook-full-friends-row-open.png`: the row opens two slide switches, Scores and Times,
a sentence ("@cara sees your scores and times."), and four text links: Profile, Unfriend, Report, Block. The row
that just told me Cara is on the Skyway right now opens an admin panel about what Cara may see of me. Nothing on it
lets me see her on the map, send her a route, ask her to Sunday, or say a word to her. The thing a person wants
(the person) is behind "Profile", a text link third in a row of four, and the profile (`053-...-profile-1of2.png`)
is a card of her stage bests, "friends since 2026-08-14" in ISO. The friend row needs to be about the friend: tap
it and get her on the map (if she shares), her car, her last run, Share a route, Invite to a drive, and, behind one
quiet row, "What @cara sees of you" with the two switches. The grants are a setting; they should not be the lid.

The three "Not sharing where they are" rows read as a small reproach each, and the phrase is said of a friend who
may simply never have been asked. The honest line is the one the data supports: nothing shared yet, so no line at
all, as the code already does when the read fails (`stateOf` in web/index.html:5207). "Seen 26 h ago" should be
"Seen yesterday" (web/friends_map.js:35, `friendState`).

### The Invite sheet: one key, which was the point, and the requests hiding inside it

`056-roadbook-full-friends-invite-1of2.png`. "New to Vetta: Vetta is invite-only. They join with your link, and
you're friends the moment they do. Send an invite link." Then "Already on Vetta: Share my handle · @me / Their
handle / Send request." Then "Requests · 1: @dan Accept Decline." One sheet, three jobs, in the right order. "They
join with your link and you're friends the moment they do" is the best sentence on the tab, and it is the model
Apple Invites and Partiful use: the link is the relationship. Keep it.

But the requests do not belong under "Invite". A request in is someone asking **me**; it is news, with a badge on
the tab (`051-roadbook-full-friends-tabbar.png`) and "1 new" on its row, and the row then opens the Invite sheet
scrolled to the bottom (`058-...-requests-row-opens-invite.png`, `openInvite(true)` at web/index.html:5271). The
person who tapped the badge is shown "Send an invite link" first and has to find @dan under two other sections. A
request deserves its own small sheet, or better, a card at the top of the friends list ("@dan wants to be your
friend · Accept · Not now") until it is answered, which is how Strava, Instagram and Messages all do it: the ask is
in the list, not in a drawer.

"Share my handle · @me" does not share a handle; it copies a `?add=me` link ("Link copied. Anyone who opens it can
ask to be your friend."). Say what it does: "Share a link to me". And "Send request" by typed handle is the weakest
mechanism of the five Vetta now has (friend link, handle link, request by handle, crew link, convoy link or QR);
it exists for the case where two members meet in a car park. A QR of your own handle link, which the convoy already
draws (`web/convoy_ui.js` showQr), would do that job in one tap on each phone.

### Routes shared, spots near you, the points board: three things that are not about friends

`059-roadbook-full-friends-routes-shared.png`: "Cherohala loop · from @cara · Open". This is from a friend; it
belongs here, but as news ("@cara shared Cherohala loop · Tue"), with the route card's tulip, not as a drawer.
`060-...-spots-1of2.png`: "Spots near you" lists **members'** spots (Look Rock overlook, 4.6★ (11) · Overlook ·
403.3 km · 19 visited), not friends'. It is a map layer and a planning input, and it is on the Friends side because
it was in the old Crew tab. It belongs in Where to? and the plan sheet (which already leans loops toward rated
spots, Garage → Spots), or as a layer. The distance is in kilometres while every other number on the phone is in
miles (`web/spots_feed.js:36` prints `${s.km} km` raw; `256 mi` sits two screens away on the standings). The
**Points board** at the bottom of Friends (`050-...-list-2of2.png`: "1 @sam 310 · 2 @cara 212 · 3 @me 42") ranks
road-data contribution. It has no unit (REVIEW2 U-41 removed the word), no explanation, and it is a leaderboard of
friends on a side that says "Never speed, no leaderboards" everywhere else. It is a contribution tally and belongs
with Share road feel in the Garage, or in the Log's year line, as "roads you mapped first". It should not be the
last thing a person sees under their friends.

### Friends on the map: three doors to one room

`062-roadbook-full-friends-friends-on-map-sheet.png`. Show friends (a switch), Show me to (Nobody / Crew / Friends),
Delay (Live / 10 min / 1 h), Position shown as (Exact / Within a mile), Only while driving, Home zones ("None yet:
add one in Garage, Privacy"), and the paragraph that restates the choice ("Your friends see you 10 minutes late,
within a mile, only while you drive. Inside a home zone, nobody sees you, convoy included."). As a consent surface
this is the best in its class: it separates seeing from being seen, defaults to the safe side, and says the result
in one sentence. Find My does not explain itself this well. Keep every word.

It just has three doors: the People row "Friends on the map · Friends see you", the Layers panel's "Who sees me"
link (`064-...-layers-panel.png`), and the Friends layer switch itself, which opens the same sheet the first time.
The row on Friends is the odd one: it is the only row on the tab that is a setting, not a list, and it sits between
"Spots near you" and the points board. And the map itself (`063-roadbook-full-friends-map-friends-layer.png`) shows
the friends as initial pucks with "about 3 min ago · exact" tags, which is honest and good, but the friends list
and the map never meet: a live friend's row does not offer "Show on map", and a puck does not offer the friend.

The bigger point is that "what people see of you" is spread across **six** controls in **five** places: Scores and
Times per friend (the friend row), Scores and Times per crew (the gear sheet's tile, `089-...-gear-tile-open-1of2.png`),
Show me to / Delay / Exact / Only while driving (this sheet), Share road feel (Garage), Show to friends / crews on
each car (Garage → the car), and home zones (Garage → Privacy). Nobody can answer "what does Bob see of me?" without
visiting four screens. Find My's whole trick is that there is one list, People, and each row says what they get.
Vetta needs one page, **Who sees what**, with the audiences (Friends, each crew, a person) down the side and the
things (position, Scores, Times, cars, road feel) across, and that page is where the friend row's "What @cara sees"
and the gear's switches both go. It can live in the Garage under You; the People rows then point at it.

### Crews, full: a handsome page with the wrong thing on top

`083-roadbook-full-crews-page-1of4.png`. The switcher (RIDGE RUNNERS / SMOKY MOUNTAIN MIATAS / NIGHT SHIFT, uppercase
chips that wrap to three lines and push the gear off the right edge), then the hills, the dashed road, the stripe
band with the crew's blue, the crest in its shield, "Ridge Runners / Slow in, smooth out. / 7 members · Private",
an Invite key. This header is the best-made thing on the social side and it works in all three themes
(`115-tapedeck-full-crews-page-1of4.png`, `119-billet-full-crews-page-1of4.png`). It feels like a club.

Then, first under the name: a bordered box, "Club livery · 6 Decals from 2 supporters · Works at 12", a meter
with two tick marks, two tilted stickers. The first thing a crew page says after its name is its subscription
tier. In Discord the boost bar is in the server settings; it is not the banner. Here the merch stand is at the door.
Under it, "Pinned route · Cherohala loop · Open" (good, small). Then **Next drive**, the date block (2 NOV), "Sunday
dawn run · 7:00 AM · Meet at Tellico Shell · Lead open · Sweep open", four initials and "+1 · 4 going", "I'm going".
This card is the run; it is what the page is for, and it is the third thing down. Then the Vetta Score board
(`084-...-2of4.png`: 811, 790, 744, "--" for Bob, with cars), then Chat (`085-...-3of4.png`), the one living thing,
with "Delete Report Pin" as three text links beside every message, louder than the messages themselves. Then the
rows (Crew drives, Crews near you · 2, Start a crew), then **Convoy** as a section with "Drive together, live, for
up to two hours", a disclosure, "@sam invited you: Sunday dawn run · until 6:36 PM" with Join / Not now, and a
"Convoy name" field with Start a convoy. Then "Crews this month".

Read that order again as a member on Saturday night: tier, meter, stickers, pinned route, the run, the board, the
chat, three drawers, a convoy explainer, a convoy invite for the very run above, a blank convoy form, standings.
The convoy invite is for the drive on this page and it sits four screens below it. "Start the convoy" is also a
key on the drive's card in the Crew drives sheet once the window opens (`web/crew_events.js:113`), and the morning
map offers directions to the meet (REVIEW roadmap 21). That is three surfaces for one morning.

What belonging should feel like is a clubhouse that has changed since you were last in: the run this weekend at
the top (or, after it, what it was: who came, the best Score, the photos), who is out right now, what was said. A
crew page should open on **This week**: the next drive's card with Going on it and, when the morning comes, the
same card turning into "Convoy · 3 in · Directions to Tellico Shell" and, after the drive, into the run's record.
Members with their presence dots ("3 out now") where the livery box is. Chat next, not last. The board after. The
livery, the Decals and the meter under Edit livery and in the gear, where the people who care about them (the
owner, the Pro supporters) go looking. The drive card as the page's heart also solves the three-surface problem:
plan, morning, convoy and memory are four states of one card, and the card lives in one place.

### The gear: the crew's members, and your own leaving, behind two taps

`087-roadbook-full-crews-gear-1of2.png`: "Crew settings · Your crews", three tiles. Tap Ridge Runners
(`089-...-gear-tile-open-1of2.png`): the member list (@me Owner, @sam Sam Report Block, @cara ...), Scores and
Times switches ("Ridge Runners sees your scores."), "Turn off invite links", an area field with Make public,
"Invite to crew", Leave. This is where the **members** are. A crew page that says "7 members" shows no member; the
faces are behind the gear, in a tile, under the person's own sharing switches, and each name is dressed in Report
and Block. The members are the crew. They belong on the page, a strip of faces with the owner marked and the ones
on the road lit, and Report and Block belong on the member's own profile, one tap in, as the friend row does.

Leave is five taps (People, Crews, gear, tile, Leave, confirm). That is fine for a destructive action; it is the
member list that should not be behind it. And "Invite to crew" here duplicates the page's Invite key; both are
owner-only (`is_owner && page.invite` in web/crew_page.js:215, and the Worker's crew-invite route). A member cannot
bring a mate. In every group product that works (WhatsApp, Discord, Strava clubs) a member can invite; the owner
can turn it off. For a four-person crew of friends this is the difference between growing and not.

### Crew drives and the plan form: the right ingredients, the wrong room

`094-roadbook-full-crews-drives-1of2.png`: a "Plan a drive" key, then the drive cards as text ("Sunday dawn run /
Mon, Nov 2 · 7:00 AM · Ridge Runners · by @sam / Meet: Tellico Shell · Fuel first. Two regroups. / Going: @sam,
@cara, @bob, @tilly · 2 maybe / Lead @sam · Sweep open · I'll sweep / Regroup: The overlook · Robbinsville gas /
Going Maybe Can't / Directions to meet · Open the route / Add to calendar · Cancel the drive / Report"), then the
second crew's drive, then "Meets near you". The content is excellent and ahead of Strava's club events (roles,
sweep, regroup points, a route, calendar). It is set as eleven lines of equal prose with seven text links. Compare
the crew page's own version of the same drive (the date block, three lines, faces, one key): that is the card;
this sheet should be a list of those cards, each opening to the full detail.

The plan form (`096-roadbook-full-crews-plan-form-1of3.png` to `-3of3`) is three screens: crew, name, the day
strip (30 TODAY, 31 TMRW, 1 SUN...), the time stepper (the app's own controls, good), Meet (Where I am / Map
centre, a name field), "Plan a route first to add it" (a switch that cannot be switched: a dead end dressed as a
control), Roles (You lead; Sweep: someone going takes it), Regroup points (name + "Add at the map centre"), Notes,
"Only public crews can list a meet for everyone" (another switch that is off and explains why), "Keep it as a
template", Plan it. A Sunday run is name, day, time, where to meet, which road. The rest is for after it exists.
Two screens become one if roles, regroup points, notes and templates sit behind "More" on the planned drive's card,
which is also where a sweep volunteers and where the leader adds a regroup point on Saturday night when she thinks
of it. And "Map centre" as the way to set a meeting point means the person must close the sheet, pan the map to the
Shell, reopen People, reopen Crews, reopen Crew drives, reopen Plan a drive, and tap Map centre. That is seven
steps for the one field that matters. Apple Invites and Partiful both pick the place by search; Vetta has Where to?
search already (`place_search.js`); the meet field should be a place search with the map centre as a fallback.

### The convoy: a feature that should be a state

`108-roadbook-full-crews-convoy-section.png` and `109-...-convoy-live-1of4.png`. Started, the section becomes
"Sunday dawn run · you are leading · ends 7:51 PM", Invite friends / Show QR / Share link / New link / End convoy,
"No connection to the convoy. Retrying…". Invite friends (`113-...-convoy-invite-picker.png`) lists the friend
handles as chips to tick. On the map (`114-roadbook-full-crews-map-convoy-bar.png`) a box top-left says "Sunday
dawn run · Reconnecting…" with nothing to tap. The in-drive bar, the spoken calls and the regroup line are, per
STATE and the code (`web/convoy.js`, `web/crew_voice.js`), the strongest live-group feature any driving app has
outside Waze's groups; I could not drive it here and I do not judge what I could not see. What I can judge is
the seam: the convoy is started from a blank name field at the bottom of a page whose top already names the run.
The Sunday run has a name, a crew, a route, a leader and a list of who is going. "Start the convoy" on that card
(which exists, inside the Crew drives sheet, inside its window) should be the only way a crew convoy begins, with
the ad-hoc "drive together now, no crew" convoy living on the map's Start key, where a person who has just met two
friends at a petrol station would look for it. Then the "Convoy" section on Crews disappears, and with it the
explainer, the disclosure and the name field, and a convoy invite becomes what it is: the run's card saying
"@sam started the convoy · Join".

### Where you and your account live

Sign in is on People (both sides). Your handle, photo and Pioneer line are in the Garage under "You"
(`123-roadbook-full-garage-garage-1of8.png`). Sign out, Download my data and Delete account are in the Garage under
"Account" (`125-...-3of8.png`). "Pick a handle" is on People. The blocked list is in the Garage. The moderator's
tools are at the bottom of Friends. Nobody will find "Sign out" by reasoning; they will find it by scrolling the
Garage past Privacy zones, Crash check and Units. The REVIEW.md call ("your identity lives with your cars") was a
good one and I keep it; the consequence is that People should carry a single **You** row at the top of Friends
(your face, your handle, "Friends see you", tap: the Garage's You) so the two halves of a person are one tap apart,
and that "Who sees what" page lives under it.

### The themes

The People tab holds up in Tapedeck (`065-tapedeck-full-friends-list-1of2.png`, `115-tapedeck-full-crews-page-1of4.png`):
the mono type is wide, so "Not sharing where they are" and the drive card's lines wrap, but nothing breaks and the
crest and stripe read well on black. Billet is broken by the one rule already named (every solid key), and the
header's hills go grey-brown on grey, which is fine. The crew switcher chips in all three themes
(`083`, `115`, `119`) are set in the uppercase display face at 14 px and wrap "SMOKY MOUNTAIN MIATAS" to three lines;
a 40-character crew name is allowed (`maxLength: 40`) and would wrap to five.

### What is already the best of its kind, and must be kept

The invite-link-is-the-friendship model and its sentence. The friends list that says where people are, ordered by
liveness. The Friends on the map consent sheet, every word of it. The crew page header (hills, stripe, crest, date
block). The drive card on the crew page (date block, faces, one key). Roles, sweep and regroup points on a planned
drive; the sweep volunteer key. "Nothing is kept" on the convoy. Block and Report on every surface, and the
preview-before-join on a crew link. The "--" for Bob on the board. None of the above needs touching.

---

## 2. The map of it

### As it is (People tab, signed in, member, in a crew)

| Where | What is there | Reach it (taps from the tab) | Note |
|---|---|---|---|
| People → Friends | friends list (face, handle, where they are) | 1 | best thing on the tab |
| ↳ friend row (tap) | Scores, Times switches; Profile, Unfriend, Report, Block | 2 | admin panel where the person should be |
| ↳ Profile (sheet) | name, friends since, stages, cars, crews | 3 | no "see on map", no route, no drive |
| Friends → Invite or add a friend (sheet) | Send an invite link · Share my handle · Send request by handle · **Requests** | 2 | requests misfiled under Invite |
| Friends → Requests (row) | opens the Invite sheet, scrolled | 2, then Accept 3 | duplicate door |
| Friends → Routes shared with you (sheet) | list · Open | 2 | from friends: right side, wrong form (drawer, not news) |
| Friends → Spots near you (sheet) | members' spots, filter, rate, Go there | 2 | **misplaced**: a map/plan feature, not a friend one; km |
| Friends → Friends on the map (sheet) | Show friends · Show me to · Delay · Exact · Only while driving · Home zones | 2 | same sheet as Layers → Who sees me and the layer's first switch-on: three doors |
| Friends → Points board | contribution tally | scroll | **misplaced**: Garage (Road feel) or Log |
| Friends → (moderator) errors, health, latency, feedback | owner tools | scroll | misplaced: Garage |
| People → Crews | crew switcher · gear · crew page | 2 | |
| ↳ crew page | header · **Livery box** · Pinned route · Next drive (Going) · All drives · Board · Builds · Chat | 2 | livery before the run; chat last; no members |
| ↳ Invite (owner) | copies a crew link | 3 | duplicate of gear → tile → Invite to crew; members cannot invite |
| ↳ Edit livery (owner) | motto, crest, stripe, cover, Club/Works/Factory fieldsets | 3 | fine, long |
| ↳ gear → Crew settings (sheet) | your crews as tiles | 3 | |
| ↳ ↳ tile (tap) | **members** (Report, Block each) · Scores, Times · Turn off invite links · Make public · Invite to crew · Leave | 4 | members hidden here; Leave 5 with confirm |
| Crews → Crew drives (sheet) | Plan a drive · drive cards (Going/Maybe/Can't, roles, regroup, directions, route, calendar, cancel, report) · Meets near you | 3 | same drive also on the crew page; convoy key appears here in the window |
| ↳ Plan a drive (form, 3 screens) | crew, name, day, time, meet (Where I am / Map centre), route switch, roles, regroup, notes, public meet, template | 4 | meet point by map centre = 7 steps |
| Crews → Crews near you (sheet) | public crews · Join · Report | 3 | |
| Crews → Start a crew (sheet) | Private/Public · area · name · Create | 3 | |
| Crews → Convoy (section) | explainer · disclosure · **convoy invite** · name · Start a convoy; live: members, Invite friends (picker), QR, link, End | scroll | the run's convoy, four screens below the run |
| Crews → Crews this month | standings | scroll | fine, low |
| Map → Layers → Friends / Who sees me | layer switch; the same sheet | 2 | |
| Map → toast "@sam invited you to a convoy · See it" | opens Crews | 1 | |
| Garage → You | face, handle, photo, Pioneer | 1 | identity here |
| Garage → Account | Download my data · Sign out · Delete account | scroll | sign-in is on People; account is here |
| Garage → each car | Show to friends / crews | 2 | another "who sees" control |
| Garage → Blocked | the block list | scroll | |

Duplicates: two doors to requests (badge/row → Invite sheet); two owner-only crew invites (page key, gear tile);
three doors to the sharing sheet; the Sunday run on the crew page, in Crew drives, in the Convoy section and on the
morning map; "Vetta is invite-only" said six times. Misplaced: Spots near you (Friends), Points board (Friends),
moderator tools (Friends), members (behind the gear), the convoy (a section, not a state), the livery box (above the
run), Leave (fine) but the member list with it (not fine). Things a person must already know: that Requests are
inside Invite; that members are behind the gear in a tile; that "Map centre" means go and move the map first; that
a crew link needs a friend invite first; that Sign out is under Units.

### As it should be (the Friends | Crews frame kept)

```
People
├─ Friends                                   (opens here)
│  ├─ [card] @dan wants to be your friend · Accept · Not now      (only while one waits; the badge counts these)
│  ├─ [row]  You · @me · Friends see you · ›  → Garage You / Who sees what
│  ├─ Friends list: face, handle, where they are (live first)
│  │    └─ tap → the person: On the map (if live) · Share a route · Invite to a drive · Profile
│  │             last shared: "Cherohala loop · Tue"; quiet row: What @cara sees of you (Scores, Times)
│  │             Unfriend · Report · Block at the bottom of the profile
│  ├─ [key]  Invite a friend  → sheet: Send an invite link (the friendship) · My QR / my link · Add by handle
│  ├─ [row]  From friends · 2 ›   (routes and spots friends shared with you, newest first, as cards)
│  └─ (nothing else)
└─ Crews
   ├─ [card] Join Blue Ridge Breakfast Club? (only while a crew link waits)
   ├─ crew switcher (names in the text face, scrolling, gear fixed at the right)
   ├─ Crew page
   │  ├─ header: hills · stripe · crest · name · motto · members · Invite (any member; owner can turn it off)
   │  ├─ THIS WEEK: the run card (date block, Going) → on the morning: Convoy · Directions to meet · Join
   │  │                                              → after: the record (who came, best Score, photos)
   │  │             or: "No drive planned · Plan one"  ·  All drives ›
   │  ├─ Members: faces, owner marked, on-the-road lit ("3 out now") → tap: profile
   │  ├─ Chat (pinned line on top; Report/Delete behind a long-press or a single … key)
   │  ├─ Board · This month
   │  ├─ Pinned route · Builds
   │  └─ Livery line (one line: "Club livery · 6 Decals") → Edit livery / the meter and stickers live there
   ├─ [row]  Find or start a crew ›   (Crews near you + Start a crew, one sheet)
   └─ [row]  Crews this month ›       (standings)
   gear → Crew settings: What this crew sees of you · Invite links · Public/private · Leave
Map
├─ Start → Drive · Convoy now (ad-hoc, no crew) · ...
├─ Layers → Friends (the layer) · Who sees me → Garage Who sees what
└─ Where to? / Plan → Spots near you (a layer and a planning input)
Garage
├─ You: face, handle, photo · Who sees what (one grid: position, Scores, Times, cars, road feel × friends, each crew, a person)
├─ Road feel: Share road feel · Roads you mapped first (the points tally)
└─ Account: Sign out · Download my data · Delete account · Blocked · (moderator tools)
```

Tap counts after: accept a request 2 (badge, Accept); add a mate 2 plus the share sheet; who's out now 1; see a
live friend on the map 2 (row, On the map); stop sharing 2 (You row, Nobody); plan Sunday 3 to the form, and the
form is one screen; start the convoy on the morning 2 (Crews, the card's key); leave a crew 4 with its confirm;
from a crew link to in the crew, signed out: open, sign in, Join crew (3), and no second link.

---

## 3. Verdict

Against Strava: Vetta's crew drive is already richer than a Strava club event (roles, sweep, regroup, a route, a
convoy that follows), and its consent model for position is better than Strava's beacon; what Strava has that
Vetta lacks is the feed, the sense that something happened since you last looked, and the afterlife of an event.
Against Find My: the friends list with "On the road · Cherohala Skyway" is the right idea and the sharing sheet is
better explained than Apple's, but Find My is one list that is also the map, and here the list and the map never
meet and the row opens a permissions panel. Against Discord: the crew page's header beats a Discord server banner
and the livery tiers are a more honest boost mechanic than Nitro, but Discord puts the boost bar in settings and
the rooms on the page; Vetta puts the tier box above the run and the chat at the bottom. Against Waze: the convoy's
spoken regroup line and "nothing is kept" are things Waze's groups cannot say, but Waze starts a group from the
drive, not from a name field under a leaderboard. The three things between this and greatness: (1) make the run
the centre of Crews, one card with four states (planned, morning, convoy, remembered), and let the Convoy section,
the duplicate drive surfaces and the livery-first page fall away; (2) make the friend row about the friend (map,
route, drive, profile) and gather every "who sees what of me" control into one page; (3) make one link the whole way
in: a crew link that joins Vetta, the crew and the sender, sendable by any member, with "invite-only" retired from
the copy. Do those three and the social side stops being a directory and becomes the reason a crew moves to Vetta.

---

## 4. Findings

Severity: P0 broken on a main path; P1 wrong or confusing on a main path; P2 worth fixing; P3 polish.

| ID | Severity | Evidence | What's wrong | The fix (files) | How a screenshot would show it fixed |
|---|---|---|---|---|---|
| P-01 | P0 | `009-billet-out-signed-out-friends-1of2.png`, `078-billet-full-friends-invite-1of2.png`, `074-billet-full-friends-list-1of2.png`; computed: text rgb(28,29,31) on a #2E2F33→#1C1D1F gradient | Under Billet every primary key on the social side (Sign in, Invite or add a friend, Send an invite link, Accept, Join crew, Start a convoy, Plan it) is dark text on a dark key: unreadable, looks disabled | `web/index.html:707`: the `html[data-theme="billet"] .ink-btn` rule must exclude `.solid`, or add `html[data-theme="billet"] .ink-btn.solid { background: var(--panel-ink); color: var(--panel); }` after it; add a theme-contract check in `e2e/smoke.js` ("theme contract on the page") that a `.ink-btn.solid` has ≥ 4.5:1 contrast in all three themes | Billet signed-out: a light key with dark legible "Sign in with Google" |
| P-02 | P1 | `015-roadbook-nonmember-non-member-crews-1of2.png`, `131-roadbook-out-link-crew-out-crew-invite-signed-out.png`; code: `web/index.html:5146-5157` (non-member branch); `backend/src/index.ts:160` (`crews/join` behind `requireMember`) | A crew link cannot get a new person in: "Join Vetta with your own invite first". Two links and an order to redeem them, for the most common growth path (a mate invites you to the crew) | Backend: a crew invite token redeemable by a signed-in non-member makes them a member, joins the crew and friends the sender (`backend/src/social.ts` `crewJoin` taking the account-invite path of `/api/invites/redeem` for a non-member); front: the Crews side's non-member branch previews the crew and offers Join, as the member branch does (`renderAccount`, the `stash('apex.crew')` card) | Signed in, not a member, with a crew link: "Join Blue Ridge Breakfast Club? · Join crew" and no "join Vetta first" |
| P-03 | P1 | `083-roadbook-full-crews-page-1of4.png` (livery box first; Next drive third), `085-...-3of4.png` (chat last), `108-...-convoy-section.png` (the run's convoy invite four screens below the run) | The crew page is ordered as a brochure (tier, meter, stickers, pinned route) and the run, the members and the chat come after; the convoy is a separate section at the bottom | `web/crew_page.js` `view()`: order `header, titleBlock, thisWeek (nextDrive or last run's record), members, chat, board, pinned, builds, liveryLine`; `liveryBox` collapses to one line unless `is_owner` or `mine.pro`, the meter moves into `editLivery`; the convoy invite and "Start the convoy" render on the drive card (`crew_events.js` `card()` → a shared `driveCard` used by both) and `convoy.section()` is no longer appended to `crewsBody` (`web/index.html:5465/5469`) | Crews side: name, then the Sunday card with "I'm going", then seven faces, then chat; no "Convoy" heading anywhere |
| P-04 | P1 | `052-roadbook-full-friends-row-open.png`, `053-...-profile-1of2.png` | Tapping a live friend opens Scores/Times switches and four text links; nothing to see her on the map, share a route, invite her to a drive; the profile is stage bests | `web/index.html:5222-5242`: the row's detail becomes actions (On the map when `st.live` → `friendsMap.setLayer(true)` + `map.flyTo`; Share a route → the route card's share with her preselected; Invite to a drive → `crewEvents.plan` with her as a guest once drives take guests; Profile); the grants move under one row "What @cara sees of you" (collapsed); Unfriend/Report/Block to the foot of `profile_view.js` | A tapped row showing "On the map · Share a route · Profile" and one quiet "What @cara sees" row |
| P-05 | P1 | `058-roadbook-full-friends-requests-row-opens-invite.png`, `056-...-invite-1of2.png`; code `openInvite(true)` web/index.html:5271 | A request in (badge on the tab) opens the Invite sheet scrolled to its bottom; the asker is under two sections about inviting others | `renderAccount`: `incoming` renders as a card at the top of `accountBody` ("@dan wants to be your friend · Accept · Not now") and `reqRow` goes; the Invite sheet keeps only invite/add; update the e2e People flow's `navs` assertion | Friends side with a request: one card at the top, Accept on it, no Requests row |
| P-06 | P1 | `087-...-gear-1of2.png`, `089-...-gear-tile-open-1of2.png`; `083-...-page-1of4.png` says "7 members" and shows none | The crew's members are only behind gear → tile, under the person's own switches, each dressed in Report/Block; the page shows a count and no faces | `web/crew_page.js`: a `members()` section (faces from `/api/crews/:id/members`, owner marked, `friendState` dot when they share position with you) between the run and chat; `web/index.html:5388-5403` `loadMembers` leaves the gear tile; Report/Block on a member's profile sheet (`profile_view.js`, members-only fields) | The crew page with a strip of initials, one marked Owner, two lit "out now" |
| P-07 | P1 | `083-...-page-1of4.png` (Invite, owner only), `090-...-gear-tile-open-2of2.png` (Invite to crew, owner only); code `web/crew_page.js:215`, backend crew-invite route | Two invite keys for a crew, both owner-only; a member cannot bring a friend | Backend: members may create invite links unless the owner sets `invites: 'owner'` (new column, migration); front: the page's Invite shows for every member, the gear's "Invite to crew" goes, the gear gains "Who can invite · Owner / Anyone" | A member's crew page with an Invite key; the gear with the Who-can-invite switch |
| P-08 | P1 | `023-roadbook-empty-empty-friends-1of2.png`, `027-...-crews-1of2.png`, `028-...-crews-2of2.png` | The empty account shows every drawer empty (four rows on Friends; Your crews, Crews near you, an inline Start a crew form, Crew drives, a Convoy explainer and form on Crews) | `renderAccount`: with no accepted friends, Friends is the invite key and its reason only; with no crews, Crews is "Find or start a crew" (one sheet: discover + create) and nothing else; `crewEvents.section()` and `convoy.section()` are not appended until `myCrews.length` | A new account's Friends side: one sentence and one key; Crews: one row |
| P-09 | P1 | `062-...-friends-on-map-sheet.png`, `052-...-row-open.png`, `089-...-gear-tile-open-1of2.png`, `123-...-garage-1of8.png`, Garage car cards | Six "what people see of me" controls in five places (position sheet, per-friend Scores/Times, per-crew Scores/Times, Share road feel, car audiences, home zones); nobody can answer "what does Bob see?" | One page, Who sees what, in the Garage under You (`garage_ui.js` or a new `web/who_sees.js`): audiences down, things across, exceptions per person; the friend row and the gear link to it; the People row "Friends on the map" becomes the You row's "Friends see you" | One grid screen; the friend row's quiet "What @cara sees" opening into it |
| P-10 | P1 | `096-...-plan-form-1of3.png` to `-3of3`; "Map centre" as the only place picker besides Where I am | Planning a drive is three screens, with roles, regroup points, notes, public meet, template up front; the meeting point needs the map moved first (seven steps) | `web/crew_events.js` `planForm`: name, day, time, meet (a place search via `place_search.js` with Where I am / Map centre as chips), route (only when one is planned) and Plan it; roles, regroup, notes, public, template move to the planned drive's card under More (already editable there for sweep) | The form on one screen with a "Meet at…" search field |
| P-11 | P1 | `108-...-convoy-section.png` (name field + Start a convoy under a leaderboard), `114-...-map-convoy-bar.png` | A crew convoy starts from a blank name field at the bottom of Crews, not from the run that already has a name, route, leader and list; ad-hoc convoys have no home on the map | Crew convoy: only from the drive card's "Start the convoy" (`crew_events.js:113`, window widened to the day of); ad-hoc: a "Convoy now" choice on the map's Start key (`web/index.html` start flow) using `convoy.startFor(name, [])`; the Convoy section leaves `crewsBody` | The Start key's sheet offering Drive / Convoy now; the Crews side with no Convoy heading |
| P-12 | P2 | `060-...-spots-1of2.png` ("403.3 km" beside "256 mi" on standings) | Spots near you prints kilometres regardless of the units setting | `web/spots_feed.js:36`: `ApexUnits.long(s.km * 1000, 1)` as `crew_standings.js` does via `fmtKm` | "Look Rock overlook · 250.6 mi" |
| P-13 | P2 | `060-...-spots-1of2.png` on the Friends side | Spots near you are members' spots, a map and planning input, filed under friends | Move the row to Where to? / the plan sheet's Spots section and the Layers panel (`web/index.html` plan sheet; `spotsFeed.section()` reused); keep friends' shared spots in "From friends" | Friends side without a Spots row; Where to? with one |
| P-14 | P2 | `050-...-list-2of2.png` (Points board under friends) | A contribution tally with no unit or explanation, ranking friends, on a side that promises no leaderboards | Move to Garage → Road feel as "Roads you mapped first" (your own count, the `pioneer` line already there, `web/index.html:5183`), or the Log's year line; drop the board | Friends side ending at the From-friends row |
| P-15 | P2 | `049-...-list-1of2.png` (three "Not sharing where they are"), `web/friends_map.js:30-35` | Friends who never turned sharing on are described as refusing; "Seen 26 h ago" | `friendState`: no line (or the friend's name) when there is no presence row; "Seen yesterday" past 24 h, "Seen Tue" past 48 h | Rows showing "Hannah K" under @hannah, "Seen yesterday" under @sam |
| P-16 | P2 | `083-roadbook-full-crews-page-1of4.png`, `115-tapedeck-...`, `119-billet-...` | The crew switcher's uppercase display-face chips wrap to three lines and push the gear off the edge; a 40-char name would wrap to five | `web/crew_page.js` `switcher()` + `.crew-head` CSS: text face at 15 px, one line, horizontal scroll, the gear fixed outside the scroller | A one-line scroller of crew names with the gear always at the right |
| P-17 | P2 | `085-...-page-3of4.png` (Delete Report Pin on every message) | Moderation chrome is louder than the messages | `web/crew_page.js` `chat()`: one "…" key per message (or long-press) opening Report / Pin / Delete via `ApexConfirm` | Chat lines with handle, time and text only |
| P-18 | P2 | `094-...-drives-1of2.png` vs the crew page's card (`083`) | Two renderings of the same drive: a date-block card on the page, eleven lines of prose with seven text links in the sheet | One `driveCard` in `crew_events.js` used by both (`crew_page.js` `nextDrive` imports it); detail (roles, regroup, calendar, cancel, report) behind the card's tap | The Crew drives sheet as a list of the same cards |
| P-19 | P2 | `064-...-layers-panel.png` (Who sees me), `049` (Friends on the map row), the layer's first switch-on | Three doors to one sheet; the People row is the only setting among lists | After P-09 the row becomes the You row's status; Layers keeps the layer switch and one "Who sees me" link | Friends side without a "Friends on the map" row |
| P-20 | P2 | `056-...-invite-1of2.png` ("Share my handle · @me" copies a `?add=` link; "Vetta is invite-only" twice on the sheet, six times across People) | The label says handle, the action is a link; "invite-only" is a stage presented as a creed | `web/index.html:5268`: "Share a link to me"; drop "Vetta is invite-only" from the sheet, the signed-out line and the non-member heading, keep "They join with your link and you're friends the moment they do" | The Invite sheet with two headings and one promise |
| P-21 | P2 | `114-roadbook-full-crews-map-convoy-bar.png` | The idle convoy bar on the map ("Sunday dawn run · Reconnecting…") has no action and sits where the place plate sits | `web/convoy_ui.js` bar: idle state as one tappable line (opens the run's card), aligned with the place plate's slot; "Reconnecting" as the status-line message, not a permanent box | The idle map with the plate and one slim convoy line |
| P-22 | P2 | `013-roadbook-nonmember-non-member-friends-1of2.png` | A signed-in non-member sees a paste field and three ways out (Sign out, Download my data, Delete account) | After P-02 the paste field stays but the three account keys go to the Garage; add "Ask a friend for a link" with a share of "I'd like to join Vetta" text | The non-member screen: one field, one Join, one line |
| P-23 | P2 | `125-roadbook-full-garage-garage-3of8.png` (Sign out under Units) vs sign-in on People | Sign in is on People, sign out and the account are deep in the Garage, pick-a-handle is on People | Keep the account in the Garage (REVIEW.md 3.2) and add the You row at the top of Friends (P-09) so it is one tap from People; move "Pick a handle" into the Garage's You and have People's gate link to it | Friends side with a You row at the top |
| P-24 | P2 | `053-...-profile-1of2.png` ("friends since 2026-08-14", "Garage · 2023") | ISO dates and a car line that can be a year alone | `web/profile_view.js:6,15`: a spoken date ("friends since August"), and a car line that falls back to make/model/nickname before the bare year | "Cara Nieves · friends since August" |
| P-25 | P2 | `005-tapedeck-out-signed-out-friends-1of2.png`, `065-tapedeck-full-friends-list-1of2.png` | Tapedeck's wide mono wraps the status lines and the drive card's lines; readable but ragged | `.friend-head small` and `.cp-drive` lines at 12 px in Tapedeck, or shorter status words there ("Not sharing" / "On the road · Cherohala") | Tapedeck rows on one line each |
| P-26 | P3 | `099-...-near-1of2.png` ("Foothills Park…", "Tail of the Dra…") | Crews near you truncates names at two tiles across | One tile per row, name whole, area and distance under it | "Tail of the Dragon Regulars · 118 members · Deals Gap · 34 mi" whole |
| P-27 | P3 | `094-...-drives-1of2.png` ("Mon, Nov 2 · 7:00 AM") | The sheet repeats the date block's date in prose | After P-18 the card carries the date once | — |
| P-28 | P3 | `109-...-convoy-live-1of4.png` ("ends 7:51 PM") | The convoy's end is given as a clock time; the person wants "ends in 2 h" | `convoy_ui.js` `renderSection`: relative time while live | "you are leading · 1 h 58 min left" |
| P-29 | P3 | `096-...-plan-form-1of3.png` ("Plan a route first to add it", a switch that cannot be switched) | A dead end drawn as a control | Hide the route row when there is no planned route; show "Add a route" as a link that opens Where to? | The form without a disabled switch |
| P-30 | P3 | `097-...-plan-form-2of3.png` ("Only public crews can list a meet for everyone", off) | Same: an explanation in the shape of a switch | Render only for public crews | — |
| P-31 | P3 | `088-...-gear-2of2.png` (tiles: "Smoky Mount…") | The gear's crew tiles truncate and duplicate the switcher | After P-06/P-07 the gear is the current crew's settings only; no tiles | Crew settings: one crew's four rows |
| P-32 | P3 | `001-...-signed-out-friends-1of2.png` | "The board" as one of three promises signed out, when the board is the one thing a newcomer with no friends cannot have | "Who's out driving", "Crew drives", "Shared routes" | — |
| P-33 | P3 | `061-...-spots-2of2.png` ("1★ 3★ 5★" keys) | Rating by three fixed stars reads as a quiz | Five small stars, the current one filled; or keep three and label them "Meh / Good / Great" | — |
| P-34 | P3 | tab bar in every full shot | The People badge counts friend requests only; a crew invite, a convoy invite and a new shared route do not badge | `renderAccount` badge: requests + waiting crew/convoy invites (from `stash` and `/api/convoy/invites`) | A "2" with one request and one convoy invite |
| P-35 | P3 | `085-...-page-3of4.png` ("Oct 29" beside "3 h") | Chat times mix absolute and relative inside 30 hours | `crew_page.js` `ago()`: relative up to 48 h ("yesterday"), then the date | — |

Testing note: the e2e People flow (`e2e/smoke.js` "People: Friends first…") asserts the exact row list
`["Requests","Routes shared with you","Spots near you","Friends on the map"]` and the single Invite key; P-05, P-13,
P-14 and P-19 change that list and the flow must change with them. The crew-page flow asserts `.cp-drive`, `.cp-say`
and the livery editor; P-03 keeps those classes.

---

## 5. Roadmap

Build order, grouped where the code is shared. Each item names what it closes.

1. **Billet keys** (P-01): one CSS rule and a contrast check in the theme-contract e2e. Half a day. Ship first; it
   is the only P0 and it is on every theme's sign-in.
2. **The run as one card** (P-03, P-11, P-18, P-21, P-27, P-28): a `driveCard(e, state)` in `web/crew_events.js`
   with its four states (planned, morning, convoy live, remembered), used by `crew_page.js` `nextDrive` and the
   Crew drives sheet; "Start the convoy" and the convoy invite on it; `convoy.section()` leaves `crewsBody`; the
   map's Start key gains "Convoy now"; the idle convoy bar becomes one line. Backend: a drive's record (who came,
   from the convoy's members and RSVPs; best Score from the board) as `GET /api/events/:id/record`. This is the
   biggest change and the one that changes what Crews is.
3. **The crew page reordered** (P-03, P-06, P-16, P-17, P-31): `view()` order; members strip; livery to one line
   with the meter in Edit livery; the switcher in the text face; chat chrome behind one key; the gear becomes the
   current crew's settings.
4. **One link in** (P-02, P-07, P-20, P-22, P-32): crew invites by any member (migration + route), a crew token that
   also joins Vetta and friends the sender, the non-member screen rebuilt, "invite-only" retired from copy. Update
   `docs/APP_REVIEW.md` 5.1.1 (sign-in not required) and the UGC row for member invites.
5. **The friend row about the friend, and Who sees what** (P-04, P-09, P-19, P-23, P-24): the row's actions; a
   `web/who_sees.js` page in the Garage under You; the You row at the top of Friends; "Friends on the map" row
   goes; `profile_view.js` gains map, route, drive keys and the foot actions.
6. **Requests as a card, the empty states, the misfiled rows** (P-05, P-08, P-13, P-14, P-15, P-25): the request
   card; the empty-account branches; Spots to Where to?; Points to the Garage; `friendState` words; Tapedeck line
   lengths. Update the e2e row assertions.
7. **Plan a drive in one screen** (P-10, P-29, P-30): `planForm` cut to five fields with a place search; roles,
   regroup, notes, public, template on the card's More.
8. **Polish** (P-12, P-26, P-33, P-34, P-35).

Items 2 and 3 share `crew_page.js` and should be one PR; 5 and 6 share `renderAccount` and should be one PR.

---

## 6. Pushback

- The Friends | Crews split stands and is right; my one reservation is that the header switch, drawn as the app's
  slide switch, reads as a setting ("Friends: on") rather than two places. Two underlined tabs in the same header
  would say "two places" without changing the decision.
- "Vetta is invite-only" was a decision for twenty people; as copy on six screens it tells a newcomer the club is
  closed. Keep the gate as long as you need it; stop advertising it.
