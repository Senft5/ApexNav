"""What's new after an update (web/whats_new.js, IDEAS O-10): once per release, never on a first install or while busy,
one screen of at most four short lines."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const W = require(process.argv[1] + '/web/whats_new.js');
const id = W.NEWS.id;
const has = (x) => !!x;
console.log(JSON.stringify({
  update: has(W.pending('older', true, false)), never: has(W.pending(null, true, false)),
  again: has(W.pending(id, true, false)), firstInstall: has(W.pending(null, false, false)), busy: has(W.pending('older', true, true)),
  empty: has(W.pending('older', true, false, { id: 'x', items: [] })), items: W.NEWS.items,
  moment: [{}, { splash: true }, { touched: true }, { open: true }, { driving: true }, { splash: true, touched: true }].map((x) => W.moment(x)), bare: W.moment(),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_when_it_shows(out):
    assert out["update"] and out["never"]
    assert not out["again"] and not out["firstInstall"] and not out["busy"] and not out["empty"]


def test_one_screen(out):
    assert 1 <= len(out["items"]) <= 4
    for title, text in out["items"]:
        assert len(title) <= 20 and len(text) <= 60, title   # one line on a phone, not a paragraph
        for banned in ("faster", "speed", "race"):
            assert banned not in text.lower()


def test_it_never_interrupts(out):
    """2026-11-10: it came up over the Options sheet. A still, empty map shows it; the splash makes it wait; a touch, an
    open sheet or a drive puts it off to the next launch (it is not marked seen)."""
    assert out["moment"] == ["show", "wait", "skip", "skip", "skip", "skip"] and out["bare"] == "show"
    src = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "ApexWhatsNew.moment({ touched, driving: driveActive, splash: !!$('boot'), open: anythingOpen() })" in src
    assert ".side-pop.open, #planPanel.open, .sheet.open" in src


def test_it_names_what_is_really_there(out):
    """The news of 2026-11-10 (the first since 2026-10-28): each thing it names is on a screen under that name."""
    text = " ".join(t + " " + x for t, x in out["items"])
    page = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    fun = open(os.path.join(ROOT, "web", "fun_route.js"), encoding="utf-8").read()
    for level in ("Quick", "Fun", "Long way"):
        assert level in text and f"label: '{level}'" in fun, level
    assert "Route tuning" in text and 'data-title="Route tuning"' in page
    assert 'id="loopDialVal"' in page and 'aria-label="Which way the loop heads"' in page
    assert "→" not in text          # a place in the app is named in words, as everywhere else
