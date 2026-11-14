"""Siri and Shortcuts (ApexIntents.swift, IDEAS V-07): seven app shortcuts that open the app's own links; the page acts on
go=report and go=end only during a drive; the file is built into the app and triggers the iOS build."""
import os
import re
from tests.page_source import cockpit_source

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()


def test_intents_and_phrases():
    src = read("ApexIntents.swift")
    assert src.count("AppShortcut(intent:") == 9                  # Apple allows ten
    for go in ("drive", "report", "end", "nextstage", "skipstage", "nextfuel", "nextcafe"):
        assert f'ApexIntentInbox.deliver("{go}")' in src
    for phrase in re.findall(r'"([^"]*\\\(\.applicationName\)[^"]*)"', src):
        assert "\\(.applicationName)" in phrase                 # every phrase names the app (Apple requires it)
    assert "openAppWhenRun = true" in src


def test_wired_into_the_app_and_page():
    assert "ApexIntents.swift" in read("project.yml") and "'ApexIntents.swift'" in read(".github", "workflows", "build.yml")
    swift = read("ApexNavApp.swift")
    assert "ApexIntentInbox.notification" in swift and "ApexIntentInbox.take()" in swift
    html = cockpit_source()
    assert "p.go === 'report'" in html and "p.go === 'end'" in html and "p.go === 'nextstage'" in html and "p.go === 'skipstage'" in html
    assert "p.go === 'nextfuel'" in html and "p.go === 'nextcafe'" in html
    assert "if (state.mode === 'live') leaveDrive(true)" in html          # never ends something that isn't a drive


def test_drive_to_a_place_said_and_find_a_loop():
    """2026-11-13: hands-free destinations in the car, as Apple Maps and Waze have: Siri asks "Where to?" and does the
    listening (no microphone for the app); the words reach the page as base64url, the only form the link filter passes."""
    src = read("ApexIntents.swift")
    assert 'requestValueDialog: IntentDialog("Where to?")) var place: String' in src
    assert 'ApexIntentInbox.deliver("to&q=\\(words)")' in src and '.replacingOccurrences(of: "+", with: "-")' in src
    assert 'ApexIntentInbox.deliver("loop\\(length.rawValue)")' in src
    lengths = re.findall(r'm\d+ = "(\d+)"', src)
    page = cockpit_source()
    dial = re.search(r"LOOP_MINUTES = \[([\d, ]+)\]", page).group(1)
    assert lengths == [x.strip() for x in dial.split(",")], "Siri's lengths are the loop dial's"
    assert re.search(r'static let linkKeys: Set<String> = \[[^\]]*"q"', read("ApexNavApp.swift"))
    assert "else spokenLink(p.go, p.q);" in page and "else if (params.get('go')) spokenLink(params.get('go'), params.get('q'));" in page
    assert "if (go === 'to') carAsked(() => goSpoken(linkWords(q)));" in page, "a failure says why on the car too"
    assert "if (driveActive) { toast('End the drive to plan a new route.'); return null; }" in page, "never over a drive"
