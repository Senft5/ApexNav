# STATE

## 2026-11-13: App ID capabilities without the developer portal
- Nate asked for Push, Time Sensitive Notifications, WeatherKit, Siri, App Attest and Data Protection on com.senft.ApexNav (Associated Domains waits for a domain).
- tools/asc_capabilities.py (workflow "App ID capabilities", on demand) lists the App ID's capabilities and switches on the ones the App Store Connect API knows: Push, SiriKit, Data Protection. Time Sensitive, WeatherKit and App Attest aren't API capability types, so they are entitlements in project.yml and the TestFlight job's cloud signing adds them, as it did for CarPlay. aps-environment comes with Social's push PR (#682).
- Next: run the workflow from main, then watch the next TestFlight run sign. If it fails on one entitlement, drop that line from project.yml and tick it in the portal.

# CALL SHEET

## 2026-11-13: data protection at iOS's default class
- What: NSFileProtectionCompleteUntilFirstUserAuthentication, not Complete.
- Why: Complete locks files while the phone is locked, and a drive often runs with the phone locked in its mount (CarPlay, background GPS). The default class still encrypts everything until the first unlock after a restart.
- Undo: change the value in project.yml and in tools/asc_capabilities.py WANT.
