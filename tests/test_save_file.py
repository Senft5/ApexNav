"""Saving a file in the iOS app (web/save_file.js + ApexNavApp.swift shareFile): the shell's share sheet gets the file,
since a download link does nothing in a web view; on the web it is a download."""
import os
from tests.page_source import cockpit_source

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()


def test_wired_both_sides():
    js, swift, html = read("web", "save_file.js"), read("ApexNavApp.swift"), cockpit_source()
    assert "cmd: 'shareFile'" in js and 'cmd == "shareFile"' in swift and "func shareFile(name: String, data: Data)" in swift
    assert "shareItem = CSVShareItem(url: url)" in swift
    assert "ApexSaveFile.saveFile(" in html and "a.download = name" in js
    assert "temporaryDirectory" in swift and "alphanumerics" in swift, "the name is cleaned and the file kept in temp"


def test_share_links_open_the_share_sheet():
    """Feedback 07/08: every invite and share link opens the real share sheet (the shell's in the app), never a
    "Copy this link" box; the crew page has no image-card Share."""
    js, swift = read("web", "save_file.js"), read("ApexNavApp.swift")
    cockpit, analysis, crew = read("web", "cockpit.js"), read("web", "analysis.html"), read("web", "crew_page.js")
    assert "cmd: 'shareText'" in js and 'cmd == "shareText"' in swift and "func shareText(text: String, url: String?)" in swift
    assert "shareItem = CSVShareItem(items: items)" in swift and "let items: [Any]" in swift
    assert "ApexSaveFile.shareLink(" in cockpit and "ApexSaveFile.shareLink(" in analysis
    for src in (cockpit, analysis):
        assert "window.prompt(" not in src
    assert "shareCrew" not in crew and "shareImage" not in crew
