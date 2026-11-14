# STATE

## Session 2026-11-13 (carplay lanes): the car's guidance card shows which lanes to be in (claude/project-thread-me97iw)
- Apple Maps and Waze show lane guidance on the car; the phone's road book drew the router's lanes (web/lanes.js, R-29) and the car showed nothing. Now a turn's card carries its lanes: guideMessage adds the step's packed lanes, cockpit.js carLanes draws them (web/carplay.js laneGlyphs: the road book's arrows, the lanes to use at full ink, the ones that also work dimmer) into a PNG, and the shell sets it as CPManeuver.junctionImage. No lane data, no image: unknown stays unknown.
- Next: check it on a real car (TestFlight) at a motorway exit; if the card crowds, drop the image under 2 lanes to use.

# CALL SHEET

## 2026-11-13 (carplay lanes): lanes as the maneuver's junction image, not CarPlay's iOS 17.4 lane guidance (claude/project-thread-me97iw)
- Why: junctionImage has been in CPManeuver since iOS 12 and needs no session-level lane objects; it can't be compiled here (CI only), so the smaller, older API first. The image is the phone road book's own drawing, so the car and phone agree.
- Undo: drop the `m.junctionImage` line in ApexCarPlay.swift guideChanged (the page's image is then ignored).
