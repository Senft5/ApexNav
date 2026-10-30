"""The review recording (docs/REVIEW_RECORDING.md): its replay and hooks exist only in debug builds, the flows only run on
demand, and the transcript line reaches the shell only in review mode."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()


def debug_blocks(src: str) -> str:
    """The text inside #if DEBUG ... #else/#endif blocks."""
    out, depth = [], 0
    for line in src.splitlines():
        s = line.strip()
        if s == "#if DEBUG":
            depth = 1
            continue
        if depth and s in ("#else", "#endif"):
            depth = 0
            continue
        if depth:
            out.append(line)
    return "\n".join(out)


def test_replay_and_review_hooks_are_debug_only():
    swift = read("ApexNavApp.swift")
    inside = debug_blocks(swift)
    for needle in ("final class ApexReplay", "APEX_REVIEW_SESSION", "APEX_REVIEW_ROUTE", "APEX-SAID", "\"APEX_REVIEW\"", "ApexReplay.start("):
        assert needle in inside, f"{needle} must sit inside #if DEBUG"
        assert swift.count(needle) == inside.count(needle), f"{needle} appears outside #if DEBUG"
    assert "let replaying = false" in swift, "a release build never replays"


def test_flows_run_on_demand_only():
    yml = read(".github", "workflows", "app-review.yml")
    assert re.search(r"^on:\n  workflow_dispatch:\n\njobs:", yml, re.M), "on demand only (the owner, 2026-10-30)"
    flows = read("UITests", "ReviewFlows.swift")
    assert flows.count('try XCTSkipUnless(env["APEX_REVIEW"] == "1"') == flows.count("    func test"), "every flow skips in normal test runs"
    for name in re.findall(r"test: (test\w+)", yml):
        assert f"func {name}()" in flows, f"the workflow runs {name}, which must exist"


def test_page_logs_lines_only_in_review_mode():
    html = read("web", "index.html")
    assert "if (window.APEX_REVIEW) { try { window.webkit.messageHandlers.apex.postMessage({ cmd: 'said'" in html
