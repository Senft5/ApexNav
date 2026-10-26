# Review loop (one tick)

The owner's GPU does the bulk coding through `tools/local_worker.py` (OpenCode + Ollama,
`qwen3-coder:30b`). A frontier model runs this procedure every 30 minutes, and early when a
worker job finishes (webhook) or CI changes on a PR it opened. The owner has approved merging
to `main` once CI is green (the app is unreleased; every merge is one squash commit, so
`git revert` undoes it). The loop does not pause itself; when stuck it skips the item.

Checkout: `C:/Users/senft/Projects/ApexNav`. Never work in the scratch copies.

## Each tick
1. `git checkout main && git pull --ff-only`. If the main checkout has changes you did not
   make, leave them alone and work only in the worker clones (`../ApexNav-worker/<id>`).
2. `python tools/local_worker.py status` and `jobs`. If Ollama is down, start it
   (`Start-Process "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"`) and say so.
3. **Job running**: nothing to do; end the tick. Never wait on the worker.
   **Job `escaped`** (it wrote into the main checkout): revert only the files listed in
   `main_checkout_status` that the job touched, then treat the job as wrong.
4. **Job finished** (`done`, `failed`, `timeout`, `crashed`, `no_changes`): run `show <id>` and
   review the diff against the task, CLAUDE.md and docs/BRAND.md. Then one of:
   - **Good or nearly good**: in the job's clone, commit the worker's change, then
     `git pull --rebase origin main` (main may have moved since dispatch). Make small fixes
     yourself, run
     `python -X utf8 -m pytest tests -q` there, set the item to `merged (#PR)` in
     docs/WORKER_QUEUE.md and add one line to docs/STATE.md (amend into the commit),
     push `worker/<id>`, open a PR to `main`, call `link_pull_request` and
     `watch_pull_request`. When CI is green, `gh pr merge --squash --delete-branch`, then
     `local_worker.py discard <id>` (deletes the clone; the PR keeps the history).
   - **Wrong but salvageable**: `discard <id>` and redispatch with a sharper task as
     `<id>-r2` (at most two retries). After that, do it yourself if it is small, or set the item
     to `dropped (reason)`.
   - **Harmful** (touches core math, invents data, breaks parity): discard, set `dropped`.
5. **Worker idle, nothing to review**: take the first `todo` in docs/WORKER_QUEUE.md. Read
   the code first; if it is already done, set `dropped (already done)` and take the next.
   Write a precise task to `.worker/tasks/<id>.md`: exact file, selectors/functions, old and
   new strings, what must not change. The local model does well with one file and an exact
   spec, and badly with "per §7". Dispatch:
   `python tools/local_worker.py dispatch --id <id> --task-file .worker/tasks/<id>.md --files <file>`.
6. **CI failed on a loop PR**: fix it on the branch yourself or close the PR and set `dropped`.
7. **Queue empty**: add items from docs/BRAND.md §7 and docs/STATE.md "Exact Next Task" that
   suit the worker (mechanical, one or two files, testable). Never queue: `/core` math,
   `web/apex_core.js` parity changes, ApexKit, deleting owner-visible features without the
   owner's yes (BRAND §7 item 19, the Jarvis voice), anything that shows unmeasured data as
   measured.
8. Report in one or two lines. Lead with big events: a merge, a CI failure, a crash, tests red on
   `main`.

CLAUDE.md still applies: `pytest tests -v` after any `/core` or `web/apex_core.js` edit, the
fixture + `swift test` after live sensor math edits, `project.yml` and the iOS workflow stay
valid.
