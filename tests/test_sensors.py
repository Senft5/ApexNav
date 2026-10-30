"""Web sensors (web/sensors.js): g derived from GPS has the right sign and size, roughness from motion, honest blanks, 5 m recording."""
import json
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const S = require(process.argv[1] + '/web/sensors.js');
const G = 9.80665, lat0 = 35, lon0 = -83, mLat = 110540, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
const at = (x, y) => ({ lat: lat0 + y / mLat, lon: lon0 + x / mLon });
const out = {};
// left (counter-clockwise) and right circles, r = 100 m at 15 m/s, 1 Hz fixes with GPS-style compass heading
const circle = (dir) => {
  const fb = new S.FrameBuilder(), r = 100, v = 15; let last;
  for (let t = 0; t <= 12; t++) {
    const th = v * t / r;                                         // angle travelled; dir +1 = counter-clockwise = left turn
    const p = at(r * Math.sin(th), dir * r * (1 - Math.cos(th)));
    const heading = ((90 - dir * th * 180 / Math.PI) % 360 + 360) % 360;      // start heading east; compass grows clockwise
    last = fb.addFix({ t: t * 1000, ...p, accuracy: 5, speed: v, heading, altitude: 100 });
  }
  return last;
};
const L = circle(+1), R = circle(-1);
out.left = L.lat_g; out.right = R.lat_g; out.expect = 15 * 15 / 100 / G;
// straight line: speed 10 -> 20 m/s over 10 s (accelerating), then braking 20 -> 10
const line = (v0, v1) => { const fb = new S.FrameBuilder(); let x = 0, last; for (let t = 0; t <= 10; t++) { const v = v0 + (v1 - v0) * t / 10; x += v; last = fb.addFix({ t: t * 1000, ...at(x, 0), accuracy: 5, speed: v, heading: 90 }); } return last; };
out.accel = line(10, 20).lon_g; out.brake = line(20, 10).lon_g; out.straightLat = line(15, 15).lat_g;
// unknowns stay unknown
{ const fb = new S.FrameBuilder();
  out.weak = fb.addFix({ t: 0, ...at(0, 0), accuracy: 200, speed: 10, heading: 90 });
  const a = fb.addFix({ t: 1000, ...at(0, 0), accuracy: 5, speed: 0, heading: null }), b = fb.addFix({ t: 2000, ...at(0, 0), accuracy: 5, speed: 0, heading: null });
  out.stopped = { lat: b.lat_g, camber: b.camber_deg, rough: b.roughness_rms }; }
// roughness: 0.2 g amplitude at 20 Hz on top of 1 g (phone in any orientation) -> rms 0.2 / sqrt(2); a steady phone -> 0
{ const fb = new S.FrameBuilder(), fb2 = new S.FrameBuilder();
  for (let i = 0; i < 40; i++) { const t = i * 50, a = G * (1 + 0.2 * Math.sin(2 * Math.PI * 7 * t / 1000)); fb.addMotion({ t, ax: 0.6 * a, ay: 0.0, az: 0.8 * a }); fb2.addMotion({ t, ax: 0, ay: 0, az: G }); }
  out.rough = fb.roughness; out.roughFlat = fb2.roughness; out.roughNone = new S.FrameBuilder().roughness; }
// recorder: 1 km straight at 20 m/s -> 5 m samples, CSV with blanks for what is unknown
{ const fb = new S.FrameBuilder(), rec = new S.Recorder();
  for (let t = 0; t <= 50; t++) rec.add(fb.addFix({ t: t * 1000, ...at(t * 20, 0), accuracy: 5, speed: 20, heading: 90, altitude: 100 + t }));
  const csv = rec.toCsv().trim().split('\n'), rows = csv.slice(1).map((l) => l.split(','));
  out.rec = { n: rows.length, km: rec.km, head: csv[0], gaps: rows.slice(1).every((r, i) => Math.abs(+r[1] - +rows[i][1] - 5) < 1e-6), camberBlank: rows.every((r) => r[8] === ''), mph: +rows[10][5], src: rows[3][12], peakBlank: rows.every((r) => r[11] === ''), lonGBlankEarly: rows[0][6] }; }
// native frames: camber and crest are kept only while the mount calibration is locked
for (const cal of ['locked', 'default', 'awaitingPull']) {
  const rec = new S.Recorder();
  for (let t = 0; t <= 20; t++) rec.add({ t: t * 1000, has_fix: true, ...at(t * 20, 0), speed_mps: 20, lat_g: 0.1, lon_g: 0, roughness_rms: 0.05, camber_deg: 3.5, crest_vertical_g: -0.12, calibration: cal });
  const rows = rec.toCsv().trim().split('\n').slice(1).map((l) => l.split(','));
  out['native_' + cal] = { camber: [...new Set(rows.map((r) => r[8]))], crest: [...new Set(rows.map((r) => r[10]))], latG: [...new Set(rows.map((r) => r[7]))], n: rows.length };
}
// native frames at 10 Hz between 1 Hz fixes: each frame's vertical spike lands where the car was, only while locked and moving
for (const cal of ['locked', 'default']) {
  const rec = new S.Recorder();
  for (let t = 0; t <= 200; t++) {                              // 20 m/s, a fix every 10 frames; position only moves on a fix
    const fix = Math.floor(t / 10), spike = t === 104 ? 0.8 : (t === 150 ? null : 0.05);
    rec.add({ t: t * 100, has_fix: true, ...at(fix * 20, 0), speed_mps: t >= 170 ? 0.5 : 20, lat_g: 0, lon_g: 0, roughness_rms: 0.05, calibration: cal, vert_peak_g: spike });
  }
  const rows = rec.toCsv().trim().split('\n').slice(1).map((l) => l.split(','));
  out['peak_' + cal] = rows.map((r) => r[11]);
}
// a 5 s tunnel at 20 m/s: the frames inside cannot be placed, so they are dropped rather than guessed
{ const rec = new S.Recorder(), fixAt = (t) => (t < 20 ? Math.floor(t / 10) : (t < 70 ? 2 : Math.floor(t / 10))) * 20;
  for (let t = 0; t <= 100; t++) rec.add({ t: t * 100, has_fix: true, ...at(fixAt(t), 0), speed_mps: 20, calibration: 'locked', vert_peak_g: t === 50 ? 0.9 : 0.05 });
  out.tunnel = rec.toCsv().trim().split('\n').slice(1).map((l) => l.split(',')[11]); }
// REVIEW4 U-88: a stray fix 40 km away (before the drive, and once in the middle) fills in no road and adds no distance
{ const rec = new S.Recorder(), fix = (t, m, far) => ({ t: t * 1000, has_fix: true, ...(far ? at(0, 40000) : at(m, 0)), speed_mps: 20 });
  rec.add(fix(0, 0, true));
  for (let t = 1; t <= 50; t++) rec.add(fix(t, t * 20, t === 25));
  const rows = rec.toCsv().trim().split('\n').slice(1).map((l) => l.split(','));
  out.stray = { n: rows.length, km: rec.km, maxLat: Math.max(...rows.map((r) => +r[2] - lat0)) }; }
// a long tunnel (60 s at 30 m/s, 1.8 km) is still a drive, not a jump
{ const rec = new S.Recorder();
  rec.add({ t: 0, has_fix: true, ...at(0, 0), speed_mps: 30 }); rec.add({ t: 60000, has_fix: true, ...at(1800, 0), speed_mps: 30 });
  out.longTunnel = rec.km; }
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    root = str(__import__("pathlib").Path(__file__).resolve().parents[1])
    p = subprocess.run([NODE, "-e", RUNNER, root], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_lateral_g_sign_and_size(r):
    assert r["left"] == pytest.approx(r["expect"], rel=0.12) and r["left"] > 0          # left turn = positive (ISO 8855)
    assert r["right"] == pytest.approx(-r["expect"], rel=0.12)
    assert abs(r["straightLat"]) < 0.01


def test_longitudinal_g(r):
    assert r["accel"] == pytest.approx(1.0 / 9.80665, rel=0.1)                            # +1 m/s^2 = throttle = positive
    assert r["brake"] == pytest.approx(-1.0 / 9.80665, rel=0.1)


def test_unknown_stays_unknown(r):
    assert r["weak"] == {"has_fix": False, "accuracy_m": 200}
    assert r["stopped"] == {"lat": None, "camber": None, "rough": None}                  # no yaw when stopped, camber never claimed


def test_roughness_from_motion(r):
    assert r["rough"] == pytest.approx(0.2 / 2 ** 0.5, rel=0.25)
    assert r["roughFlat"] == pytest.approx(0, abs=1e-6) and r["roughNone"] is None


def test_recording_is_5m_samples_with_blanks(r):
    rec = r["rec"]
    assert rec["gaps"] and rec["km"] == pytest.approx(1.0, abs=0.01) and 195 <= rec["n"] <= 201
    assert rec["camberBlank"] and rec["src"] == "web-gps"
    assert rec["head"] == "segment_index,distance_m,lat,lon,elevation_m,speed_mph,lon_g,lat_g,camber_deg,roughness_rms,crest_vertical_g,vert_peak_g,source"
    assert rec["peakBlank"]                                                                # a browser cannot measure the spike
    assert rec["mph"] == pytest.approx(44.7, abs=0.2)


def test_native_camber_and_crest_recorded_only_when_calibrated(r):
    locked = r["native_locked"]
    assert locked["n"] > 50 and locked["camber"] == ["3.50"] and locked["crest"] == ["-0.120"] and locked["latG"] == ["0.1000"]
    for cal in ("default", "awaitingPull"):                                               # an unsolved mount: unknown, not a guess
        assert r[f"native_{cal}"]["camber"] == [""] and r[f"native_{cal}"]["crest"] == [""] and r[f"native_{cal}"]["latG"] == [""]


def test_native_vertical_spike_lands_on_the_5m_sample_where_it_happened(r):
    peak = r["peak_locked"]
    # frame 104 is 0.4 s after the fix at 200 m (frame 100), 4/10 of the way to the one at 220 m (frame 110): 208 m, sample 41
    assert peak[41] == "0.800" and all(p == "0.050" for i, p in enumerate(peak[1:68], 1) if i != 41)
    # crawling (under 1 m/s from frame 170) records no spike: frame 169 is 338 m (sample 67), nothing after
    assert len(peak) == 81 and all(p == "" for p in peak[68:])
    assert set(r["peak_default"]) == {""}                                                # unsolved mount: unknown, not a guess


def test_spikes_inside_a_gps_gap_are_dropped_not_guessed(r):
    tunnel = r["tunnel"]
    assert "0.900" not in tunnel
    assert all(p == "" for p in tunnel[8:28]) and tunnel[3] == "0.050" and tunnel[-2] == "0.050"


def test_recorder_drops_a_stray_fix(r):
    # U-88: the end card's 60-mile map was a stray fix the recorder had filled in as road; it is a gap, never road
    assert r["stray"]["km"] == pytest.approx(0.94, abs=0.01)                              # 50 s at 20 m/s, less the hops to and from the stray
    assert r["stray"]["maxLat"] < 0.01                                                     # no sample on the 40 km line
    assert r["longTunnel"] == pytest.approx(1.8, abs=0.01)
