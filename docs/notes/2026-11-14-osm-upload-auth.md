# STATE
## Session 2026-11-14 (OSM upload auth): the OSM context build may upload to R2 (claude/roam-c-osm-upload-auth)
- The first osm-ctx.yml run on main built every band but each upload got 401: `src/github_oidc.ts` WORKFLOWS let only data-mirror.yml and graph-us.yml in. osm-ctx.yml is now on the list. The run still showed green because `| tee` hid the script's exit; osm-ctx.yml and data-mirror.yml now run that step with `shell: bash` (pipefail).
- Next: run osm-ctx.yml on main again, check `/api/ctx/osm` answers `x-cache: built`, then merge #802 (the phone's relay flag on).

# CALL SHEET
## 2026-11-14 (OSM upload auth): a third workflow may write map data to R2 (claude/roam-c-osm-upload-auth)
osm-ctx.yml is a file on main like the other two, and the key allowlist (data_store.ts) still limits it to `osm/v1/`. Undo: drop it from WORKFLOWS.
