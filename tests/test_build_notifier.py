"""ApexBuildNotifier.swift (REVIEW.md 5.3): new steps on builds you follow, as local notifications from a background app
refresh; registered before launch ends, permission asked only on Follow, declared in project.yml, built by CI."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
read = lambda *p: (ROOT.joinpath(*p)).read_text()


def test_registered_at_launch_and_scheduled_when_leaving():
    app = read("ApexNavApp.swift")
    assert "init() { ApexBuildNotifier.register() }" in app
    assert "if phase == .background { ApexBuildNotifier.schedule() }" in app
    assert 'if cmd == "notifyBuilds" {' in app and "ApexBuildNotifier.requestPermission()" in app


def test_declared_and_built():
    yml = read("project.yml")
    assert "- path: ApexBuildNotifier.swift" in yml and "- fetch" in yml and "- com.senft.ApexNav.builds" in yml
    assert 'taskId = "com.senft.ApexNav.builds"' in read("ApexBuildNotifier.swift")
    wf = read(".github", "workflows", "build.yml")
    assert "'ApexBuildNotifier.swift'" in wf and "ApexBuildNotifier\\.swift" in wf


def test_permission_only_when_following_and_only_counts_it_has_not_announced():
    js = read("web", "builds.js")
    assert "if (!b.following && native) { try { native.postMessage({ cmd: 'notifyBuilds' }); }" in js
    src = read("ApexBuildNotifier.swift")
    assert "BuildAlerts.due(list, announced: announced)" in src and "authorizationStatus == .authorized" in src
    kit = read("ApexKit", "Sources", "ApexKit", "BuildAlerts.swift")
    assert "if newSteps > (announced[id] ?? 0)" in kit                                    # the rule, unit-tested in Swift:
    assert "testAnnouncesEachNewStepOnce" in read("ApexKit", "Tests", "ApexKitTests", "BuildAlertsTests.swift")
    assert "requestAuthorization" not in read("ApexNavApp.swift").split("notifyBuilds")[0]   # never at launch
