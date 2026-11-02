"""The review recording (docs/REVIEW_RECORDING.md): its replay and hooks exist only in debug builds, the flows only run on
demand, and the transcript line reaches the shell only in review mode."""
import os
import re
from tests.page_source import cockpit_source

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
    html = cockpit_source()
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
    assert "People still shows the sign-in page" in flows
    yml = read(".github", "workflows", "app-review.yml")
    assert "phone-start.txt" in yml and "car-start.txt" in yml
    pack = read("tools", "review_pack.py")
    assert '-start.txt"' in pack and "def upright(" in pack
    html = cockpit_source()
    assert "key.setAttribute('aria-label', `${allowed ? 'Use' : 'Try'} ${t.label}`)" in html, "each Use key names its card (U-69)"


def test_review_recording_writes_nothing_to_the_server():
    """REVIEW4_CHECK U-94: the recording signs in as a real account on the production Worker. Its hazard report is the
    member's sheet, Undo and pin, kept on the phone; every other write is held back by the page, by the shell's one door to
    the Worker, and the backend answers the review account's hazard reports and votes without storing them."""
    html = cockpit_source()
    send = html.split("async function sendHazard(body)")[1].split("\n    }\n")[0]
    assert "if (window.APEX_REVIEW) r = reviewHazard(body);" in send and "else try { r = await ApexSync.apiFetch('/api/hazards'" in send
    review = html.split("function reviewHazard(body)")[1].split("\n    }\n")[0]
    assert "outbox" not in review and "apiFetch" not in review and "reported.local.push(h)" in review and "paintReported()" in review
    assert ".concat(reported.local)" in html, "a reload of the server's hazards keeps the review's own pin"
    still = html.split("async function answerStill(still)")[1].split("\n    }\n")[0]
    assert "if (window.APEX_REVIEW) r = new Response(null, { status: 204 });" in still
    assert "navigator.onLine === false || window.APEX_REVIEW) return; outbox.flush()" in html
    assert "async (b) => window.APEX_REVIEW ? 204 : (await fetch(" in html, "no app-health counts from a recording"
    assert "root.APEX_REVIEW" in read("web", "errors.js"), "no error reports from a recording"
    sync = read("web", "sync.js")
    assert "if (reviewing() && !/^(GET|HEAD)$/i.test(init.method || 'GET'))" in sync
    swift = read("ApexNavApp.swift")
    inside = debug_blocks(swift)
    assert 'NSLog("APEX-REVIEW held %@ %@", method, url.path)' in inside, "the shell holds every write back too"
    hz = read("backend", "src", "hazards.ts")
    assert 'export const REVIEW_USER_ID = "7b39562f-72d8-4f6e-80c8-382820afb133";' in hz
    assert hz.count("if (isReview(v)) return") == 2, "reports and votes"


def test_sync_holds_writes_in_review_mode():
    """web/sync.js apiFetch, run in node: in review mode a write answers 204 and never calls fetch; a read still goes."""
    import shutil
    import subprocess
    node = shutil.which("node")
    if node is None:
        import pytest
        pytest.skip("node not installed")
    run = r"""
      const calls = [];
      globalThis.fetch = async (url, init) => { calls.push([(init && init.method) || 'GET', url]); return new Response('[]', { status: 200 }); };
      globalThis.APEX_REVIEW = true;
      const S = require(process.argv[1] + '/web/sync.js');
      (async () => {
        const w = await S.apiFetch('/api/hazards', { method: 'POST', body: '{}' });
        const v = await S.apiFetch('/api/presence', { method: 'post', body: '{}' });
        const r = await S.apiFetch('/api/hazards?lat=1&lon=2', { method: 'GET' });
        console.log(JSON.stringify({ w: w.status, v: v.status, r: r.status, calls }));
      })();
    """
    out = subprocess.run([node, "-e", run, ROOT], capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
    import json
    got = json.loads(out)
    assert got["w"] == 204 and got["v"] == 204 and got["r"] == 200
    assert got["calls"] == [["GET", "/api/hazards?lat=1&lon=2"]], got


def test_recording_notes_of_the_second_recording():
    """REVIEW4_CHECK §4 (1)-(7): videos closed before upload, the app's own log, the welcome shot when it is up, the replay
    closed before the tabs, the route card dragged open, the island and landscape with a note up, a standstill (U-86)."""
    yml = read(".github", "workflows", "app-review.yml")
    assert 'wait "$p"' in yml and "kill -0" in yml and "sleep 4" not in yml, "simctl must finish writing the video (moov)"
    assert "tail -4000" not in yml and 'eventMessage BEGINSWITH "APEX-"' in yml
    swift = read("ApexNavApp.swift")
    inside = debug_blocks(swift)
    for needle in ("APEX-CONSOLE", "cmd: 'console'", "APEX_REPLAY_HOLD", "replay standing"):
        assert needle in inside and swift.count(needle) == inside.count(needle), f"{needle} sits inside #if DEBUG"
    flows = read("UITests", "ReviewFlows.swift")
    body = lambda t: flows.split(f"func {t}()")[1].split("    func test")[0]
    first = body("test01FirstRun")
    assert first.index('"the welcome never came up"') < first.index('shot("opening")') < first.index('shot("welcome-\\(k)")')
    tabs = body("test02Tabs")
    assert tabs.index("closeReplay()") < tabs.index('tab("Log")')
    plan = body("test03Planning")
    assert "thenDragTo:" in plan and plan.index("thenDragTo:") < plan.index('shot("route-card-open")')
    guided = body("test04GuidedDrive")
    assert guided.index("driveTo(13.4)") < guided.index("home-live-activity") < guided.index('"landscape"')
    assert "hold: Self.STANDSTILL" in body("test07Billet")
    assert sum("hold:" in body(t) for t in re.findall(r"func (test\w+)\(\)", flows)) == 1, "one flow stands still"


def test_pack_flags_a_video_without_its_index_and_lists_review_events(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("review_pack", os.path.join(ROOT, "tools", "review_pack.py"))
    pack = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pack)
    atom = lambda kind, data=b"": len(data).__add__(8).to_bytes(4, "big") + kind + data
    good, bad = tmp_path / "good.mp4", tmp_path / "bad.mp4"
    good.write_bytes(atom(b"ftyp", b"isom0000") + atom(b"mdat", b"\0" * 64) + atom(b"moov", b"\0" * 16))
    bad.write_bytes(atom(b"ftyp", b"isom0000") + atom(b"mdat", b"\0" * 64))
    assert pack.playable(str(good)) and not pack.playable(str(bad)) and not pack.playable(str(tmp_path / "none.mp4"))
    log = tmp_path / "app-log.txt"
    log.write_text("2026-10-30 06:58:10.120 Df ApexNav[9:9] APEX-REVIEW replay standing 8 s at 25.31 km\n"
                   "2026-10-30 06:58:11.000 Df ApexNav[9:9] APEX-CONSOLE warn something\n", encoding="utf-8")
    assert pack.events(str(log), "06:52:00") == ["06:58:10  @ 06:10  replay standing 8 s at 25.31 km"]


def test_recording_notes_of_the_fifth_recording():
    """REVIEW5 §7 (1)-(9): the replay at real speed and the drive reaching End, the tab bar checked before the tabs, no
    identical scroll frames, the welcome strip's full cycle, landscape on a call and on the quiet line, contrast from the page,
    the largest text size, the island on the quiet line and the lock screen."""
    swift = read("ApexNavApp.swift")
    inside = debug_blocks(swift)
    tick = inside[inside.index("private func tick()"):]
    assert "let dt = min(2, max(0, t - (lastTick ?? t - 0.01))); lastTick = t" in tick and "dt = 0.01," not in tick, "§7.1: on the clock"
    flows = read("UITests", "ReviewFlows.swift")
    body = lambda t: flows.split(f"func {t}()")[1].split("    func test")[0]
    guided = body("test04GuidedDrive")
    assert 'XCTAssertTrue(endDrive(), "the guided drive never reached End (no end card)")' in guided
    assert "return find([\"Open in the Log\"], wait: 6) != nil" in flows
    # §7.2: the tab bar on screen (bottom quarter, no replay over it) before a tab is tapped, and after the replay closes
    tab = flows[flows.index("private func tab(_ name: String)"):flows.index("private func scroll(")]
    assert tab.index("tabBarShown()") < tab.index("tap(name, wait: 6)") and "guard until(6, tabBarShown) else { throw stop(" in tab
    assert "guard until(8, tabBarShown) else { throw stop(" in flows[flows.index("private func closeReplay()"):]
    assert 'onScreen($0, below: 0.75)' in flows and "all.element(boundBy: i)" in flows, "every match looked at, not the first"
    # §7.3: a swipe that changes nothing ends the scrolling
    scroll = flows[flows.index("private func scroll("):flows.index("// MARK: The car")]
    assert "if now == before { break }" in scroll and scroll.index("break") < scroll.index('shot("\\(tag)')
    # §7.4: one full cycle of the welcome's five calls on its beat; the beat is the page's
    first = body("test01FirstRun")
    assert "for k in 1...6" in first and 'shot("welcome-\\(k)")' in first and "WELCOME_BEAT = 1.8" in flows
    cockpit = read("web", "cockpit.js")
    assert "matches ? 4000 : 1800);" in cockpit and cockpit.count("{ type: ", cockpit.index("const OB_NOTES"), cockpit.index("function runOnboarding")) == 5
    # §7.5, §7.8, §7.9: landscape on a call and on the quiet line, the island on the quiet line, the lock screen
    assert guided.index('landscape(16, "landscape-corner")') < guided.index('landscape(10, "landscape-quiet")') < guided.index('homeScreen("home-quiet-line")') < guided.index("driveTo(5)")
    assert 'shot("report-sheet-landscape")' in guided and 'lockScreen("lock-screen-live-activity")' in guided
    assert 'NSSelectorFromString("pressLockButton")' in flows and "guard XCUIDevice.shared.responds(to: lock)" in flows, "skipped where unsupported"
    # §7.6: contrast from the page, in the pack job, never losing the pack
    yml = read(".github", "workflows", "app-review.yml")
    pack = yml[yml.index("  pack:"):]
    assert "node tools/contrast_dump.js review-pack/contrast.md" in pack and "continue-on-error: true" in pack
    dump = read("tools", "contrast_dump.js")
    assert "getComputedStyle" in dump and "notesMode = 'quiet'" in dump and "for (const night of [false, true])" in dump
    # §7.7: the largest accessibility size, as its own flow in the workflow
    dyn = body("test09DynamicType")
    assert '"-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"' in dyn
    assert "test: test09DynamicType, name: dynamic-type" in yml
    for tag in ('tab("Garage")', 'tab("People")', 'tab("Log")', 'shot("route-card")', '"cockpit"'):
        assert tag in dyn, tag


def test_recording_notes_of_panel_round_1():
    """Panel round 1, rank 5 (D-3, R-4c, R-5, T-6, I-6) and the guided drive reaching End: the replay's Done found by its
    real name and a missing tab bar stopping the flow; the theme waiting for the review route and stopping the flow when it
    didn't take; the guided drive never querying the page on its side; the deck and the end card checked after a drive;
    the pack saying which flows failed."""
    flows = read("UITests", "ReviewFlows.swift")
    body = lambda t: flows.split(f"func {t}()")[1].split("    func test")[0]
    html = read("web", "index.html")
    # D-3 / R-4c: recording 6 looked for "Done" and "Close the replay"; the key is named "Done: close the replay"
    assert 'id="replayDone" aria-label="Done: close the replay"' in html
    done = flows[flows.index("private func replayDone()"):flows.index("private func closeReplay()")]
    assert '"Done: close the replay"' in done and 'tap("Done", "Close the replay"' not in flows
    close = flows[flows.index("private func closeReplay() throws"):flows.index("@discardableResult private func endDrive()")]
    assert close.index("replayDone()") < close.index("guard until(8, tabBarShown) else { throw stop(")
    tabs = body("test02Tabs")
    assert tabs.index("try closeReplay()") < tabs.index('try tab("Log")')
    assert tabs.count('try tab("Garage")') == 1, "the Garage tab twice in a row closes the Garage"
    assert "XCTFail(why)" in flows and "struct FlowStopped: Error" in flows
    # T-6: the themed flows wait for their route, and a theme that didn't take stops the flow
    theme = flows[flows.index("private func theme("):flows.index("/// The drive just ended, in the Log")]
    assert 'web.buttons["Route details"]' in theme and theme.index("if route {") < theme.index('try tab("Garage")')
    assert 'guard took() else { throw stop("\\(name) did not take' in theme
    assert 'try theme("Billet", night: false, route: true)' in body("test07Billet")
    assert 'try theme("Tapedeck", night: true, route: true)' in body("test06TapedeckNight")
    # the guided drive: the Report key upright in one query, the phone turned only once the sheet is up (recording 6 ended
    # at step 24 on a snapshot timeout); the window read once a flow, not on every lookup
    guided = body("test04GuidedDrive")
    assert guided.index('"Report a hazard"') < guided.index(".landscapeLeft") < guided.index('shot("report-sheet-landscape")')
    assert 'tap("Report a hazard"' not in guided
    on = flows[flows.index("private func onScreen("):flows.index("private func tabBarShown()")]
    assert "screenFrame()" in on and "app.windows.firstMatch.frame" not in on
    assert 'XCTAssertTrue(endDrive(), "the guided drive never reached End (no end card)")' in guided
    # R-5 / I-6 in the pack: the deck after the car-started drive, no end card over the Garage
    assert 'web.buttons["Start drive"]' in body("test05FreeDrive") and "the deck (Where to? and Start) is not back" in body("test05FreeDrive")
    assert '"the drive\'s end card is over the Garage"' in body("test09DynamicType")
    # failures reach the pack
    yml = read(".github", "workflows", "app-review.yml")
    assert "| tee out/${{ matrix.name }}/test.log || true" in yml


def test_pack_says_which_flows_failed(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("review_pack", os.path.join(ROOT, "tools", "review_pack.py"))
    pack = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pack)
    bad, good, none = tmp_path / "bad", tmp_path / "good", tmp_path / "none"
    for d in (bad, good, none):
        d.mkdir()
    (bad / "test.log").write_text(
        "Test Case '-[ApexNavUITests.ReviewFlows test02Tabs]' started.\n"
        "/x/UITests/ReviewFlows.swift:243: error: -[ApexNavUITests.ReviewFlows test02Tabs] : failed - the replay did not close (no tab bar after Done)\n"
        "Test Case '-[ApexNavUITests.ReviewFlows test02Tabs]' failed (300.1 seconds).\n", encoding="utf-8")
    (good / "test.log").write_text("Test Case '-[ApexNavUITests.ReviewFlows test01FirstRun]' passed (90.0 seconds).\n", encoding="utf-8")
    assert pack.result(str(bad)) == ["FAILED", "failed - the replay did not close (no tab bar after Done)"]
    assert pack.result(str(good)) == ["passed"] and pack.result(str(none)) == []
