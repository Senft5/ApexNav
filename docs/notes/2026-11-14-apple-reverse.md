# STATE

## 2026-11-14 roam C: place names from Apple in the app
- In the iOS app, reverse geocoding (a dropped pin's street, the town plate, an offline area's town) asks Apple's CLGeocoder through the shell (`placeReverse` → `placeReversed`), read as a Nominatim-shaped reply by `ApexPlacePlate.fromApple`. Nominatim stays the fallback and the website's source. Nominatim's 1 request/s policy and slow answers were the reason.
- Next: none planned here; watch the place plate on the next TestFlight build.

# CALL SHEET

## 2026-11-14 roam C: Apple geocoder first for place names in the app
- What: `reverseGeocode` in web/cockpit.js tries the shell's CLGeocoder (4 s) before Nominatim.
- Why: Apple's answers are faster and better for US addresses, need no key, and take load off a volunteer service with a strict usage policy.
- Undo: drop the `askNative({cmd:'placeReverse'...})` branch in `reverseGeocode`; Nominatim is used again everywhere.
