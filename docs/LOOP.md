# Review loop (one tick)

The loop thread (top tier, currently Claude Opus) is the architect and reviewer. It does design,
`/core` math, parity and anything subtle itself, and hands the rest to cheaper models as T3
delegated tasks: a **fast** tier, a **mid** tier, and the owner's **local** GPU. It reviews every
diff before it merges. It runs every 30 minutes and early when a delegated task finishes (T3
wakes this thread) or CI changes on a PR it opened. The owner has approved merging to `main`
once CI is green (the app is unreleased; every merge is one squash commit, so `git revert`
undoes it). The loop never pauses itself; when stuck on an item it skips it.

Checkout: `C:/Users/senft/Projects/ApexNav`. Never work in the scratch copies.

## Current owner priority (2026-10-26)
Read and prioritize road-1 through road-4 and convoy-1 through convoy-3 in docs/WORKER_QUEUE.md as coequal top priorities before other feature work. Road intelligence means app-open sharing independent of personal recording, full supported measurement upload/processing and substantial routing influence. Convoys mean a leader's detected pothole immediately streams to approaching followers for spoken co-driver warnings, without waiting for road-profile batching, recording or multi-pass verification. Send first; the three-second cancel window retracts rather than delays. Sequence shared sensor foundations where needed without deferring all convoy work until road intelligence is complete. UX/UI, easy convoy joining and honest connection/sharing feedback are acceptance criteria. Checkpoint active overlapping work first.

## Tiers
Pick the cheapest tier that can do the job **from a short brief**. A brief is a goal, the files,
the constraints and an acceptance check, in one or two paragraphs. Never write old/new lines for
a delegate: if the change can only be described line by line, it is small enough to make
yourself in less time than the brief takes.

| Tier | Models (`providerInstanceId` / `model`) | Give it |
|---|---|---|
| **fast** | `codex` / `gpt-6-luna` (`reasoningEffort` `low`); `antigravity` / `gemini-3.8-flash-medium`; last resort `claudeAgent` / `claude-haiku-5-5` (effort `low`) | Read and report ("list every place index.html does X, with line numbers"), CI log triage, mechanical sweeps across many files, tests from a written behaviour list, docs drafts, checking a PR against the brand rules. |
| **mid** | `codex` / `gpt-6-sol` (`reasoningEffort` `medium`); `antigravity` / `gemini-4-argon-medium`; last resort `claudeAgent` / `claude-sonnet-5-5` (effort `medium`) | A feature or bug fix with a clear brief and acceptance check: UI wiring, new screens, From/To-style changes, refactors within web/, a test suite for new logic. |
| **local** | `pi` / `ollama/qwen3-coder:30b` (owner's RTX 5080, free, 32k context, slow) | Only jobs where its output is much larger than the brief and a machine checks it: generate test cases, a repetitive sweep with a grep-able pattern, boilerplate. One file or a pattern, never "understand index.html" (2000 lines overflow its context). One job at a time (one GPU). |
| **top** (you) | the loop thread | Architecture and design, `/core` math, `web/apex_core.js` parity, ApexKit and live sensor math, data-honesty questions, deciding what to build, writing briefs, reviewing every delegate's diff, merging. |

Within a tier, prefer **non-Claude** models (owner 2026-10-26): the Claude subscription is kept
for the loop's own design and review. Alternate Codex and Antigravity; use a Claude model only
when both report a usage limit or error, and say so in the tick report. Keep your own work
lean: for a `top` item write the design and hand the build to mid rather than coding it
yourself, unless it is `/core` math, parity, ApexKit or smaller than its brief. If a
model above is missing from `orchestrator_capabilities`, take the nearest one of that tier.
Escalate a job one tier after one failed attempt; do not retry the same tier twice. Never use the
T3 **OpenCode** provider for the local model: T3 injects its orchestration tools there and the
30B model calls them (it launched a stray thread in testing). Pi keeps MCP tools away from it.

Several delegates may run at once if their files do not overlap: at most 3 cloud tasks plus 1
local. Two tasks that touch the same file go one after the other.

## Delegating
`delegate_task` with `target {providerInstanceId, model, options}`, `isolation: "worktree"`
(it starts from the main checkout's current commit, so pull first), `mode: "async"`,
`title: "<tier> <id>"`, `clientRequestId: "<id>-<n>"`. Record each in `.worker/tasks.json`
(gitignored): `{id, tier, model, taskId, childThreadId, files, startedAt}`. Then end the tick.

Brief template:
```
You are working on Vetta (your current directory is its checkout). Read CLAUDE.md first.
Goal (<id>): <what and why, one paragraph>
Files: <files you expect to change>; do not touch core/, web/apex_core.js or ApexKit/ unless named.
Constraints: <brand/honesty rules that apply>; unknown data stays unknown (null / --).
Done when: <acceptance check, e.g. a test that must pass, a behaviour in the browser>.
Do not commit, push or open PRs. Do not start other threads or tasks. Never ask questions;
make the reasonable choice and say so. When done run `python -X utf8 -m pytest tests -q`, fix
what you broke, and reply with what you changed, file by file, and anything you were unsure of.
```
For the local tier add: "For files over 400 lines, find the spot with grep and read only the
lines around it."

## Each tick
1. `git checkout main && git pull --ff-only`. If the main checkout has changes you did not
   make, leave them alone.
2. Read `.worker/tasks.json`; `task_status` each entry. Older entries may still be in
   `.worker/pi/<id>.json` (tier local); handle them the same way and delete the file after. Also
   `python tools/local_worker.py jobs` in case the CLI fallback left a job. If Ollama is down, start it
   (`Start-Process "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"`) and say so.
3. **Each finished task**: read its summary; `t3_thread_read(childThreadId)` gives
   `thread.worktreePath`. In that worktree `git status` and `git diff`; review against the brief,
   CLAUDE.md and docs/BRAND.md. `git status` the main checkout too: anything there the task
   touched means it escaped; revert those files and treat the task as failed. Then:
   - **Good or nearly good**: in the worktree `git switch -c work/<id>`, commit, `git pull
     --rebase origin main`, make small fixes yourself, `python -X utf8 -m pytest tests -q`, set
     the item to `merged (#PR)` in docs/WORKER_QUEUE.md and add one line to docs/STATE.md
     (amend), push, open a PR to `main`, `link_pull_request`, `watch_pull_request`. Merge with
     `gh pr merge --squash --delete-branch` when CI is green.
   - **Wrong**: escalate one tier with a brief that says what went wrong. After a mid-tier
     failure, do it yourself or set `dropped (reason)`.
   - **Harmful** (core math, invented data, broken parity): set `dropped`, note why.
   Then `git worktree remove --force <path>` and delete its `t3/…` branch (if Windows says the
   folder is locked, leave the folder; git has forgotten it). Remove the entry from
   `.worker/tasks.json`.
4. **Start new work** while slots are free: take `todo` items from docs/WORKER_QUEUE.md in order
   (Priority section first). Read enough code to confirm the item is still needed (else
   `dropped (already done)`). Use the item's `tier` unless you see a reason to change it; a `top`
   item you do yourself on a `claude/<id>` branch, splitting off fast/mid sub-tasks where that
   helps (e.g. a fast task to map the code, or a mid task for the UI half of a design you wrote).
5. **CI failed on a loop PR**: fix it on the branch yourself (or delegate the fix to mid with the
   log) or close the PR and set `dropped`. PRs that only touch `web/` skip the iOS jobs; they run
   on `main` after the merge. After each merge check `gh run list --branch main --limit 3`; if
   iOS failed there, fixing it comes before any queue item.
6. **Queue empty**: add items from docs/BRAND.md §7 and docs/STATE.md "Exact Next Task", each
   with a tier. Never queue for delegates: `/core` math, `web/apex_core.js` parity, ApexKit, or
   deleting owner-visible features without the owner's yes (BRAND §7 item 19, the Jarvis voice).
7. Report in one or two lines. Lead with big events: a merge, a CI failure, a failed delegate,
   tests red on `main`.

CLAUDE.md applies to every tier: `pytest tests -v` after any `/core` or `web/apex_core.js` edit,
the fixture + `swift test` after live sensor math edits, `project.yml` and the iOS workflow stay
valid.

## CLI fallback for the local tier (`tools/local_worker.py`)
Only if the `pi` provider shows a constraint in `orchestrator_capabilities`.
`dispatch --id <id> --task-file .worker/tasks/<id>.md --files <file>`, `jobs`, `show <id>`,
`discard <id>`. Jobs run in a clone at `../ApexNav-worker/<id>` and report through
`.worker/jobs/<id>/job.json`; status `escaped` means it wrote into the main checkout. A webhook
wakes the loop when a job ends. Review and merge as in step 3, then `discard <id>`.
