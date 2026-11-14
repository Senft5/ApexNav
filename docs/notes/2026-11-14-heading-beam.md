# STATE

## 2026-11-14 Heading beam, and the app tells the page when Location is off (claude/project-thread-5sbga7)
- Done: in the app, the idle map draws a soft cone from your arrow toward where the phone points, as Apple Maps does. It comes from the phone's compass, starts with location, and is sent only while iOS is sure of the heading to within 30 degrees and the reading is under 5 s old. It shows while you stand or walk (3 m/s or slower). In a car the arrow already points along the road. With no compass reading, there's no cone, and the website shows none.
- Fixed: LiveFrame's own encode(to:) never encoded location_off. So in the app, the page never heard that Location was off and could wait on "Finding GPS" forever. location_off is encoded now.
- Tests: tests/test_car_native.py checks that every CodingKeys key is encoded. It fails on the old Swift for location_off and heading_deg. tests/test_gps_halo.py covers beam(). e2e "the heading beam" fakes the app's shell and checks the cone at 120 degrees. It goes when moving at 12 m/s, comes back standing, and goes without a reading. Swift compiles only in CI.
- Next: check the cone on a phone on the next TestFlight build.

# CALL SHEET

## 2026-11-14 Compass heading in the live frame
- What: ApexNavApp.swift calls startUpdatingHeading (headingFilter 3°) next to startUpdatingLocation, and didUpdateHeading keeps trueHeading while headingAccuracy is 30° or better. LiveFrame gains heading_deg, rounded to a whole degree, null when stale or unsure. In the page, gps_halo.js beam() and a map-flat Marker (.heading-beam) draw it.
- Why: the idle map couldn't show which way you face when standing. The compass needs no new permission.
- Undo: remove startUpdatingHeading and the didUpdateHeading delegate; the page then shows no cone.
