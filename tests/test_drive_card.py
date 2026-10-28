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
  corners: [{ severity: 'HP' }, { severity: 2 }, { severity: 3 }, { severity: 6 }, { severity: 5, shape: 'hairpin' }] };
const m = K.cardModel(d);
const sh = K.silhouette(lat, lon);
const [tl] = K.trimEnds(lat, lon, dist);
console.log(JSON.stringify({ trimmed: [tl.length, tl[0] === lat[14], tl[tl.length - 1] === lat[85]], short: K.trimEnds([1, 2], [1, 2], [0, 900])[0].length, m: { ...m, shape: m.shape.length }, inBox: sh.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1),
  empty: K.cardModel({}), few: K.silhouette([1], [2]) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_card_model(out):
    m = out["m"]
    assert (m["name"], m["score"], round(m["miles"], 2)) == ("Dragon", 812, 3.69)
    assert m["parts"] == [["Smoothness", 84], ["Braking", 71], ["Consistency", 66]]     # no pace: it is a speed proxy
    assert m["mix"] == {"tight": 3, "medium": 1, "fast": 1}
    assert m["shape"] > 50 and out["inBox"]


def test_outline_leaves_out_both_ends(out):
    assert out["trimmed"] == [72, True, True]        # 800 m off each end of a 5.94 km drive sampled every 60 m: 840 m to 5100 m
    assert out["short"] == 0


def test_unknown_stays_unknown(out):
    e = out["empty"]
    assert e["score"] is None and e["miles"] is None and e["parts"] == [] and e["shape"] == []
    assert out["few"] == []


def test_no_times_or_speeds_on_the_card():
    src = open(os.path.join(ROOT, "web", "drive_card.js"), encoding="utf-8").read()
    draw = src[src.index("function drawCard"):src.index("async function shareCard")]
    for word in ["mph", "km/h", "speed", "elapsed", "duration", "pace"]:
        assert word not in draw.lower(), word
