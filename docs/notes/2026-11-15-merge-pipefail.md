# STATE
## Session 2026-11-15 (merge pipefail): a refused graph-us merge fails its own step (claude/project-thread-39xbx9)
- Bug fixed: graph-us.yml "Merge and pack" piped merge_index through tee without pipefail, so run 43673897128's refused merge passed and the release step failed later on a missing packs/index.json, hiding the real error.
- Next: none for this; the republish (run 43693850571) is uploading to R2.
