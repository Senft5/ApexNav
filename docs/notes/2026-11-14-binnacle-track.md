# STATE

## 2026-11-14: the binnacle in the main look: the speed line a track, Sight a pill
- In the main look (web/system.css):
  - The speed line under the speed is a rounded 8 px track on the raised grey, with the speed filled in ink to a ringed tip.
  - The minor ticks are gone and the majors are in the hair. It used to look like a printed ruler.
  - Sight is a raised pill beside the speed-limit sign. When Sight is short (the warning), the pill drops, so the red word keeps its contrast on the panel. The e2e "one red" flow caught 4.38:1 on the pill.
- Newly possible: the speed against the scale reads as one bar at a glance.
- Screenshot: /mnt/project-files/ui-thread/binnacle-track.png
- Next: type-scale tokens; the People and Garage pass.

# CALL SHEET

## 2026-11-14: the speed ruler's minor ticks hidden in the main look
- What: `.sl-tick` (minor) is transparent, so only the majors show, in the hair.
- Why: a modern track reads faster than a ruler, and the numerals under it still give the scale.
- Undo: drop the `.sl-tick` rules from web/system.css.
