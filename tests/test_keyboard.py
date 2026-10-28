"""The on-screen keyboard (web/keyboard.js, review 2026-10-28): which fields open it, when it counts as open, and that both
pages load it and hide the tab bar while typing."""
import json
import os
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const K = require(process.argv[1] + '/web/keyboard.js');
const el = (tagName, type, extra) => ({ tagName, type, ...extra });
console.log(JSON.stringify({
  text: [el('INPUT', 'text'), el('INPUT', 'search'), el('INPUT', ''), el('TEXTAREA'), el('DIV', undefined, { isContentEditable: true })].map(K.isText),
  notText: [el('INPUT', 'checkbox'), el('INPUT', 'range'), el('BUTTON'), el('INPUT', 'text', { disabled: true }), el('INPUT', 'text', { readOnly: true }), null].map(K.isText),
  open: [K.keyboardOpen(844, 450, el('INPUT', 'search')), K.keyboardOpen(844, 780, el('INPUT', 'search')), K.keyboardOpen(844, 450, el('BUTTON'))],
}));
"""


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_which_fields_and_when():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["text"] == [True] * 5
    assert out["notText"] == [False] * 6
    assert out["open"] == [True, False, False], "a toolbar's worth of height isn't the keyboard"


@pytest.mark.parametrize("page", ["index.html", "analysis.html"])
def test_pages_load_it_and_hide_the_tab_bar(page):
    html = open(os.path.join(ROOT, "web", page), encoding="utf-8").read()
    assert '<script src="keyboard.js"></script>' in html
    assert re.search(r"html\.kb-open \.tabbar \{ display: none", html)
    assert "var(--kb-h)" in html, "the page fits above the keyboard"
