"""The road's portrait on the drive-ended card (web/road_portrait.js, panel round 2 KE-1): drawn at once, exactly where the map's
fit puts the trail, so the card is never an empty map while the tiles load; the climbs under it only when measured."""
import json
import os
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/road_portrait.js');
const run = []; for (let i = 0; i < 200; i++) run.push([-84.70 + i * 1e-4, 39.20 + Math.sin(i / 20) * 2e-3]);
const box = { w: 402, h: 874, top: 80, bottom: 500, left: 32, right: 32, maxZoom: 16 };
const f = P.frame([run], box);
const xs = f.runs[0].map((p) => p[0]), ys = f.runs[0].map((p) => p[1]);
const tiny = P.frame([[[-84.7, 39.2], [-84.69999, 39.2]]], box);
const elev = run.map((_, i) => 200 + i * 0.2), flat = run.map(() => 200), dist = run.map((_, i) => i * 5);
console.log(JSON.stringify({
  zoom: f.zoom, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), tinyZoom: tiny.zoom,
  svg: P.svg([run], box, { line: '#E65252', casing: '#1A1814' }), none: P.svg([], box), stray: P.frame([[[1, 2]]], box), noRoom: P.frame([run], { ...box, bottom: 900 }),
  climb: P.profile(elev, dist, 300, 36), flat: P.profile(flat, dist, 300, 36), unmeasured: P.profile(run.map(() => null), dist, 300, 36),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_road_fills_the_padded_box_as_fitBounds_does(out):
    # a wide road: it spans the box's width between the side paddings and is centred top to bottom in what the card leaves
    assert abs(out["x0"] - 32) < 0.5 and abs(out["x1"] - 370) < 0.5
    mid = (out["y0"] + out["y1"]) / 2
    assert abs(mid - (80 + (874 - 500 - 80) / 2)) < 0.5
    assert 80 <= out["y0"] and out["y1"] <= 874 - 500


def test_zoom_capped_like_the_map(out):
    assert out["tinyZoom"] == 16                                          # maxZoom: 16, as showEndTrail's fit
    assert out["zoom"] < 16


def test_svg_and_unknowns(out):
    s = out["svg"]
    assert s.startswith('<svg class="rp-road"') and s.count("<path") == 2 and 'stroke="#E65252"' in s
    assert out["none"] is None and out["stray"] is None and out["noRoom"] is None


def test_climbs_only_when_measured(out):
    assert out["climb"].startswith('<svg class="rp-climb"')
    assert out["flat"] is None and out["unmeasured"] is None


def test_end_card_draws_the_portrait_and_jumps():
    js = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    body = js[js.index("function showEndTrail(d)"):js.index("let endTrailOn = false")]
    assert "paintEndPortrait(runs, d, box, mr, band)" in body
    assert body.index("paintEndPortrait(runs") < body.index("if (!mapReady) return;")     # drawn with or without a map
    assert re.search(r"fitBounds\([^;]*duration: 0", body)                               # a jump: only the final view's tiles
    assert "map.once('idle'" in body
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert 'id="endPortrait"' in html and '<script src="road_portrait.js" defer></script>' in html
