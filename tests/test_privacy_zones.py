"""Privacy zones (web/privacy_zones.js, IDEAS Z-02) and the recorder's gap across one (web/sensors.js Recorder.pause)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const Z = require(process.argv[1] + '/web/privacy_zones.js');
const S = require(process.argv[1] + '/web/sensors.js');
const out = {};
const store = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
let zones = Z.add([], { lat: 35.96, lon: -83.92, r: 500, name: '  Home ' }, 'h');
zones = Z.add(zones, { lat: 35.90, lon: -83.90, r: 200, name: '' }, 'w');
out.added = zones;
out.bad = [Z.add(zones, { lat: 99, lon: 0, r: 500 }), Z.add(zones, { lat: 1, lon: 1, r: 50 }), Z.add(zones, { lat: 1, lon: 1, r: 5000 })];
let many = []; for (let i = 0; i < Z.MAX_ZONES; i++) many = Z.add(many, { lat: i, lon: 0, r: 200 }, 'z' + i);
out.full = Z.add(many, { lat: 50, lon: 0, r: 200 });
// inside within the radius (~450 m north of home), outside beyond it (~560 m), unknown position never inside
out.at = [Z.zoneAt(zones, 35.96 + 450 / 110540, -83.92)?.id ?? null, Z.zoneAt(zones, 35.96 + 560 / 110540, -83.92)?.id ?? null,
          Z.zoneAt(zones, NaN, -83.92), Z.zoneAt([], 35.96, -83.92)];
Z.save(store, zones);
out.roundTrip = Z.load(store);
store.m[Z.KEY] = 'not json'; out.corrupt = Z.load(store);
store.m[Z.KEY] = JSON.stringify([{ lat: 1, lon: 1, r: 300 }, { lat: 'x', lon: 1, r: 300 }]); out.cleaned = Z.load(store);
out.removed = Z.remove(zones, 'h').map(z => z.id);

// Recorder: a pause between two fixes 1 km apart places no samples between them; the distance carries on afterwards.
const R = new S.Recorder();
const fix = (lat) => ({ has_fix: true, lat, lon: -83.92, t: 1, speed_mps: 15 });
for (let i = 0; i <= 20; i++) R.add(fix(35.90 + i * 1 / 110540));        // 20 m
R.pause();
for (let i = 0; i <= 20; i++) R.add(fix(35.91 + i * 1 / 110540));        // ~1.1 km further north, 20 m more
const lats = R.rows.map(r => r.lat);
out.gapRows = lats.filter(l => l > 35.9003 && l < 35.9099).length;     // anything placed inside the gap
out.rows = R.rows.length;
out.monotonic = R.rows.every((r, i) => i === 0 || r.distance_m > R.rows[i - 1].distance_m);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    res = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_add_validates_and_names(out):
    assert [(z["id"], z["name"], z["r"]) for z in out["added"]] == [("h", "Home", 500), ("w", "Private place", 200)]
    assert out["bad"] == [None, None, None]
    assert out["full"] is None


def test_zone_lookup(out):
    assert out["at"] == ["h", None, None, None]


def test_storage_round_trip_and_cleaning(out):
    assert out["roundTrip"] == out["added"]
    assert out["corrupt"] == []
    assert [(z["lat"], z["r"]) for z in out["cleaned"]] == [(1, 300)]
    assert out["removed"] == ["w"]


def test_recorder_places_nothing_across_a_pause(out):
    assert out["gapRows"] == 0
    assert out["rows"] >= 8                  # both 20 m stretches recorded (4+ rows each)
    assert out["monotonic"]


def test_page_gates_recording_sharing_and_convoy():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert '<script src="privacy_zones.js"></script>' in html
    assert "drive.rec.add(" not in html.replace("{ drive.rec.add(fr); return true; }", "")   # every drive frame goes through recordFrame
    assert "feedAmbient(inPrivacyZone(frame.lat, frame.lon) ? { has_fix: false } : frame)" in html
    assert "if (inPrivacyZone(p.lat, p.lon)) return null;" in html                          # convoy getFix
