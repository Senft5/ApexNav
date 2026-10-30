"""Siri and Shortcuts (ApexIntents.swift, IDEAS V-07): five app shortcuts that open the app's own links; the page acts on
go=report and go=end only during a drive; the file is built into the app and triggers the iOS build."""
import os
import re
from tests.page_source import cockpit_source

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()


def test_intents_and_phrases():
    src = read("ApexIntents.swift")
    assert src.count("AppShortcut(intent:") == 5
    for go in ("drive", "report", "end", "nextstage", "skipstage"):
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
    assert "if (state.mode === 'live') leaveDrive(true)" in html          # never ends something that isn't a drive
