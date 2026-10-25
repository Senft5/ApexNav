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
  out.rec = { n: rows.length, km: rec.km, head: csv[0], gaps: rows.slice(1).every((r, i) => Math.abs(+r[1] - +rows[i][1] - 5) < 1e-6), camberBlank: rows.every((r) => r[8] === ''), mph: +rows[10][5], src: rows[3][10], lonGBlankEarly: rows[0][6] }; }
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
    assert rec["head"].startswith("segment_index,distance_m,lat,lon,elevation_m,speed_mph,lon_g,lat_g,camber_deg,roughness_rms")
    assert rec["mph"] == pytest.approx(44.7, abs=0.2)
