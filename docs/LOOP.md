# Review loop (one tick)

The owner's GPU does the bulk coding: `qwen3-coder:30b` on Ollama, driven by the **Pi** coding
agent as a T3 delegated task (each job in its own T3 worktree). A frontier model runs this
procedure every 30 minutes, and early when a worker task finishes (T3 wakes this thread) or CI
changes on a PR it opened. The owner has approved merging to `main` once CI is green (the app
is unreleased; every merge is one squash commit, so `git revert` undoes it). The loop does not
pause itself; when stuck it skips the item.

Fallback: if `orchestrator_capabilities` shows the `pi` provider with a constraint (not
installed, disabled), dispatch through `tools/local_worker.py` (OpenCode CLI in a clone,
webhook wake-up) exactly as before; its commands are at the end of this file. Do not use the T3
**OpenCode** provider: T3 injects its orchestration tools there and the 30B model calls them
(launched a stray thread in testing). Pi keeps MCP tools out of the model's tool list.

Checkout: `C:/Users/senft/Projects/ApexNav`. Never work in the scratch copies.

## Each tick
1. `git checkout main && git pull --ff-only` (the worker's worktree starts from this commit).
   If the main checkout has changes you did not make, leave them alone.
2. Find the worker job: `.worker/pi/<id>.json` holds `{id, taskId, childThreadId}` for the job
   you dispatched (`.worker/` is gitignored). Also run `python tools/local_worker.py jobs` for
   any job left from the CLI fallback and handle it the old way. If Ollama is down, start it
   (`Start-Process "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"`) and say so.
3. **Job running** (`task_status` workState `working`): nothing to do; end the tick. Never
   wait on the worker. One job at a time: the GPU cannot run two.
4. **Job finished**: `task_status` gives the worker's summary; `t3_thread_read(childThreadId)`
   gives `thread.worktreePath` and `branch`. In that worktree run `git status` and `git diff`
   and review against the task, CLAUDE.md and docs/BRAND.md. Check `git status` in the main
   checkout too: anything there that the job touched means it escaped; revert those files and
   treat the job as wrong. Then one of:
   - **Good or nearly good**: in the worktree `git switch -c worker/<id>`, commit the worker's
     change, `git pull --rebase origin main`, make small fixes yourself, run
     `python -X utf8 -m pytest tests -q` there, set the item to `merged (#PR)` in
     docs/WORKER_QUEUE.md and add one line to docs/STATE.md (amend into the commit), push
     `worker/<id>`, open a PR to `main`, `link_pull_request`, `watch_pull_request`. When CI is
     green, `gh pr merge --squash --delete-branch`.
   - **Wrong but salvageable**: redispatch with a sharper task as `<id>-r2` (at most two
     retries). After that, do it yourself if it is small, or set the item to `dropped (reason)`.
   - **Harmful** (touches core math, invents data, breaks parity): set `dropped`.
   Afterwards remove the worktree: `git worktree remove --force <path>` and delete its `t3/…`
   branch; if Windows says the folder is locked, leave the folder (git has forgotten it) and
   move on. Delete `.worker/pi/<id>.json`.
5. **Worker idle, nothing to review**: take the first `todo` in docs/WORKER_QUEUE.md (the
   Priority section comes first; a `reviewer` item there you implement yourself, and the worker
   may take the next `worker` item meanwhile). Read the code first; if it is already done, set
   `dropped (already done)` and take the next. Write a precise task: exact file,
   selectors/functions, old and new strings, what must not change. The local model does well
   with one file and an exact spec, and badly with "per §7". For a file over ~400 lines
   (web/index.html is 2000) say "find it with grep, then read only N lines around it": a
   whole-file read overflows its 32k context and it forgets the task (brand-17 and route-1 both
   failed that way). Dispatch with `delegate_task`:
   `target {providerInstanceId: "pi", model: "ollama/qwen3-coder:30b"}`, `isolation: "worktree"`,
   `mode: "async"`, `title: "worker <id>"`, `clientRequestId: "worker-<id>"`, and the task text
   below with the spec filled in. Write `.worker/pi/<id>.json` with the returned `taskId` and
   `childThreadId`, then end the tick.

   Worker task text:
   ```
   You are the local coding worker for the ApexNav repository (your current directory is its
   checkout). Read CLAUDE.md first.
   Task <id>: <spec>
   Files you may edit: <files>
   Rules: smallest change that does the task; small in-place edits, never rewrite a whole file;
   do not touch core/, web/apex_core.js or ApexKit/ unless the task names them; do not commit,
   push or create branches; unknown data stays unknown (null / --), never invent road data; use
   only your coding tools (read, bash, edit, write, grep, find, ls); never ask questions.
   When done run `python -X utf8 -m pytest tests -q`, fix any failure you caused, then reply
   with what you changed, file by file, and anything you were unsure about, and stop.
   ```
6. **CI failed on a loop PR**: fix it on the branch yourself or close the PR and set `dropped`.
   PRs that only touch `web/` skip the iOS jobs; they run on `main` after the merge. After each
   merge check `gh run list --branch main --limit 3`; if iOS failed there, fixing it is the next
   job, before any queue item.
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

## CLI fallback (`tools/local_worker.py`)
`dispatch --id <id> --task-file .worker/tasks/<id>.md --files <file>`, `jobs`, `show <id>`,
`discard <id>`. Jobs run in a clone at `../ApexNav-worker/<id>` and report through
`.worker/jobs/<id>/job.json`; status `escaped` means it wrote into the main checkout. Review
and merge as in step 4, using the clone instead of a worktree, then `discard <id>`.
