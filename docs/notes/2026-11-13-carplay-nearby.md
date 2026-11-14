# STATE

## Session 2026-11-13 (carplay nearby): Gas, Coffee and Food on the car (claude/project-thread-me97iw)
- Apple Maps on CarPlay offers Gas, Coffee and Food; the phone got Find nearby today (nearby.js) and the car had nothing like it. The car's Places now starts with a Nearby section (the phone's kinds: Gas, or Chargers for an electric car, Coffee, Food). A kind opens a list that says "Looking nearby…" until the phone's `nearbyFor` answers, then the nearest places by name and distance (`nearbyMessage`, web/carplay.js), and a tap plans the way there (the `go` action, as Where to? does). None: the phone's own empty line.
- Next: TestFlight on Nate's car.

# CALL SHEET

## 2026-11-13 (carplay nearby): in Places, not a fifth idle key (claude/project-thread-me97iw)
- Why: CPMapTemplate's idle bar is full (Where to?, Loops, Places, Drive); Places is where the car's other ready-made destinations are, and a header names the section.
- Undo: send no `nearby` with the places message (cockpit.js carPlaces); the section is then not drawn.
