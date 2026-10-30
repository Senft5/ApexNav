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
