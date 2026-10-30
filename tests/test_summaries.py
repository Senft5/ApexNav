"""The Log's drive summaries (REVIEW_FEEL F-06, web/recording.js summarize): what the list, the end card and the Garage
need of a drive, taken from the drive's own record. The score is the one every page computes (scoreOf), nothing is
estimated, and no row is copied. The IndexedDB migration itself (v2 to v3, lossless) is the e2e flow "the Log after the
update"."""
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
globalThis.ApexCore = require(R + '/web/apex_core.js');
const Rec = require(R + '/web/recording.js'), Core = globalThis.ApexCore;
// a 6 km road that winds, driven with measured g; and a drive on it whose g was never measured (web GPS)
const rec = (id, n, g) => { const lat = [], lon = []; for (let i = 0; i < n; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29 + Math.sin(i / 12) * 0.0012); }
  return { id, name: 'Cherohala Skyway', date: '2026-10-20T09:00', date_known: true, source: 'web-gps', lat, lon, dist: lat.map((_, i) => i * 5),
    speed_mps: lat.map((_, i) => 13 + 4 * Math.cos(i / 6)), lon_g: lat.map((_, i) => g * -0.25 * Math.sin(i / 6)), lat_g: lat.map((_, i) => g * 0.45 * Math.sin(i / 12)),
    g_known: null, elev: null, hz: 1, tags: ['dry'], note: 'n', ended: 'car', battery: { perHour: 9, minutes: 30, usedPct: 4.5 } }; };
const profiled = (d) => { const p = Core.profileRecording({ lat: d.lat, lon: d.lon, distance_m: d.dist, speed_mph: d.speed_mps.map((v) => v * 2.2369362921), lon_g: d.lon_g, lat_g: d.lat_g });
  return { ...d, events: p.events, envMps: p.envMps, sightM: p.sightM }; };
const a = profiled(rec('a', 1200, 1)), flat = { ...profiled(rec('f', 400, 0)), g_known: Array(400).fill(0) };   // no g measured
const sa = Rec.summarize(Core, a), sf = Rec.summarize(Core, flat);
const T = Core.elapsedS(a.speed_mps);
let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
for (let i = 0; i < a.lat.length; i++) { s = Math.min(s, a.lat[i]); n = Math.max(n, a.lat[i]); w = Math.min(w, a.lon[i]); e = Math.max(e, a.lon[i]); }
console.log(JSON.stringify({ sa, sf, scoreOf: Rec.scoreOf(Core, a).ds, corners: Rec.scoreOf(Core, a).corners.map((c) => [c.start, c.end, c.apex]), secs: T[T.length - 1], bbox: [s, n, w, e],
  bytes: JSON.stringify(sa).length, rowBytes: JSON.stringify(a).length, noCore: Rec.summarize(null, a) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_score_is_the_drives_own(out):
    assert out["sa"]["ds"]["score"] == out["scoreOf"]["score"] and out["sa"]["ds"]["score"] is not None
    assert out["sa"]["ds"]["components"] == out["scoreOf"]["components"]
    assert out["sa"]["corners"] == out["corners"] and len(out["corners"]) > 3


def test_unknown_stays_unknown(out):
    assert out["sf"]["ds"]["score"] is None, "a drive without clean corners has no score, never a guess"
    assert out["noCore"] is None, "no core: summarised later, not half-built"


def test_what_the_list_needs_and_no_rows(out):
    s = out["sa"]
    assert s["n"] == 1200 and s["len_m"] == 5995 and s["secs"] == pytest.approx(out["secs"])
    assert s["bbox"] == out["bbox"]
    assert s["tags"] == ["dry"] and s["note"] == "n" and s["ended"] == "car" and s["battery"]["perHour"] == 9
    for k in ("lat", "lon", "speed_mps", "lat_g", "lon_g", "dist", "events", "kappa"):
        assert k not in s, k
    assert out["bytes"] * 50 < out["rowBytes"], (out["bytes"], out["rowBytes"])
