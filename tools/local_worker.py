#!/usr/bin/env python3
"""Local worker: runs coding jobs on the owner's GPU through OpenCode + Ollama.

The reviewer (a frontier model on a 30-minute schedule) never waits on the
local model. It dispatches a job and ends its turn; the job runs detached in
its own clone (../ApexNav-worker/<id>, branch worker/<id>), then runs the test suite and
writes result.json. The next review tick reads the result, reviews the diff,
and commits/opens the PR itself. The worker never commits or pushes (also
denied in ~/.config/opencode/opencode.json).

    python tools/local_worker.py status
    python tools/local_worker.py dispatch --id brand-16 --task-file task.md --files web/index.html
    python tools/local_worker.py jobs
    python tools/local_worker.py show brand-16
    python tools/local_worker.py discard brand-16
    python tools/local_worker.py test

Job state lives in .worker/jobs/<id>/ (gitignored). One job at a time: the
GPU cannot run two 30B jobs usefully.
"""

import argparse
import ctypes
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
JOBS = REPO / ".worker" / "jobs"
WORKTREES = REPO.parent / f"{REPO.name}-worker"
OLLAMA_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("APEX_WORKER_MODEL", "ollama/qwen3-coder:30b")
DEFAULT_TIMEOUT_S = 45 * 60
ACTIVE = ("queued", "running")

PROMPT = """You are the local worker for the ApexNav repository checked out at {wt}.
Edit files only under {wt}; never under any other ApexNav folder. Read CLAUDE.md first.

Task {id}:
{task}

Files you may edit: {files}

Rules:
- Make the smallest change that does the task. Use small in-place edits; never rewrite a whole file.
- Do not touch core/, web/apex_core.js or ApexKit/ unless the task names them.
- Do not commit, push, or create branches. The reviewer does that.
- Unknown data stays unknown (null / --). Never invent road data.
- When done, run `python -X utf8 -m pytest tests -q` and fix any failure you caused.
- End with a short summary: what you changed, file by file, and anything you were unsure about.
"""


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def git(*args, cwd=REPO, check=True):
    return subprocess.run(["git", *args], cwd=cwd, check=check, capture_output=True,
                          text=True, encoding="utf-8", errors="replace").stdout.strip()


def opencode_exe():
    found = shutil.which("opencode")
    if found and found.lower().endswith((".cmd", ".ps1")):
        exe = Path(found).parent / "node_modules" / "opencode-ai" / "bin" / "opencode.exe"
        if exe.exists():
            return str(exe)
    return found


def pid_alive(pid):
    if not pid:
        return False
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    # os.kill(pid, 0) terminates the process on Windows, so ask the kernel instead.
    k32 = ctypes.windll.kernel32
    handle = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return False
    code = ctypes.c_ulong()
    k32.GetExitCodeProcess(handle, ctypes.byref(code))
    k32.CloseHandle(handle)
    return code.value == 259  # STILL_ACTIVE


def load(job_id):
    path = JOBS / job_id / "job.json"
    job = json.loads(path.read_text(encoding="utf-8"))
    if job["status"] in ACTIVE and job.get("runner_pid") and not pid_alive(job["runner_pid"]):
        job.update(status="crashed", finished_at=now())
        save(job)
    return job


def save(job):
    path = JOBS / job["id"] / "job.json"
    path.write_text(json.dumps(job, indent=2), encoding="utf-8")


def all_jobs():
    if not JOBS.exists():
        return []
    jobs = [load(p.name) for p in JOBS.iterdir() if (p / "job.json").exists()]
    return sorted(jobs, key=lambda j: j["created_at"])


def ollama_status():
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=5) as resp:
            names = [m["name"] for m in json.loads(resp.read())["models"]]
        return {"ok": True, "model": MODEL, "model_present": MODEL.split("/", 1)[-1] in names,
                "models": names}
    except Exception as e:  # noqa: BLE001 - report any connection failure as-is
        return {"ok": False, "error": str(e)}


def cmd_status(_):
    jobs = all_jobs()
    print(json.dumps({
        "ollama": ollama_status(),
        "opencode": opencode_exe(),
        "active": [j["id"] for j in jobs if j["status"] in ACTIVE],
        "awaiting_review": [j["id"] for j in jobs if j["status"] not in ACTIVE],
    }, indent=2))


def cmd_dispatch(args):
    busy = [j["id"] for j in all_jobs() if j["status"] in ACTIVE]
    if busy:
        sys.exit(f"worker busy with {busy[0]}; wait for it or discard it")
    if not opencode_exe():
        sys.exit("opencode not found on PATH")
    job_dir = JOBS / args.id
    if job_dir.exists():
        sys.exit(f"job {args.id} already exists; discard it first")
    task = Path(args.task_file).read_text(encoding="utf-8") if args.task_file else args.task
    if not task:
        sys.exit("give --task or --task-file")

    # A separate clone, not a git worktree: OpenCode maps every worktree of a repo to the
    # main checkout and edits files there.
    wt = WORKTREES / args.id
    origin = git("remote", "get-url", "origin")
    WORKTREES.mkdir(exist_ok=True)
    git("clone", "-q", str(REPO), str(wt))
    git("remote", "set-url", "origin", origin, cwd=wt)
    git("fetch", "-q", "origin", cwd=wt)
    git("checkout", "-q", "-b", f"worker/{args.id}", f"origin/{args.base}", cwd=wt)
    job_dir.mkdir(parents=True)
    files = ", ".join(args.files) if args.files else "only the files the task names"
    (job_dir / "prompt.md").write_text(PROMPT.format(id=args.id, wt=wt, task=task.strip(), files=files),
                                       encoding="utf-8")
    job = {"id": args.id, "status": "queued", "created_at": now(), "base": args.base,
           "branch": f"worker/{args.id}", "worktree": str(wt), "model": args.model,
           "files": args.files, "timeout_s": args.timeout}
    save(job)

    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x00000200 | 0x01000000  # DETACHED | NEW_GROUP | BREAKAWAY_FROM_JOB
    cmd = [sys.executable, "-X", "utf8", str(Path(__file__).resolve()), "_run", args.id]
    try:
        proc = subprocess.Popen(cmd, cwd=REPO, creationflags=flags, close_fds=True,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL)
    except OSError:
        # Some parents forbid leaving their job object; the runner then lives as long as the parent.
        proc = subprocess.Popen(cmd, cwd=REPO, creationflags=flags & ~0x01000000, close_fds=True,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL)
    job["runner_pid"] = proc.pid
    save(job)
    print(json.dumps(job, indent=2))


def kill_tree(pid):
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True)
    else:
        os.killpg(pid, 9)


def cmd_run(args):
    job = load(args.id)
    job_dir = JOBS / args.id
    wt = Path(job["worktree"])
    job.update(status="running", started_at=now(), runner_pid=os.getpid())
    save(job)
    main_before = git("status", "--porcelain")

    # The message goes before -f: -f takes an array and would swallow it as a file name.
    cmd = [opencode_exe(), "run", "Do the task described in the attached prompt.md.",
           "--dir", str(wt), "-m", job["model"], "--format", "json", "--auto",
           "--title", f"apex worker {args.id}", "-f", str(job_dir / "prompt.md")]
    with open(job_dir / "opencode.jsonl", "w", encoding="utf-8") as log:
        proc = subprocess.Popen(cmd, cwd=wt, stdout=log, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL)
        try:
            job["opencode_exit"] = proc.wait(timeout=job["timeout_s"])
            status = "done" if job["opencode_exit"] == 0 else "failed"
        except subprocess.TimeoutExpired:
            kill_tree(proc.pid)
            status = "timeout"

    tests = subprocess.run([sys.executable, "-X", "utf8", "-m", "pytest", "tests", "-q"], cwd=wt,
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
    (job_dir / "pytest.txt").write_text(tests.stdout + tests.stderr, encoding="utf-8")
    changed = git("status", "--porcelain", cwd=wt).splitlines()
    job.update(status=status, finished_at=now(), tests_passed=tests.returncode == 0,
               tests_tail=(tests.stdout.strip().splitlines() or [""])[-1],
               changed_files=[line[3:] for line in changed],
               diffstat=git("diff", "--stat", cwd=wt))
    if status == "done" and not changed:
        job["status"] = "no_changes"
    if git("status", "--porcelain") != main_before:
        # The worker wrote outside its clone. Flag it; the reviewer cleans up by hand.
        job.update(status="escaped", main_checkout_status=git("status", "--porcelain"))
    save(job)
    notify(job)


def notify(job):
    """Wake the review loop early (T3 webhook task) instead of waiting for the next tick."""
    hook = REPO / ".worker" / "webhook_url"
    if not hook.exists():
        return
    body = json.dumps({k: job.get(k) for k in ("id", "status", "tests_passed", "tests_tail")}).encode()
    req = urllib.request.Request(hook.read_text(encoding="utf-8").strip(), data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=15).close()
    except Exception as e:  # noqa: BLE001 - the 30-minute tick still picks the job up
        (JOBS / job["id"] / "notify_error.txt").write_text(str(e), encoding="utf-8")


def cmd_jobs(_):
    keys = ("id", "status", "tests_passed", "tests_tail", "changed_files", "created_at", "finished_at")
    print(json.dumps([{k: j.get(k) for k in keys} for j in all_jobs()], indent=2))


def cmd_show(args):
    job = load(args.id)
    job_dir = JOBS / args.id
    print(json.dumps(job, indent=2))
    summary = last_text(job_dir / "opencode.jsonl")
    if summary:
        print("\n--- worker summary ---\n" + summary)
    print("\n--- diff ---\n" + git("diff", cwd=job["worktree"], check=False))


def last_text(log_path):
    """The worker's final message, pulled from OpenCode's JSON event stream."""
    if not log_path.exists():
        return ""
    text = ""
    for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        part = event.get("part") or {}
        if event.get("type") == "text" and part.get("text"):
            text = part["text"]
    return text


def cmd_discard(args):
    job = load(args.id)
    if job["status"] in ACTIVE and job.get("runner_pid"):
        kill_tree(job["runner_pid"])
    shutil.rmtree(job["worktree"], onexc=make_writable_and_retry)
    shutil.rmtree(JOBS / args.id, ignore_errors=True)
    print(f"discarded {args.id}")


def make_writable_and_retry(func, path, _exc):
    os.chmod(path, 0o700)  # git marks pack files read-only, which rmtree cannot delete on Windows
    func(path)


def cmd_test(_):
    sys.exit(subprocess.run([sys.executable, "-X", "utf8", "-m", "pytest", "tests", "-q"],
                            cwd=REPO).returncode)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    p = sub.add_parser("dispatch")
    p.add_argument("--id", required=True)
    p.add_argument("--task")
    p.add_argument("--task-file")
    p.add_argument("--files", nargs="*", default=[])
    p.add_argument("--base", default="main")
    p.add_argument("--model", default=MODEL)
    p.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_S)
    p.set_defaults(fn=cmd_dispatch)
    sub.add_parser("jobs").set_defaults(fn=cmd_jobs)
    for name, fn in (("show", cmd_show), ("discard", cmd_discard), ("_run", cmd_run)):
        p = sub.add_parser(name)
        p.add_argument("id")
        p.set_defaults(fn=fn)
    sub.add_parser("test").set_defaults(fn=cmd_test)
    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
