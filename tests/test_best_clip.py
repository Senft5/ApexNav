"""A drive's best corner clip off the Log (web/best_clip.js pick, big bet 5): the best-scoring corner that the app's own
film of the drive holds, with where it sits in that video. No film, or no corner inside it, is no clip."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1];
const Core = require(R + '/web/apex_core.js'), Rec = require(R + '/web/recording.js'), CC = require(R + '/web/corner_clip.js'),
  DC = require(R + '/web/dashcam.js'), B = require(R + '/web/best_clip.js');
const MPH = 2.2369362921, lat = [], lon = [];
let la = 35.6, lo = -83.9, h = 0;
for (let i = 0; i < 800; i++) { if (i > 100 && i < 700) h += 0.05 * Math.sin((i - 100) / 25);
  la += 5 * Math.cos(h) / 110540; lo += 5 * Math.sin(h) / (111320 * Math.cos(35.6 * Math.PI / 180)); lat.push(la); lon.push(lo); }
const { kappa } = Core.computeCurvature(lat, lon);
let s = 9; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
const v = kappa.map((k) => Math.max(9, 22 - 300 * Math.abs(k)));
// rough hands in the first half, smooth in the second: the best corners are late in the drive
const latG = v.map((x, i) => x * x * kappa[i] / 9.80665 + (i < 400 ? 0.3 : 0.02) * rnd());
const lonG = v.map((x, i) => (i ? (x * x - v[i - 1] ** 2) / 10 / 9.80665 : 0));
const prof = Core.profileRecording({ lat, lon, distance_m: lat.map((_, i) => i * 5), speed_mph: v.map((x) => x * MPH), lon_g: lonG, lat_g: latG });
const t0 = 1763000000000;
const d = { id: 'x', name: 'Esses', t0, lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: v, lon_g: lonG, lat_g: latG, g_known: null, events: prof.events };
const T = Rec.timesOf(Core, d), total = T[T.length - 1], lib = { Core, Rec, CC, DC };
const whole = [{ name: `${t0}.mov`, start_ms: t0, dur_s: total + 5 }];
const firstHalf = [{ name: `${t0}.mov`, start_ms: t0, dur_s: T[380] }];
const out = {
  whole: B.pick(d, whole, lib), firstHalf: B.pick(d, firstHalf, lib),
  none: B.pick(d, [], lib), noLength: B.pick(d, [{ name: `${t0}.mov`, start_ms: t0, dur_s: null }], lib),
  otherDay: B.pick(d, [{ name: '1700000000000.mov', start_ms: 1700000000000, dur_s: 600 }], lib),
  noClock: B.pick({ ...d, t0: null }, whole, lib),
  half: T[380], scores: CC.bestOf(Core, d, Rec.cornersOf(d), () => true, 50).map((b) => ({ k: b.k, score: b.score, start: Rec.cornersOf(d)[b.k].start, end: Rec.cornersOf(d)[b.k].end })),
};
// the window it gives is the one the Log's corner clip cuts
const c = Rec.cornersOf(d).find((x) => out.whole && CC.cornersOf(d)[out.whole.k] && x.start === CC.cornersOf(d)[out.whole.k].start);
out.same = c ? CC.clipWindow(T, c, 0, total + 5) : null;
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    p = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_the_best_corner_in_the_film(r):
    w, best = r["whole"], max(r["scores"], key=lambda x: x["score"])
    assert w and w["name"].endswith(".mov") and w["offsetS"] == 0
    assert w["score"] == best["score"]
    assert w["label"].startswith(f"Corner {w['k'] + 1}") and w["start"] < w["end"]
    assert r["same"] and w["start"] == pytest.approx(r["same"]["vt0"]) and w["end"] == pytest.approx(r["same"]["vt1"])


def test_only_a_corner_the_film_holds(r):
    f = r["firstHalf"]
    assert f and f["end"] <= r["half"] + 1e-6
    held = [x for x in r["scores"] if x["end"] <= 380]
    assert f["score"] == max(x["score"] for x in held) and f["score"] < r["whole"]["score"]


def test_no_film_no_clip(r):
    assert r["none"] is None and r["noLength"] is None and r["otherDay"] is None and r["noClock"] is None
