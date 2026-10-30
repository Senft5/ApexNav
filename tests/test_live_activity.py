"""The drive's Live Activity (IDEAS U-11): the extension target, shared attributes, the shell's handler and the page's updates."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()


def test_extension_target():
    yml = read("project.yml")              # checked as text: CI's Python has no YAML parser
    ext = yml[yml.index("\n  ApexNavLive:\n"):yml.index("\n  ApexNavUITests:\n")]
    assert "type: app-extension" in ext
    assert "PRODUCT_BUNDLE_IDENTIFIER: com.senft.ApexNav.LiveActivity" in ext            # nested under the app's id
    assert "NSExtensionPointIdentifier: com.apple.widgetkit-extension" in ext
    assert 'CFBundleVersion: "$(CURRENT_PROJECT_VERSION)"' in ext                          # must match the app's build number
    app = yml[yml.index("\n  ApexNav:\n"):yml.index("\n  ApexNavLive:\n")]
    assert "- target: ApexNavLive" in app and "NSSupportsLiveActivities: true" in app
    assert "- path: LiveActivity/ApexDriveAttributes.swift" in app


def test_shell_and_page():
    swift, html = read("ApexNavApp.swift"), read("web", "index.html")
    assert 'if cmd == "activity"' in swift and "Activity.request(attributes: ApexDriveAttributes" in swift
    # never stuck after the drive (the owner, 2026-10-29): End ends all of ours, leftovers end at launch and quit, updates go stale
    assert "for a in all { await a.end(nil, dismissalPolicy: .immediate) }" in swift and "Activity<ApexDriveAttributes>.activities" in swift
    assert "staleDate: Date().addingTimeInterval(activityStaleAfter)" in swift and "staleDate: nil" not in swift
    assert "UIApplication.willTerminateNotification" in swift and swift.count("endAllActivities(") >= 4
    assert "if (action === 'end') { liveAct.on = false;" in html, "the page always says end, even after a reload"
    assert "activity('start'" in html and "activity('end')" in html and "if (live) pushActivity(notes);" in html
    assert "@main" in read("LiveActivity", "ApexLiveWidget.swift")


def test_quick_drive_widget_and_control():
    src = read("LiveActivity", "ApexQuickWidget.swift")
    bundle = read("LiveActivity", "ApexLiveWidget.swift")
    assert 'URL(string: "apexnav://open?go=drive")' in src                      # the link the app already takes (C-05)
    assert ".widgetURL(driveURL)" in src and "OpenURLIntent(driveURL)" in src
    assert "ApexQuickWidget()" in bundle and "if #available(iOS 18.0, *) { ApexDriveControl() }" in bundle
    assert '"go"' in read("ApexNavApp.swift")                                    # the app accepts go=drive
    yml = read(".github", "workflows", "build.yml")
    assert "'LiveActivity/**'" in yml                                             # a PR that changes the extension builds it


def test_short_true_words_never_a_cut_one():
    """U-61 (docs/design/REVIEW4.md): with no note ahead the island read "--" and "NO NOT"."""
    widget, html = read("LiveActivity", "ApexLiveWidget.swift"), read("web", "index.html")
    assert '"--"' not in widget and "prefix(6)" not in widget                 # no dashes, no six letters of a sentence
    assert widget.count("RecordDot(") >= 3                                     # lock screen, expanded and compact leading
    trailing = widget[widget.index("compactTrailing:"):widget.index("minimal:")]
    assert ".minimumScaleFactor(" in trailing and ".lineLimit(1)" in trailing   # scaled to fit, never truncated
    push = html[html.index("function quietActivity()"):html.index("// ---- live delta on your saved stages")]
    assert "'QUIET'" in push and "'REC'" in push and "'No notes ahead'" not in push
    assert "next corner" in push and "driven" in push
    attrs = read("LiveActivity", "ApexDriveAttributes.swift")
    for f in ("var note: String", "var distance: String", "var eta: String", "var short: String?", "var hazard: Bool?", "var etaShort: String?"):
        assert f in attrs                                                      # the fields the shell fills (ApexNavApp.swift handleActivity)
    for k in ('dict["note"]', 'dict["distance"]', 'dict["eta"]', 'dict["short"]', 'dict["hazard"]', 'dict["etaShort"]'):
        assert k in read("ApexNavApp.swift")
