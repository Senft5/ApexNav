"""Drive card (web/drive_card.js, IDEAS D-09): what the shareable picture shows, never times or speeds."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const K = require(process.argv[1] + '/web/drive_card.js');
const lat = [], lon = [];
for (let i = 0; i < 100; i++) { lat.push(35.9 + i * 1e-4); lon.push(-83.9 + Math.sin(i / 10) * 1e-3); }
const dist = lat.map((_, i) => i * 60);   // 6 km
const d = { name: 'Dragon', date: '2026-10-20T15:00:00Z', dist, lat, lon,
  ds: { score: 812, components: { pace: 0.9, smoothness: 0.84, braking: 0.71, consistency: 0.66 } },
  elev: lat.map((_, i) => 200 + Math.sin(i / 15) * 30),
  corners: [{ severity: 'HP', apex: 5 }, { severity: 2, apex: 40 }, { severity: 3, apex: 60 }, { severity: 6 }, { severity: 5, shape: 'hairpin', apex: 95 }] };
const m = K.cardModel(d);
const sh = K.silhouette(lat, lon);
const [tl] = K.trimEnds(lat, lon, dist);
console.log(JSON.stringify({ trimmed: [tl.length, tl[0] === lat[14], tl[tl.length - 1] === lat[85]], short: K.trimEnds([1, 2], [1, 2], [0, 900])[0].length, m: { ...m, shape: m.shape.length, ticks: m.ticks.length, climb: m.climb.length }, ticksIn: m.ticks.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1), size: [K.W, K.H], inBox: sh.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1),
  empty: K.cardModel({}), few: K.silhouette([1], [2]),
  titles: [K.cardTitle('Dragon', '2026-10-20T15:00:00'), K.cardTitle('Drive 11/13/2026 7:20 PM', '2026-11-13T19:20:00'), K.cardTitle('Drive 11/13/2026 7:20 AM', '2026-11-13T07:20:00'),
    K.cardTitle('', '2026-11-13T13:00:00'), K.cardTitle('Drive 10/1/2026 11:40 PM', '2026-10-01T23:40:00'), K.cardTitle(null, null)],
  mixes: [{ tight: 0, medium: 0, fast: 8 }, { tight: 3, medium: 1, fast: 1 }, { tight: 0, medium: 1, fast: 0 }, { tight: 0, medium: 0, fast: 0 }, null].map(K.mixLine) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_card_model(out):
    m = out["m"]
    assert (m["name"], m["score"], round(m["miles"], 2)) == ("Dragon", 812, 3.69)
    # HE-4 (panel round 2): the Log's own four, in its words and order (drive_view.js bars); Pace is a part of the score, not a speed
    assert m["parts"] == [["Pace", 90], ["Smooth", 84], ["Brakes", 71], ["Rhythm", 66]]
    assert m["mix"] == {"tight": 3, "medium": 1, "fast": 1}
    assert m["title"] == "Dragon"
    assert m["shape"] > 50 and out["inBox"]


def test_title_says_the_date_once(out):
    """2026-11-12: a drive no road named had its date name on the picture over the date line, the date twice. It reads as the
    part of the day instead; a road's name stays as it is."""
    assert out["titles"] == ["Dragon", "Evening drive", "Morning drive", "Afternoon drive", "Night drive", "Drive"]


def test_corner_line_names_only_the_kinds_driven(out):
    assert out["mixes"] == ["8 fast corners", "3 tight · 1 medium · 1 fast corners", "1 medium corner", "", ""]


def test_outline_leaves_out_both_ends(out):
    assert out["trimmed"] == [72, True, True]        # 800 m off each end of a 5.94 km drive sampled every 60 m: 840 m to 5100 m
    assert out["short"] == 0


def test_unknown_stays_unknown(out):
    e = out["empty"]
    assert e["score"] is None and e["miles"] is None and e["parts"] == [] and e["shape"] == [] and e["ticks"] == [] and e["climb"] == []
    assert out["few"] == []


def test_no_times_or_speeds_on_the_card():
    src = open(os.path.join(ROOT, "web", "drive_card.js"), encoding="utf-8").read()
    draw = src[src.index("function drawCard"):src.index("async function shareCard")]
    for word in ["mph", "km/h", "speed", "elapsed", "duration", "secs", "time"]:
        assert word not in draw.lower(), word
    assert "APEX NAV" not in src and "'VETTA'" in draw                  # the product's name since 2026-10-28
    assert "g.fillText(SITE," in draw and "const SITE = 'vettadrive.com'" in src   # a shared card says where Vetta is


def test_nine_by_sixteen(out):
    assert out["size"] == [1080, 1920]                                   # JA-1: a story without cropping


def test_corners_ticked_on_the_kept_stretch_only(out):
    # apexes at rows 40 and 60 are on the kept stretch (840 m to 5100 m); 5 and 95 are on the trimmed ends, one has no apex
    assert out["m"]["ticks"] == 2 and out["ticksIn"]
    assert out["m"]["climb"] > 10
