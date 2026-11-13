# STATE

## 2026-11-13: Saving an offline area asks the browser to keep it
- Done: `ApexOfflineTiles.download` calls `navigator.storage.persist()` after a save, best-effort, so Safari and Chrome do not evict the saved map under storage pressure; a refusal changes nothing. e2e "offline area kept…".
- Done too: the drives store (`web/recording.js` `store`) asks once a session when a drive is kept.
- Next: none planned.

# CALL SHEET

## 2026-11-13: Ask for persistent storage only on a deliberate save
- What: the persist request runs after the person saves a map area (or a route's map) or a drive is kept (once a session), never at page load.
- Why: Chrome may show a prompt or decide by engagement; asking at the moment of a deliberate save is the honest time, and nothing is asked of people who never save one.
- Undo: delete the `st.persist()` line in `download` and `keepStorage` in `web/recording.js`. Firefox on the website shows a prompt for it; the app's WKWebView does not.
