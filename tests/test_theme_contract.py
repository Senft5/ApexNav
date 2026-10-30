"""The theme contract (web/theme_contract.js, docs/design/REVIEW.md 4.3): every theme passes it, and the things it
forbids (a hazard plate of the theme's own, text under 4.5:1, an unknown renderer) are caught."""
import json
import os
import shutil
import subprocess

import pytest
from tests.page_source import cockpit_source

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const fs = require('fs');
const root = { localStorage: { getItem: () => null, setItem() {} }, document: { documentElement: { style: { setProperty() {} }, dataset: {} } } };
new Function('window', 'document', fs.readFileSync(process.argv[1] + '/web/themes.js', 'utf8'))(root, root.document);
const C = require(process.argv[1] + '/web/theme_contract.js');
const T = root.ApexThemes.THEMES, rb = T.roadbook;
const out = { all: Object.fromEntries(Object.entries(T).map(([k, t]) => [k, C.check(t)])) };
out.hazard = C.check({ ...rb, night: { ...rb.night, hzEdge: '#00FF00' } });
out.faint = C.check({ ...rb, day: { ...rb.day, panelDim: '#C9C0AE' } });
out.renderer = C.check({ ...rb, renderers: { ...rb.renderers, strip: 'neon' } });
out.ratio = [C.contrast('#FFFFFF', '#000000'), C.contrast('#777777', '#777777'), C.contrast('red', '#000000')];
out.floors = C.FLOORS; out.plate = C.HAZARD;
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_every_theme_keeps_the_contract(out):
    assert out["all"] and all(v == [] for v in out["all"].values()), out["all"]


def test_what_it_forbids_is_caught(out):
    assert any("hzEdge" in m for m in out["hazard"])
    assert any("panelDim on panel" in m for m in out["faint"])
    assert any("renderer strip" in m for m in out["renderer"])
    assert out["ratio"][0] == pytest.approx(21) and out["ratio"][1] == pytest.approx(1) and out["ratio"][2] is None


def test_the_plate_and_floors_match_the_page(out):
    html = cockpit_source()
    p = out["plate"]
    assert f"--hz-bg: {p['bg']}; --hz-edge: {p['edge']}; --hz-ink: {p['ink']};" in html
    assert out["floors"] == {"speedPx": 40, "callPx": 21, "binnaclePx": 13}
