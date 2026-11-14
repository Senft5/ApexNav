# STATE

## 2026-11-14: the drive page (Log → a drive) and Stages join the Vetta system
- Before, in the Vetta look, the drive page drew every box as white paper with a shadow on a white page. That covered the map, the speed and g lanes, the corners, the timeline and Stages' cards. Its zoom keys were square outlines, and its tags were tilted rubber stamps in capitals.
- Now every box is a raised, rounded card, flat. The selected corner gets a red ring. Recenter is a floating pill.
- The zoom keys are rounded, on the raised fill, with the picked one inked.
- Tags, and the stamps on the map page, are raised pills in sentence case. The picked one is inked.
- Secondary keys such as Pick a video sit on the raised fill.
- Newly possible: a drive's own page looks like the rest of the app, day and night. Shots: /mnt/project-files/ui-thread/drive-page-system.png.
- CSS only (`web/system.css`), scoped to `[data-theme="roadbook"]`.

# CALL SHEET

## 2026-11-14: the tilted stamp goes in the Vetta look
- What: `.stamps` (drive tags, avoid kinds, spot kinds) become pills in the Vetta look. They lose the capitals and the tilt on the picked one.
- Why: they were the last square, outlined control in the system. The tilted stamp belonged to the old Roadbook paper look.
- Undo: delete the two `.stamps` rules at the end of `web/system.css`. The other looks keep the stamps.
