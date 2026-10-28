"""Synthetic status checks (tools/status_check.py): retry once, core vs dependency, and the exit code."""
import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import status_check as sc  # noqa: E402

GOOD = {
    "/": (200, b"<html><title>ApexNav</title>"),
    "/api/health": (200, json.dumps({"ok": True, "db": True}).encode()),
    "valhalla": (200, json.dumps({"trip": {}}).encode()),
    "osrm": (200, json.dumps({"code": "Ok"}).encode()),
    "liberty": (200, json.dumps({"layers": []}).encode()),
    "terrarium": (200, b"\x89PNG...."),
    "overpass": (200, b"Connected as"),
}


def fake(overrides=None, calls=None):
    table = {**GOOD, **(overrides or {})}

    def get(url, data=None):
        if calls is not None:
            calls.append(url)
        key = next(k for k in table if (url.endswith(k) if k.startswith("/") else k in url))
        v = table[key]
        if isinstance(v, Exception):
            raise v
        return v(url) if callable(v) else v
    return get


def go(get):
    return sc.run("https://x.test", get=get, sleep=lambda s: None)


def test_all_good():
    res = go(fake())
    md, core_ok = sc.summarize(res, when="now")
    assert core_ok and all(r["ok"] for r in res) and len(res) == 7
    assert "All systems normal" in md


def test_database_down_is_a_core_failure():
    res = go(fake({"/api/health": (503, b'{"ok":false,"db":false}')}))
    md, core_ok = sc.summarize(res, when="now")
    assert not core_ok and "ApexNav is DOWN" in md and "| API and database | core | FAIL | 503 |" in md


def test_a_dependency_down_is_not_an_outage():
    res = go(fake({"overpass": TimeoutError("slow")}))
    md, core_ok = sc.summarize(res, when="now")
    assert core_ok and "a dependency is not" in md and "| Overpass | dependency | FAIL | TimeoutError |" in md


def test_one_retry_absorbs_a_blip():
    seen = []
    answers = iter([(502, b""), (200, b"<title>")])
    res = go(fake({"/": lambda url: next(answers)}, calls=seen))
    assert res[0]["ok"] and seen.count("https://x.test/") == 2


def test_workflow_uses_pipefail_and_runs_on_a_schedule():
    wf = Path(".github/workflows/status.yml").read_text()
    assert "python tools/status_check.py | tee status.md" in wf
    assert "shell: bash" in wf, "without pipefail the step would report tee's exit code"
    assert "schedule:" in wf and "cron:" in wf
