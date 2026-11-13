# STATE

## Session 2026-11-13 (carplay overview): Overview while guiding on the car (claude/project-thread-me97iw)
- Apple Maps and Waze have Overview while guiding (the whole route at a glance); the car could only follow the arrow or be panned. While guiding a route the map's bar now has Overview beside Stops: the whole route, north up and flat, clear of Apple's card (`overview()` on both car maps, CarPlay/ApexCarMap.swift and web/carmap.js), and the key reads Recentre until tapped again or a pan ends.
- Next: TestFlight on Nate's car.

# CALL SHEET

## 2026-11-13 (carplay overview): a bar key, not a map button (claude/project-thread-me97iw)
- Why: the map buttons are full while driving (Report, voice, zoom in, zoom out); the bar's leading side had room for a second key beside Stops, and a word reads better than another glyph.
- Undo: drop `overview` from `leadingNavigationBarButtons` in `driveStarted` (CarPlay/ApexCarPlay.swift).
