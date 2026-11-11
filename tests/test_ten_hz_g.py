"""IDEAS D-26: every live frame's g reaches the recording (web/sensors.js Recorder). The shell sends ten frames a second
between 1 Hz GPS fixes; the recorder used to give every 5 m sample the g of the frame at the far fix, so the drive held
one g reading a second, placed up to a fix early. Now frame k of n is placed (k + 1) / n of the way between the fixes,
as the vertical spikes already were, and each sample takes the g between the frames either side of it."""
import json
import math
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const S = require(process.argv[1] + '/web/sensors.js');
const lat0 = 35, lon0 = -83, mLat = 110540, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
const at = (x) => ({ lat: lat0, lon: lon0 + x / mLon });
// 20 m/s, a fix every tenth frame (the position moves only on a fix); the true g along the road is truth(x) at the car
const truth = (x) => 0.3 * Math.sin(2 * Math.PI * x / 60) + (x > 400 && x < 412 ? -0.25 : 0);   // a 60 m wave, and a 12 m correction
const run = (opts = {}) => {
  const rec = new S.Recorder(); let snap = null;
  for (let t = 0; t <= 400; t++) {
    const fix = Math.floor(t / 10), x = t * 2;                 // the car is at x; the frame says where the last fix was
    const known = !(opts.blank && t >= 300 && t < 304), cal = opts.cal || 'locked';
    rec.add({ t: t * 100, has_fix: true, ...at(fix * 20), speed_mps: 20, lat_g: known ? truth(x) : null, lon_g: known ? -truth(x) / 2 : null, calibration: cal });
    if (opts.resume && t === 205) { snap = rec.snapshot(0); }
  }
  let rows = rec.rows;
  if (opts.resume) {                                             // the page slept at frame 205: rebuilt from its checkpoint, the rest fed again
    const r2 = S.Recorder.restore(snap, snap.rows);
    for (let t = 206; t <= 400; t++) { const fix = Math.floor(t / 10), x = t * 2; r2.add({ t: t * 100, has_fix: true, ...at(fix * 20), speed_mps: 20, lat_g: truth(x), lon_g: -truth(x) / 2, calibration: 'locked' }); }
    rows = r2.rows;
  }
  return rows.map((r) => [r.distance_m, r.lat_g, r.lon_g]);
};
// the old way, for the record: each sample took the g of the frame at the far fix
const old = (() => { const out = []; for (let fix = 1; fix <= 40; fix++) for (let d = (fix - 1) * 20 + 5; d <= fix * 20; d += 5) out.push([d, truth(fix * 20)]); return out; })();
// 1 Hz frames (a browser: g derived from GPS, one frame a fix) move only by interpolation between fixes
const browser = (() => { const rec = new S.Recorder(); for (let f = 0; f <= 40; f++) rec.add({ t: f * 1000, has_fix: true, ...at(f * 20), speed_mps: 20, lat_g: f % 2 ? 0.2 : 0, lon_g: 0 }); return rec.rows.map((r) => [r.distance_m, r.lat_g]); })();
console.log(JSON.stringify({ rows: run(), blank: run({ blank: true }), unsolved: run({ cal: 'default' }), resumed: run({ resume: true }), old, browser,
  truth: Array.from({ length: 161 }, (_, i) => truth(i * 5)) }));
"""


@pytest.fixture(scope="module")
def r():
    p = subprocess.run([NODE, "-e", RUNNER, os.getcwd()], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def err(rows, truth):
    return math.sqrt(sum((g - truth[int(d / 5)]) ** 2 for d, g, *_ in rows if g is not None and d < 790) / len(rows))


def test_every_frame_reaches_the_road(r):
    rows, truth = r["rows"], r["truth"]
    assert len(rows) == 161 and all(g is not None for _, g, _ in rows[1:])
    new, old = err(rows[1:], truth), err(r["old"], truth)
    assert new < 0.03 and old > 0.15, (new, old)                     # one reading a second, a fix early, was wrong by ~0.2 g
    # the 12 m correction at 400 m shows where it happened
    by = {d: g for d, g, _ in rows}
    assert all(abs(by[d] - truth[d // 5]) < 0.06 for d in (405, 410))
    assert all(abs(g - truth[int(d / 5)]) > 0.1 for d, g in r["old"] if d in (405, 410))      # the old way missed it
    assert all(abs(lo + g / 2) < 1e-9 for _, g, lo in rows[1:])     # lon_g placed the same way


def test_unknown_stays_unknown(r):
    blank = r["blank"]
    # frames 300-303 have no g (frame 300 is the fix at 600 m): the samples between the frames around them are blank
    gaps = [d for d, g, _ in blank if g is None]
    assert gaps and min(gaps) >= 595 and max(gaps) <= 610 and len(gaps) <= 4
    assert all(g is None for _, g, _ in r["unsolved"])              # an unsolved mount: no g, as before


def test_a_checkpoint_carries_the_frames_waiting_to_be_placed(r):
    assert r["resumed"] == r["rows"]                                  # the page slept mid-fix: the drive is the same


def test_one_frame_a_fix_is_interpolated_between_fixes(r):
    b = r["browser"]
    # fixes alternate 0 and 0.2 g every 20 m: the samples between them step through, not jump at the far fix
    by = {d: g for d, g in b}
    assert by[25] == pytest.approx(0.15) and by[30] == pytest.approx(0.1) and by[40] == pytest.approx(0.0)
