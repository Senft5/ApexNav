# STATE
## Session 2026-11-14 (OSM route context, lower 48): build without every extract, weekly (claude/roam-c-osm-ctx-us-partial)
- On the second full run (43638790644), Geofabrik refused five states for the whole of osm-again's retries. That was the day's third lower-48 download. Because osm-again failed, every band job was skipped, and nothing was built.
- Band jobs now run whenever the plan succeeded and the run wasn't cancelled. A chunk that needs a missing state fails on "no extract", and the other chunks build and go up. Publish runs when the band jobs ran, whether they all succeeded or some failed.
- Weekly cron on Thursdays at 05:17 UTC, the day after osm-ctx.yml's region build.
- Next: the first scheduled run (or a manual one on 11-15, once Geofabrik lets runners in again). Then spot-check a tile outside OH/KY/IN on prod and drop osm-ctx.yml's band jobs.

# CALL SHEET
## 2026-11-14 (OSM route context, lower 48): weekly on Thursdays (claude/roam-c-osm-ctx-us-partial)
That is one lower-48 download a week, the most we should ask of Geofabrik. graph-us.yml is monthly. Undo: remove the `schedule:` block.
