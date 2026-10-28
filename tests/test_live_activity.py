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
    assert "await activity.end(nil, dismissalPolicy: .immediate)" in swift
    assert "activity('start'" in html and "activity('end')" in html and "if (live) pushActivity(notes);" in html
    assert "@main" in read("LiveActivity", "ApexLiveWidget.swift")
