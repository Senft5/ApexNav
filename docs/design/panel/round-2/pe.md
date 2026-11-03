# PE: Pete Kowalski, the tour leader

58. I've run my Porsche Club region's tours for eleven years: 20 cars on a good Saturday, a lead, a sweep, CB radios, a
drivers' meeting in a gas station lot at 8:15, lunch at a place that said they could seat 40, and a sign-in sheet for the
insurance. I judge one thing: could I run next month's tour on this instead of the radios and the clipboard?

## 1. First impressions

The recording can't show me a crew. `signed-in/003-crews.png` and `tabs/024-crews.png` are a dashed example card and
"1 crew near you"; `signed-in/001-friends.png` is `@a_friend`. So I read the code, and the code tells me more than a
recording would have.

The good news first, because it is real. Somebody here has led a group. The drive card (`web/crew_events.js`) goes
planned, morning-of, live, remembered. There's a lead and a sweep on the event, up to five named regroup points, a
meeting point found by search, "Start the convoy" that invites everyone going without a link, a QR for the car park, and a
convoy that keeps nothing once it ends. That's the right skeleton.

Now the big truth: **this convoy can't run my tour.** `backend/src/convoy.ts` line 12: `members: 16`. I bring 20 cars.
Four of my members get "That convoy is full" in the parking lot. And `startFor` in `web/convoy_ui.js` only invites the
first 15 people going. Then `roomMs: 2 * 3600_000`: the convoy dies at two hours, with no way to extend it. My tours are six
hours with lunch. And "The leader leaving ends the convoy for everyone" (line 193): if my lead's phone has a problem, the
whole group drops out, and nobody can take over.

Then: the sweep has no voice. The convoy has two roles, leader and member. The event's sweep never reaches it. Only the
leader can call anything. On a tour the most important call comes from the back: "car down, we're stopping with him."
Here the sweep can't make it, and neither can the car with the flat.

And none of it reaches the car. `guided-drive/car/020-driving.png` is the CarPlay screen my members will actually look
at: turn arrow, ETA, map. There's no convoy line, no regroup and no leader call. `CarPlay/` has no convoy code at all.

It's the right bones, built for four friends on a Sunday. A region needs it sized up and handed to the sweep.

## 2. Proposals

### PE-1. A convoy sized for a club tour: 30 cars, the whole day, and a lead who can hand off
- **Why it matters to me.**
  - The limits are a hard no for a 20-car tour. `LIMITS.members: 16` and `roomMs: 2 h` are in `backend/src/convoy.ts:12`.
    `startFor` slices invites to 15 (`web/convoy_ui.js`, `startFor`). The leader leaving ends it (`convoy.ts:193-198`).
  - The planned drive's lead, sweep, route and regroup points stay on the card. Starting the convoy carries none of them:
    `startFor(name, handles)` passes only a name. The leader has to find "Share my route" and tap "Regroup here" at his own
    GPS while driving (`convoy_ui.js:224`). The five regroup points I planned at my desk never reach the convoy.
- **What to build.**
  - Members to 30. `pendingSockets` and the invite caps scale with it, and `startFor` drops `.slice(0, 15)`.
  - A convoy started from a crew drive lives until the end of that day (cap 12 h). Any convoy can be extended by the
    leader in 2 h steps, up to 12 h.
  - **Hand off lead.** The leader can pass the lead to any member. If the leader leaves or is gone 5 min, the lead passes
    to the event's sweep, then the planner, then the longest-joined member. A new `epoch` for hazards is fine. "End
    convoy" stays the leader's explicit act.
  - `startFor(event)` sends the event's route (`shareRoute`) and loads the planned regroup points. The leader's panel
    shows them as one key each ("Regroup: Overlook"), so the lead's passenger calls a planned stop with one tap instead
    of dropping a pin where the car happens to be.
  - The convoy's roles come from the event: `role: "leader" | "sweep" | "member"`.
- **Cost.** L
- **Done looks like.** 20 cars join from the drive card in the gas station lot, no one sees "full", and the convoy is
  still live at 4 p.m. after lunch. The lead's phone dies on the descent, the sweep's screen says "You lead now", and
  nobody else notices.

### PE-2. Every car can say "I've stopped", and the sweep can say "hold up"
- **Why it matters to me.**
  - Hazard calls are leader-only (`convoy.ts:278-280`, `leader_only`). A member can't tell anyone anything.
  - The sweep exists in the database (`0032_event_roles_regroup.sql`) and nowhere in the live drive.
  - The leader's "last car" figure is wrong whenever there's no shared route, or the last car is off it at a fuel stop.
    `headline()` in `convoy_ui.js:173` sorts gaps ascending and takes the first. On the route the gaps are negative, so
    that's the car furthest back, which is right. Off the route `gap()` returns an unsigned straight-line distance, so it
    shows the **nearest** car. The one number the lead watches points at the car right behind him.
- **What to build.**
  - Every member gets one key, "I've stopped". It goes to the leader and the sweep (not to all 30) with the car's handle,
    its car from the garage, and a pin. The co-driver says to those two: "Stopped behind: @mike, the blue Cayman."
  - The sweep gets "Hold up" (the leader hears it and sees it on the car screen; the convoy line shows HOLD) and "Back
    together", which clears it.
  - The lead's line reads "18 of 20 past the overlook · last car 40 s behind". That's the count of cars past the last
    regroup point or junction, from `progressM`.
  - Fix `last car`: take the most negative signed gap. When anyone is unsigned, say "last car 2.1 mi away" from the
    largest distance, never the smallest. Add a unit test with one car off the route.
- **Cost.** M
- **Done looks like.** A car pulls onto the shoulder with a flat. Within five seconds the lead hears "Hold up from the
  sweep" and the sweep hears "Stopped ahead: @mike". The lead pulls into the next lot, and his line counts the cars back
  in.

### PE-3. The convoy on the car screen
- **Why it matters to me.**
  - On a tour my members look at the dash, not a phone in a cupholder. `guided-drive/car/020-driving.png` shows the
    CarPlay map with nothing of the group.
  - `grep -ri convoy CarPlay/` finds nothing. The convoy bar, the regroup pin and the gaps live only in the phone's web
    page (`convoy_ui.js`). The regroup is spoken (`cockpit.js:3912`), and that's all that reaches the car.
- **What to build.**
  - In CarPlay, while in a convoy, the trip estimates panel's third slot reads "Lead 30 s" for a member and "Last
    40 s" for the leader.
  - Leader and sweep calls and "Hold up" show as a `CPNavigationAlert` for 6 s, in the same alert style as hazard
    reports, and are spoken as now.
  - Regroup points show as map pins, and a planned regroup can be picked as the destination in one tap from the alert
    ("Go to Overlook").
  - Glance rules hold: one short line, no list of members on the car screen.
- **Cost.** M
- **Done looks like.** A member with the phone in the glovebox sees "Lead 30 s" on the dash. When the sweep calls "Hold
  up", an alert on the car screen tells them before the CB would have.

### PE-4. Run a region's sign-up, and keep a tour from being scored
- **Why it matters to me.**
  - Drives can only be planned 30 days out (`MAX_AHEAD_DAYS = 30`, `backend/src/events.ts:11`). We announce tours two to
    three months ahead.
  - The rest of the sign-up is missing too:
    - there's no cap, so lunch for 40 means a cap of 20 cars and a waitlist;
    - nobody is asked what they're bringing;
    - a guest must join the whole crew to answer (`crew_events.js:536`, "join the crew to answer");
    - the briefing is 280 characters (`events.ts`, `notes`);
    - there's no roster I can print for the sign-in sheet.
  - The phone shows a live "612 SCORE" all drive (`guided-drive/phone/020-driving.png`), and the crew board ranks by
    total drive Score (`crew_standings.js`, `/api/crews/:id/board`). Our insurance says a tour is not timed or competitive.
    I can't put a live score on 20 club members' phones on a public road and then post a ranking that afternoon. I won't
    argue with the owner about the Score in general. I'm asking for an off switch on the club's tour.
- **What to build.**
  - Plan up to 120 days out.
  - **Cars:** an optional cap with a waitlist that moves up on its own when someone says Can't. RSVP asks "Bringing:"
    from your garage (one tap, or "Not saying").
  - **Briefing:** a 2,000-character drivers' meeting note, shown on the morning-of card.
  - **Guests:** a guest link for one drive. It lets a signed-in person RSVP and join that drive's convoy without joining
    the crew, and it ends with the drive.
  - **Roster:** the planner gets one "Roster" key that shares a plain list (handle, car, going/maybe, lead/sweep) through
    the share sheet.
  - **No scores:** a "Tour, not timed" switch on the drive, on by default for drives with 6 or more going. While in that
    drive's convoy, the binnacle shows `--` for Score, and the day's drives aren't counted on the crew board.
- **Cost.** M
- **Done looks like.** I post October's tour in July, cap it at 20, and four people are on the waitlist. On the morning I
  hit Roster and I have my sign-in sheet. Nobody's phone shows a number that afternoon that anyone could call a
  result.

## 3. Did round 1 land?

- The calls landed: "Careful, tight right" and "Careful, square left" in `guided-drive/transcript.txt` are words a
  car-park briefing could use. End-with-Undo is good for a lead who fumbles a mount.
- The social half is still unreviewable because R-4's seeded world wasn't built. My whole job lives in empty states.
- The example crew card still says "Board: the week's smoothest drivers" (`signed-in/003-crews.png`), against the
  owner's own note that it's the Vetta Score, not smoothness.

## 4. What I'd protect

1. **The convoy's privacy model.** Positions are never stored, it ends and is gone, other members see handles only, and
   the leader can remove someone for good. That's what lets me ask 20 club members to turn it on.
2. **The drive card's four states with "Start the convoy" inviting everyone going in-app.** In a parking lot, no links
   and no QR fumbling for the regulars is exactly right. Size it up (PE-1); don't redesign it.
