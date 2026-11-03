# Tomás Herrera (TO), 27, delivery driver, Phoenix

Model: Haiku. Read: r7 INDEX.md, planning, guided-drive, free-drive, the round 1 vote, PANEL.md, BRIEF.md.

## First impressions

I drive for three delivery apps and Waze runs all day. So my first question is not "is it pretty." It's "can I plan a
run with it in under a minute, and does it tell me when I'll get there." On the planning side, not yet. The search works
(planning/002 suggestions, "Winton Woods" gives five real places), but the route card gives me a duration and no clock
time. planning/005 shows "Fun 45 · 23 min" already selected, and the faster option, "Fun 37 · 16 min", sits right beside
it with the time saved. Fine for a Sunday. For a driver with a window to hit, I'd want Quick picked and "Arrive 11:52"
at the top of the card. The route bar in planning/006 has one red Start and a small chevron. That chevron is my only
hint that there's more under it.

The drive itself reads better than I expected. In guided-drive/phone/002 and 009, the speed dial, the speed limit box
and the "Open" plate are big and plain, and the call strip says "Careful · long" in words. The clock is there too:
the drive status shows "15 min left · 11:22 PM" (guided-drive/phone/285). What I still can't do: add a second stop. The
route card has one "To" line, and that's the whole job for me. I also don't know what "Sight" means from the screen
alone, and I'd bet most of my coworkers don't either.

## Proposals

**TO-1. Clock time first, Quick by default.** S.
Why: planning/005 selects Fun 45 and hides the arrival time. guided-drive/phone/001 shows "23.2 mi · 33 min · 30
corners" with no clock time. I can't decide from that whether I make a 4 o'clock pickup.
Build: on the route card, put "Arrive h:mm" as the largest figure, next to distance. Preselect Quick. Fun shows its
cost as "+7 min for the corners", as planning/005 already does. Keep the Fun figure, just not as the default.
Done looks like: a driver reads the arrival time from the route card in one glance, and Quick is selected unless they
choose Fun.

**TO-2. Stops in order.** L.
Why: the search (planning/002) fills one destination. A delivery day is 12 to 20 stops, and I'd plan them in the
order I drive them. Nothing in the planning flow supports that. Crews and convoys don't need this, and a driver does.
Build: a "Stops" list on the plan sheet. Add a stop by search or by tapping the map. Reorder by drag. Each stop gets its
own arrival time and total time at the bottom. "Drive it" runs the list in order, and the drive's Log entry keeps each stop.
Done looks like: a driver enters 12 stops in one sitting, reorders two, and sees the arrival time at the last one.

**TO-3. Traffic and construction in the report sheet.** S.
Why: the report sheet (guided-drive/phone/067) offers Pothole, Gravel, Debris, Animal, Police and Road closed. For me,
the reports that matter are traffic, construction and a crash ahead. I'd send "Animal" maybe once a year. The sheet
is a good glance target: six large buttons, one tap each.
Build: add "Traffic" and "Construction" to the sheet, and put the two most used at the top. Keep the big buttons.
Done looks like: a driver reports a jam in two taps, and the sheet's top row is the two reports drivers send most.

**TO-4. Ask for Live Activities before the drive.** S.
Why: guided-drive/phone/213 shows "Allow Live Activities from Vetta?" over the lock screen during the drive. Someone on
a delivery route has the phone on the mount and a parcel in the back. A prompt there is one more thing to tap while I'm
moving.
Build: ask for the Live Activities permission from the route card, when the driver taps "Drive it", and not during
the drive.
Done looks like: no permission prompt appears after the drive has started.

## Did round 1 land?

Yes on the drive: "Careful, tight right" and the plate wording (guided-drive/transcript.txt) are short enough to take in at
speed, and Undo in the status row (guided-drive/phone/285, "Undo" beside Report) is the kind of safety net I want. No on
planning: the card still opens on Fun, and the clock time isn't on it.

## What I'd protect

1. The driving screen's big numbers and the "Open" plate. A driver can read them without thinking.
2. The "--" for missing values instead of a made-up number. I trust a screen more when it says "--".
