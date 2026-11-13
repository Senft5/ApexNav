"""Big bet 5: a drive keeps the clock at every 5 m sample (web/sensors.js t_s, web/recording.js timesOf), so a video lines up
through a stop; drives without it keep the speed-paced time they always had."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = str(Path(__file__).resolve().parents[1])

RUNNER = r"""
const S = require(process.argv[1] + '/web/sensors.js'), R = require(process.argv[1] + '/web/recording.js'), Core = require(process.argv[1] + '/web/apex_core.js');
const lat0 = 35, lon0 = -83, mLat = 110540, mLon = 111320 * Math.cos(lat0 * Math.PI / 180), at = (x) => ({ lat: lat0, lon: lon0 + x / mLon });
const T0 = 1763000000000, out = {};
// 20 m/s for 20 s (400 m), stopped 30 s at a junction, then 20 m/s for 20 s more
const rec = new S.Recorder();
let x = 0;
for (let s = 0; s <= 70; s++) {
  const moving = s <= 20 || s > 50;
  if (moving && s > 0) x += 20;
  rec.add({ t: T0 + s * 1000, has_fix: true, ...at(x), speed_mps: moving ? 20 : 0, lat_g: 0, lon_g: 0 });
}
const csv = rec.toCsv(), d = R.parse(Core, csv, 'web_20261113_120000.csv', { source: 'web-gps', t0: rec.startedAt });
const T = R.timesOf(Core, d), old = Core.elapsedS(d.speed_mps);
const i100 = Math.round(100 / 5), i600 = Math.round(600 / 5);
out.head = csv.split('\n')[0].split(',').pop();
out.t100 = T[i100]; out.t600 = T[i600]; out.old600 = old[i600]; out.t0 = d.t0; out.mono = Array.from(T).every((v, i) => !i || v >= T[i - 1]);
// a drive from an older build: no t_s column, the speed-paced time as before
const legacy = csv.split('\n').map((l) => l.split(',').slice(0, 14).join(',')).join('\n');
const dl = R.parse(Core, legacy, 'web_20261113_120000.csv', {});
out.legacyHas = 't_s' in dl; out.legacySame = Array.from(R.timesOf(Core, dl)).every((v, i) => v === old[i]);
// a hole in the clock carries on at the speed's pace, never backwards
const holed = { ...d, t_s: d.t_s.map((v, i) => (i >= 30 && i < 35 ? null : v)) }, H = R.timesOf(Core, holed);
out.holeMono = Array.from(H).every((v, i) => !i || v >= H[i - 1]); out.holeAfter = H[40] === T[40];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    p = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_each_sample_carries_the_clock(r):
    assert r["head"] == "t_s"
    assert r["t100"] == pytest.approx(5.0, abs=0.05)                     # 100 m at 20 m/s
    assert r["t0"] == 1763000000000 and r["mono"]


def test_a_stop_counts_on_the_clock(r):
    # 600 m: 400 m (20 s), 30 s stopped, 200 m (10 s) = 60 s; the speed-paced time never saw the stop
    assert r["t600"] == pytest.approx(60.0, abs=0.2)
    assert r["old600"] == pytest.approx(30.0, abs=1.0)


def test_older_drives_keep_their_time(r):
    assert r["legacyHas"] is False and r["legacySame"]


def test_a_hole_in_the_clock_never_runs_backwards(r):
    assert r["holeMono"] and r["holeAfter"]


def test_ten_frames_a_second_between_fixes_keep_an_even_clock():
    script = r"""
const S = require(process.argv[1] + '/web/sensors.js'), lat0 = 35, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
const rec = new S.Recorder();
for (let k = 0; k <= 100; k++) rec.add({ t: 5000 + k * 100, has_fix: true, lat: lat0, lon: -83 + Math.floor(k / 10) * 20 / mLon, speed_mps: 20 });
console.log(JSON.stringify(rec.rows.map((x) => x.t_s)));
"""
    p = subprocess.run([NODE, "-e", script, ROOT], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    t = json.loads(p.stdout)
    assert t[4] == pytest.approx(1.0, abs=0.05) and t[20] == pytest.approx(5.0, abs=0.05)      # 20 m and 100 m at 20 m/s


def test_the_apps_frames_keep_the_clock_by_their_at():
    # the app's frames carry their time as `at` (ApexNavApp.swift pushLiveFrame), not the browser's `t`
    script = r"""
const S = require(process.argv[1] + '/web/sensors.js'), lat0 = 35, mLon = 111320 * Math.cos(lat0 * Math.PI / 180), T0 = 1763000000000;
const rec = new S.Recorder();
for (let k = 0; k <= 20; k++) rec.add({ at: T0 + k * 1000, has_fix: true, lat: lat0, lon: -83 + k * 20 / mLon, speed_mps: 20 });
const back = S.Recorder.restore(rec.snapshot(0), rec.rows);
for (let k = 21; k <= 30; k++) back.add({ at: T0 + k * 1000, has_fix: true, lat: lat0, lon: -83 + k * 20 / mLon, speed_mps: 20 });
console.log(JSON.stringify({ start: rec.startedAt, t: back.rows.map((x) => x.t_s) }));
"""
    p = subprocess.run([NODE, "-e", script, ROOT], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    o = json.loads(p.stdout)
    assert o["start"] == 1763000000000
    assert o["t"][20] == pytest.approx(5.0, abs=0.05) and o["t"][100] == pytest.approx(25.0, abs=0.05)   # across the restore
