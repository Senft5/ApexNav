"""Panel round 2, HE-1 / LA-3: road feel shown, and only when measured (web/road_feel.js). The end card gets one measured
line from the drive's own rows; the drive's page in the Log gets this phone's own lane; a drive whose mount never calibrated
says nothing (CLAUDE.md rule 3: unknown stays unknown)."""
import json
import os
import shutil
import subprocess

import pytest
from tests.page_source import cockpit_source

NODE = shutil.which("node")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")


def read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


RUNNER = r"""
const R = process.argv[1], F = require(R + '/web/road_feel.js'), fs = require('fs');
const mi = (m) => `${(m / 1609.344).toFixed(1)} mi`;
const n = 2000, dist = Array.from({ length: n }, (_, i) => 1000 + i * 5);
// a drive with a calibrated mount: flat, 4.2° of bank around row 800, an off-camber 3° patch, rough from row 1200 for 100 m
const camber = dist.map((_, i) => (i >= 800 && i < 806 ? 4.2 : i >= 300 && i < 304 ? -3 : 0.2));
camber[500] = -40;                                                    // one wild sample: never the headline
const rough = dist.map((_, i) => (i >= 1200 && i < 1220 ? 0.2 : 0.03));
const fixture = (() => { const t = fs.readFileSync(R + '/web/data/dry_ridge.js', 'utf8'); const j = JSON.parse(t.slice(t.indexOf('push(') + 5, t.lastIndexOf(')')));
  const f = (k) => j.fields.indexOf(k); return { dist: j.rows.map((r) => r[f('distance_m')]), camber: j.rows.map((r) => r[f('camber_deg')]), rough: j.rows.map((r) => r[f('roughness_rms')]) }; })();
const s = F.summary({ dist, camber, rough });
const smooth = F.summary({ dist, camber, rough: rough.map(() => 0.02) });
const off = F.summary({ dist, camber: camber.map((v, i) => (i >= 300 && i < 304 ? -6 : v)), rough });
const flat = F.summary({ dist, camber: camber.map(() => 0.3), rough: null });
console.log(JSON.stringify({
  s, line: F.endLine(s, mi), smooth: F.endLine(smooth, mi), off: F.endLine(off, mi), flat: F.endLine(flat, mi),
  none: [F.summary(null), F.summary({ dist, camber: dist.map(() => null), rough }), F.summary({ dist, camber: dist.map((_, i) => (i < 39 ? 2 : null)), rough }),
         F.summary({ dist, camber: null, rough })],
  noneLine: F.endLine(null, mi),
  cols: F.columns([{ distance_m: 5, camber_deg: 1.5, roughness_rms: 0.1 }, { distance_m: 10, camber_deg: null, roughness_rms: NaN }]),
  fixture: F.endLine(F.summary(fixture), mi),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_a_calibrated_drive_says_what_the_phone_felt(out):
    s = out["s"]
    # the first 20 m that are all banked, from the drive's start; the wild -40° sample and its 20 m are left out
    assert s["rows"] == 2000 and s["bankDeg"] == pytest.approx(4.2) and s["bankAtM"] == 800 * 5
    assert s["roughAtM"] == 1200 * 5
    assert out["line"] == "Road feel: banked 4° at 2.5 mi · roughest at 3.7 mi."
    assert out["smooth"] == "Road feel: banked 4° at 2.5 mi · a smooth surface."
    assert out["off"].startswith("Road feel: off-camber 6° at 0.9 mi")
    assert out["flat"] == "Road feel: flat, no banking over 1°."


def test_an_uncalibrated_drive_says_nothing(out):
    """No camber rows (the mount never locked), fewer than 40 of them, or no column at all: no line, never a guessed one."""
    assert out["none"] == [None, None, None, None] and out["noneLine"] == ""
    assert out["cols"] == {"dist": [5, 10], "camber": [1.5, None], "rough": [0.1, None]}


def test_the_demo_drive_has_its_measured_line(out):
    """The recording's fixture (web/data/dry_ridge.js) carries camber_deg and roughness_rms for every 5 m that was measured."""
    assert out["fixture"].startswith("Road feel: ") and "°" in out["fixture"] and "roughest at" in out["fixture"], out["fixture"]


def test_the_end_card_and_the_log_show_it():
    html, dv, an = cockpit_source(), read("web", "drive_view.js"), read("web", "analysis.html")
    assert '<p class="end-feel" id="endFeel" hidden></p>' in html and '<script src="road_feel.js" defer></script>' in html
    assert "ApexRoadFeel.endLine(c.feel, (m) => ApexUnits.long(m, 1))" in html and "$('endFeel').hidden = !feel;" in html
    assert "card.feel = window.ApexRoadFeel ? ApexRoadFeel.summary(ApexRoadFeel.columns(rec.rows)) : null;" in html, "a live drive"
    assert "feel: window.ApexRoadFeel ? ApexRoadFeel.summary({ dist: d.dist, camber: d.camber, rough: d.rough }) : null" in html, "a whole record"
    assert '<script src="road_feel.js"></script>' in an and an.index("road_feel.js") < an.index("drive_view.js")
    assert "RF.summary({ dist: d.dist, camber: d.camber, rough: d.rough })" in dv and "Your road feel" in dv and "this phone \\u00b7 1 run" in dv
    lane = dv[dv.index("      if (own) {"):dv.index("      if (feel) {")]
    assert "if (finite(cm))" in lane and "if (finite(rf))" in lane and "else rs = false" in lane, "gaps are unknown, never drawn as zero"
