"""A sheet's backdrop closes it only on a press that began on the backdrop.

On CI a tap on a star in the spot dialog shut the dialog: the press began on the star, the click went to the
backdrop (the browser sends a click to the shared parent when press and lift land on different elements), and the
backdrop's handler only looked at the click's target. web/cockpit.js now routes every backdrop through onBackdrop,
which also needs the pointerdown on the backdrop itself.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

WEB = Path(__file__).resolve().parent.parent / "web"
COCKPIT = (WEB / "cockpit.js").read_text(encoding="utf-8")


def _helper():
    m = re.search(r"    function onBackdrop\(back, close\) \{\n.*?\n    \}\n", COCKPIT, re.S)
    assert m, "web/cockpit.js has onBackdrop(back, close)"
    return m.group(0)


def test_no_backdrop_in_the_cockpit_closes_on_the_click_target_alone():
    bare = re.findall(r"addEventListener\('click', \(e\) => \{ if \(e\.target === [^)]*\)\)? ?\w+\(", COCKPIT)
    bare += re.findall(r"\.onclick = \(e\) => \{ if \(e\.target === ", COCKPIT)
    assert not bare, bare


def test_the_spot_pin_and_explain_backdrops_use_it():
    for el in ("hlOverlay", "pinOverlay", "explainCard"):
        assert f"onBackdrop($('{el}')" in COCKPIT, el


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_a_press_that_began_inside_does_not_close_and_one_on_the_backdrop_does():
    js = """
    function el() { const h = {}; return { h, addEventListener(t, f) { (h[t] = h[t] || []).push(f); }, fire(t, target) { (h[t] || []).forEach((f) => f({ target })); } }; }
    const back = el(), star = {}; let shut = 0;
    %s
    onBackdrop(back, () => { shut++; });
    const out = [];
    back.fire('pointerdown', star); back.fire('click', back); out.push(shut);      // pressed on a star, lifted on the backdrop
    back.fire('pointerdown', back); back.fire('click', back); out.push(shut);      // a tap on the backdrop
    back.fire('click', back); out.push(shut);                                      // a click with no press of its own (stale)
    back.fire('pointerdown', back); back.fire('click', star); out.push(shut);      // began on the backdrop, the click on a key
    console.log(JSON.stringify(out));
    """ % _helper()
    out = subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == [0, 1, 1, 1]
