"""web/live_pipeline.js (IDEAS A-02) against the live reference: the same fixture ApexKit is held to
(ApexKit/Tests/Fixtures/live_fixture.json, from core/live_pipeline.py) must come out the same, every output and mount state,
plus the DeviceMotion conversion and the GPS cross-check that gates a browser's camber."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(ROOT, "ApexKit", "Tests", "Fixtures", "live_fixture.json")

RUNNER = r"""
const L = require(process.argv[1] + '/web/live_pipeline.js');
const fx = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const want = new Map(fx.outputs_every_10.map((r) => [r[0], r.slice(1)]));
const mounts = new Map(fx.mount_every_10.map((r) => [r[0], r]));
const pipe = new L.IMUPipeline();
let worst = 0, worstMount = 0, states = [], compared = 0;
for (let i = 0; i < fx.t.length; i++) {
  pipe.step(fx.accel[i], fx.gyro[i], fx.t[i], fx.speed[i], fx.gravity[i]);
  if (want.has(i)) {
    const got = pipe.outputs().slice(0, 8), exp = want.get(i);
    got.forEach((g, k) => { worst = Math.max(worst, Math.abs(g - exp[k]) / Math.max(1, Math.abs(exp[k]))); });
    compared++;
  }
  if (mounts.has(i)) {
    const m = mounts.get(i), rows = pipe.mount.rows().flat();
    if (pipe.mount.state !== m[1]) states.push([i, pipe.mount.state, m[1]]);
    rows.forEach((v, k) => { worstMount = Math.max(worstMount, Math.abs(v - m[2 + k])); });
  }
  if (i % 50 === 0) pipe.takeVertPeak();
}
// DeviceMotion: flat, face up, at rest; and an event without rotation rate
const flat = L.fromDeviceMotion({ acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.80665 }, rotationRate: { alpha: 90, beta: 0, gamma: 0 } });
const noGyro = L.fromDeviceMotion({ acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 }, rotationRate: null });
const notGravity = L.fromDeviceMotion({ acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 2 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } });
const cc = new L.CrossCheck(); for (let k = 0; k < 12; k++) cc.add(0.3, 0.25); cc.add(0.3, 0.05);
const bad = new L.CrossCheck(); for (let k = 0; k < 12; k++) bad.add(-0.3, 0.25);
const few = new L.CrossCheck(); for (let k = 0; k < 9; k++) few.add(0.3, 0.25);
console.log(JSON.stringify({ worst, worstMount, states, compared, n: want.size, flat, noGyro, notGravity, cc: cc.verified, bad: bad.verified, few: few.verified }));
"""


def run():
    out = subprocess.run([NODE, "-e", RUNNER, ROOT, FIXTURE], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_pipeline_matches_reference():
    r = run()
    assert r["compared"] == r["n"] > 0
    assert r["worst"] < 1e-9
    assert r["states"] == []
    assert r["worstMount"] < 1e-9


def test_device_motion_and_cross_check():
    r = run()
    assert r["flat"]["gravity"] == pytest.approx([0, 0, -1])
    assert r["flat"]["gyro"][2] == pytest.approx(3.14159265 / 2)
    assert r["noGyro"] is None and r["notGravity"] is None
    assert r["cc"] is True and r["bad"] is False and r["few"] is False


SIM = r"""
// A 4-minute drive with the phone mounted crooked: pull away, then alternating 6 s turns at 15 m/s (left ones banked 4 deg,
// right ones flat), through sensors.js FrameBuilder exactly as the browser shell feeds it. `flip` mimics an engine that
// reports motion with the opposite sign: it must never verify.
const S = require(process.argv[1] + '/web/sensors.js');
const flip = process.argv[2] === 'flip';
const G = 9.80665, D2R = Math.PI / 180, FS = 100, BANK = 4 * D2R;
const rot = (() => { const [a, b, c] = [-70 * D2R, 10 * D2R, 95 * D2R];      // vehicle -> phone, x then y then z
  const Rx = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const Ry = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
  const Rz = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
  const mul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
  return mul(Rz, mul(Ry, Rx)); })();
const ap = (v) => rot.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const fb = new S.FrameBuilder();
let v = 0, psi = 0, n = 0, e = 0, lat0 = 39.0, lon0 = -84.0, rnd = 1;
const noise = () => { rnd = (rnd * 16807) % 2147483647; return (rnd / 2147483647 - 0.5) * 0.3; };
const out = [];
for (let i = 0; i < 240 * FS; i++) {
  const t = i / FS;
  let ax = 0, yaw = 0, banked = false;
  if (t >= 5 && t < 10) ax = 3;                                   // to 15 m/s
  else if (t >= 12) { const k = Math.floor((t - 12) / 8), ph = (t - 12) % 8; if (ph < 6) { yaw = k % 2 ? -0.3 : 0.3; banked = yaw > 0; } }
  v = Math.max(0, v + ax / FS);
  const ay = banked ? v * yaw * Math.cos(BANK) - G * Math.sin(BANK) : v * yaw;
  const az = 0.6 * Math.sin(2 * Math.PI * 12 * t) + noise();
  psi += yaw / FS; n += v * Math.cos(psi) / FS; e -= v * Math.sin(psi) / FS;   // yaw left = heading turns west
  const s = flip ? -1 : 1;
  const sample = { accel: ap([ax, ay, az]).map((x) => x * s), gravity: ap([0, 0, -1]).map((x) => x * s), gyro: ap([0, 0, yaw]) };
  fb.addImu(sample, t, t * 1000);
  if (i % FS === 0) {
    const course = ((-psi / D2R) % 360 + 360) % 360;
    const f = fb.addFix({ t: t * 1000, lat: lat0 + n / 110540, lon: lon0 + e / (111320 * Math.cos(lat0 * D2R)), accuracy: 5, speed: v, heading: v > 1 ? course : null, altitude: null });
    out.push({ t, yaw, banked, cal: f.calibration || null, camber: f.camber_deg, mount: f.web_mount, rough: f.roughness_rms });
  }
}
console.log(JSON.stringify(out));
"""


def sim(flip=False):
    out = subprocess.run([NODE, "-e", SIM, ROOT, "flip" if flip else ""], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_browser_frames_get_camber_only_once_verified():
    rows = sim()
    first = next((r["t"] for r in rows if r["cal"] == "locked"), None)
    assert first is not None and first < 120, "the mount verifies within two minutes of turns"
    assert all(r["camber"] is None for r in rows if r["t"] < first)
    late = [r for r in rows if r["t"] > first]
    assert all(r["cal"] == "locked" and r["mount"] == "verified" for r in late)
    # mid-corner (after the camber filter settles): banked left turns read about +4 deg, flat right turns about 0
    left = [r["camber"] for r in late if r["banked"] and (r["t"] - 12) % 8 >= 3]
    right = [r["camber"] for r in late if r["yaw"] < 0 and (r["t"] - 12) % 8 >= 3]
    assert left and right
    assert abs(sum(left) / len(left) - 4.0) < 0.6
    assert abs(sum(right) / len(right)) < 0.6


def test_browser_with_inverted_motion_never_verifies():
    rows = sim(flip=True)
    assert sum(r["mount"] == "locked" for r in rows) > 100, "the mount locks; only the GPS cross-check refuses it"
    assert all(r["cal"] is None and r["camber"] is None for r in rows)
