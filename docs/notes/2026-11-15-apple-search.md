# STATE

## 2026-11-15 roam C: typed Where to? search from Apple in the app
- In the iOS app, Where to? text sent without tapping a suggestion (and a maps link's place names) is looked up with MKLocalSearch near the phone (`placeSearch` → `placeFound`, 6 s), then public Nominatim. The website keeps Nominatim. Follows #882 (reverse geocoding from Apple).
- Next: nothing planned here; on the next TestFlight build, typing "Skyline Chili" and Go should land on the nearest one.

# CALL SHEET

## 2026-11-15 roam C: Apple search first for typed places in the app
- What: `resolvePlace` in web/cockpit.js asks the shell's MKLocalSearch before Nominatim.
- Why: Nominatim's search ignores where you are (it returns the first match anywhere) and is weak on US businesses; Apple ranks near you and needs no key.
- Undo: drop the `askNative({cmd:'placeSearch'...})` branch in `resolvePlace`.
