# STATE

## 2026-11-14 The place card says how long the drive is (claude/project-thread-5sbga7)
- Done: the place card's Go key now reads "Go here · 12 min", as Apple and Google Maps' place cards do. It's the quick router's time from where you are. VoiceOver reads "Go here, a 12 min drive". With no fix, no answer, under 150 m or over 300 km away, the key stays "Go here". A slow answer for one place never lands on the next place's card.
- Tests: e2e "the place card says how long the drive there takes" stubs Valhalla's sources_to_targets (731 s, shown as 12 min). It checks the key and its label, then checks that a second place with no answer leaves the key plain. Also ran: the flows that count matrix calls (short trip, own routing, Valhalla for Quick only, route overview), the dropped pin flow and both place flows.

# CALL SHEET

## 2026-11-14 Valhalla's matrix for the place card's time
- What: pinDriveTime in cockpit.js asks valhallaMatrix([here], [place]) once per card.
- Why: it's the quick time, the Quick route's own router (Nate 2026-11-11: Valhalla only for Quick). It's one small request per card a person opens. Our own graph would cover only some places.
- Undo: remove the pinDriveTime(point) call in showPin.
