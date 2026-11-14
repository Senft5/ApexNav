# STATE

## 2026-11-14 Your data shows only keys that have something to act on

- **Done:** Garage → Settings → Your data showed "Download drives", "Delete drives on this phone" and "Delete offline
  data" even under "Nothing on this phone yet" and "Nothing saved for offline". Tapping them could only say so in a
  toast. The two drive keys now show only when the phone holds a drive, and Delete offline data only when something is
  saved for offline. Erase everything stays, since settings, spots and sign-in are on the phone too.
  - The e2e flow "your data: Settings counts what the phone holds…" now checks each key before and after. It fails on main.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-14 Hide, not disable, the empty data keys

- **What:** cockpit.js `renderMyData` hides `myGpxBtn` and `myDrivesDelBtn` with no drives; `renderOffline` hides
  `myOfflineDelBtn` under the same test as "Nothing saved for offline".
- **Why:** Nate's standing UX rule asks for clean screens. A red Delete key for nothing reads as if something is there.
- **Undo:** remove those two `hidden =` lines.
