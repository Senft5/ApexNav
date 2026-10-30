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
    for needle in ("final class ApexReplay", "APEX_REVIEW_SESSION", "APEX_REVIEW_ROUTE", "APEX_REPLAY_FROM", "APEX-SAID", "\"APEX_REVIEW\"",
                   "ApexReplay.start(", "reviewSignIn", "reviewToken"):
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


def test_recording_reaches_the_corners_and_maps_lines_to_video():
    """REVIEW4 §6: the drives start a mile before Dry Ridge Rd's corners, the themes are switched by their Use key and
    checked, the signed-in flow asserts the member's page, and each video's start time reaches the pack."""
    flows = read("UITests", "ReviewFlows.swift")
    assert "APEX_REPLAY_FROM" in flows and "TWISTIES = 19.8" in flows
    for t in ("test04GuidedDrive", "test06TapedeckNight", "test07Billet"):
        body = flows.split(f"func {t}()")[1].split("func test")[0]
        assert "from: Self.TWISTIES" in body, f"{t} starts before the corners"
    free = flows.split("func test05FreeDrive()")[1].split("func test")[0]
    assert "from:" not in free, "free-drive keeps the drive's real start (the interstate join)"
    assert 'let use = "Use \\(name)"' in flows and 'web.buttons["Use Roadbook"]' in flows, "themes by their Use key, then checked"
    assert "Crew still shows the sign-in page" in flows
    yml = read(".github", "workflows", "app-review.yml")
    assert "phone-start.txt" in yml and "car-start.txt" in yml
    pack = read("tools", "review_pack.py")
    assert '-start.txt"' in pack and "def upright(" in pack
    html = read("web", "index.html")
    assert "act.setAttribute('aria-label', `${ok ? 'Use' : 'Try'} ${t.label}`)" in html, "each Use key names its card (U-69)"
