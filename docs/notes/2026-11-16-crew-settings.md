# STATE

## 2026-11-16 Manage crew and Your settings
- Done: the crew settings sheet is two sheets by role. The owner's Manage key opens Manage crew (name, who can invite, who can find it, what it sees of yours, Delete crew); a member's Joined key opens Your settings (what it sees of yours, Leave crew). `PUT /api/crews/:id` with only `name` renames without touching visibility or area. Tests: backend/test/crews.test.ts "Manage crew renames it…", e2e crew page flow (rename) and the crews dashboard flow (a member's sheet).
- Next: from `social/screen-inventory.md`: Find or start a crew (nearby public crews as cards), crew empty / offline states.

# CALL SHEET

## 2026-11-16 The owner's Leave says Delete crew
- What: the owner's key on Manage crew reads Delete crew, with a confirm that names what goes; members keep Leave crew.
- Why: the owner leaving already dissolved the crew (social.ts crewLeave); "Leave" hid that.
- Undo: label it Leave again in web/cockpit.js crewSettingsFor.
