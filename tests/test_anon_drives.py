"""Anonymous drives (web/anon_drives.js; the owner, 2026-11-15): a copy of each drive with no account, name, car or clock
time, its first and last 1 to 1.5 km and every privacy zone left out, cut into unlinked pieces; the drive itself is unchanged."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const A = require(process.argv[1] + '/web/anon_drives.js');
const zlib = require('zlib');
let seed = 7; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
// 10 km due north, a sample every 5 m (lat steps of 5 / 110540 deg)
const n = 2001, lat = [], lon = [], dist = [], speed = [], t = [];
for (let i = 0; i < n; i++) { lat.push(39 + i * 5 / 110540); lon.push(-84.5); dist.push(i * 5); speed.push(20); t.push(1000 + i / 4); }
const d = { id: 'rec_home', name: 'Home to work', note: 'mine', tags: ['x'], car: { label: 'Tiburon' }, date: '2026-11-14T19:42:10.000Z', t0: 1731613330000,
  source: 'phone', cam_v: 2, hz: 1, lat, lon, dist, speed_mps: speed, lon_g: dist.map(() => 0), lat_g: dist.map(() => 0), t_s: t, events: [{ type: 'corner' }],
  said: [{ t: 3, m: 40, line: '4.0 seconds up on Sam.', eng: 'phone' }] };
const before = JSON.stringify(d);
const whole = A.anonymize(d, () => false, rng, { age: '25-34' });
// a privacy zone 300 m round the 5 km mark: two pieces
const zLat = 39 + 5000 / 110540, inZone = (la, lo) => Math.abs(la - zLat) * 110540 < 300;
const split = A.anonymize(d, inZone, rng, {});
const imported = A.anonymize({ ...d, source: 'imported' }, () => false, rng);
(async () => {
  const mem = {}, store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const posted = [];
  const now = Date.parse('2026-11-15T00:00:00Z');
  const old = { ...d, id: 'old', date: '2026-09-01T10:00:00Z' };
  const deps = { ids: async () => ['rec_home', 'old'], get: async (id) => (id === 'old' ? old : d), store, allowed: () => true, inZone: () => false, now: () => now, rng,
    post: async (b) => { posted.push(JSON.parse(zlib.gunzipSync(Buffer.from(b)).toString())); return true; } };
  const s1 = await A.sync(deps), s2 = await A.sync(deps);
  mem[A.SINCE_KEY] = '2026-11-14T23:00:00Z'; mem[A.SENT_KEY] = '[]';
  const s3 = await A.sync(deps);                                     // switched off and on after the drive: it never goes
  console.log(JSON.stringify({ whole, split: split.map((p) => [p.dist[0], p.dist.at(-1), p.lat[0], p.lat.at(-1)]), imported, unchanged: JSON.stringify(d) === before,
    s1, s2, s3, posted: posted.length, firstKeys: Object.keys(posted[0]).sort() }));
})();
"""


def run():
    out = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_a_piece_carries_nothing_about_the_driver():
    r = run()
    assert r["unchanged"]                                                # the driver's own drive is never changed
    [p] = r["whole"]
    for k in ("name", "note", "tags", "car", "date", "t0", "events", "said"):   # said: what the co-driver said (cockpit.js saidOnDrive)
        assert k not in p
    assert p["id"] != "rec_home" and len(p["id"]) == 16
    assert p["hour"] == "2026-11-14T19" and p["age"] == "25-34" and p["source"] == "phone"
    assert p["dist"][0] == 0 and p["t_s"][0] == 0                       # measured from the piece's own start


def test_ends_are_cut_by_a_random_1_to_1_5_km():
    [p] = run()["whole"]
    start_m = (p["lat"][0] - 39) * 110540
    end_m = (39 + 10000 / 110540 - p["lat"][-1]) * 110540
    assert 1000 <= start_m <= 1505 and 1000 <= end_m <= 1505


def test_a_privacy_zone_cuts_the_drive_into_unlinked_pieces():
    r = run()
    assert len(r["split"]) == 2
    z = 39 + 5000 / 110540
    (a0, a1, alat0, alat1), (b0, b1, blat0, blat1) = r["split"]
    assert a0 == 0 and b0 == 0                                            # each piece measured from its own start
    assert (z - alat1) * 110540 >= 295 and (blat0 - z) * 110540 >= 295   # nothing within the zone's 300 m
    assert r["imported"] == []


def test_sync_sends_each_recent_drive_once_and_never_one_from_while_it_was_off():
    r = run()
    assert r["s1"] == {"sent": 1, "pieces": 1}                          # the September drive is too old
    assert r["s2"] == {"sent": 0, "pieces": 0}
    assert r["s3"] == {"sent": 0, "pieces": 0}
    assert r["posted"] == 1
    assert "id" in r["firstKeys"] and "name" not in r["firstKeys"]


def test_it_is_off_the_launch_path_and_on_by_default():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    cockpit = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert 'src="anon_drives.js"' not in html and 'data-toggle="improve"' in html
    assert "improve: true }" in cockpit
    body = cockpit.split("function anonDrivesSync() {", 1)[1].split("\n    }\n", 1)[0]
    assert "devAccess" in body and "state.toggles.improve" in body
