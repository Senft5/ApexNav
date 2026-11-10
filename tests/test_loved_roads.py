"""Loved roads need to know a pass came from a recorded drive (`rec`; backend/src/contribute.ts countAgain). In the
iPhone app one mounted stream carries the road feel through Start and End (cockpit.js feedAmbient), and it never said
so: only the browser's drive did. And the Log's Share by hand counted a busy server as "shared"."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from tests.page_source import cockpit_source

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="needs node")

JS = r"""
const C = require(process.argv[1] + '/web/contributor.js');
const Core = require(process.argv[1] + '/web/apex_core.js');
const lat0 = 35.0, lon0 = -83.0, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
const way = [[lat0, lon0], [lat0, lon0 + 12000 / mLon]];              // a 12 km straight way
const N = 1200;                                                       // 6 km = 1200 rows of 5 m
const row = (i) => ({ lat: lat0 + 3 / 110540, lon: lon0 + (i * 5) / mLon, roughness_rms: 0.1 });
const net = { up: true };
const fetchFn = async (url, init) => {
  if (!net.up) throw new TypeError('Failed to fetch');
  if (url.includes('trace_attributes')) { const sh = JSON.parse(init.body).shape;
    return { ok: true, json: async () => ({ edges: [{ way_id: 77, road_class: 'tertiary' }], matched_points: sh.map(() => ({ type: 'matched', edge_index: 0 })) }) }; }
  return { ok: true, json: async () => ({ elements: [{ type: 'way', id: 77, geometry: way.map(([la, lo]) => ({ lat: la, lon: lo })) }] }) };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const out = {};
(async () => {
  // the app's mounted stream: Start is pressed at row 500 and End at row 800, inside one trip
  for (const up of [true, false]) {
    net.up = up; const drive = { rec: false }, posts = []; let t = 0, live = null;
    const amb = C.createAmbient({ now: () => t,
      makeRecorder: () => { const rows = []; return { rows, add: (fr) => rows.push({ lat: fr.lat, lon: fr.lon, roughness_rms: 0.1, speed_mps: 15 }) }; },
      makeLive: () => (live = C.createLive({ Core, skip: 200, lag: 200, fetch: fetchFn, driveId: 'd_loved_test_01', drivenOn: '2026-11-09', retryMs: 1, carry: null,
        post: async (c) => { posts.push(c); return true; }, deliberate: () => drive.rec })) });
    for (let i = 0; i < N; i++) { if (i === 500) drive.rec = true; if (i === 800) drive.rec = false;
      t += 100; amb.frame({ ...row(i), has_fix: true, calibration: 'locked', speed_mps: 15 }); if (i % 20 === 0) { await tick(); await tick(); } }
    const left = JSON.parse(JSON.stringify(live.leftover()));          // as the carry would keep it
    out[up ? 'up' : 'down'] = { posts: posts.map((p) => [Math.min(...p.bins.map((b) => b.i)), p.rec]), left: left && { deliberate: left.deliberate, rows: left.rows.lat.length } };
  }
  net.up = true;
  // a stream that never met a recorded drive, and the browser's drive (always one)
  { const mk = (deliberate) => { const posts = []; return { posts, live: C.createLive({ Core, skip: 200, lag: 200, fetch: fetchFn, driveId: 'd_loved_test_02', drivenOn: '2026-11-09', carry: null, deliberate,
      post: async (c) => { posts.push(c); return true; } }) }; };
    const a = mk(() => false), b = mk(true), c = mk(undefined);
    for (const x of [a, b, c]) { for (let i = 0; i < N; i++) { x.live.push(row(i)); if (i % 50 === 0) await tick(); } await x.live.finish(); }
    out.plain = [a, b, c].map((x) => [...new Set(x.posts.map((p) => p.rec))]); }
  // sharing a saved drive by hand: a busy server is not "shared"
  { const drive = { id: 'x', date: '2026-11-09T10:00:00Z', lat: [], lon: [], rough: [], kappa: [] };
    for (let i = 0; i < N; i++) { const x = row(i); drive.lat.push(x.lat); drive.lon.push(x.lon); drive.rough.push(0.1); drive.kappa.push(0); }
    const NOW = Date.parse('2026-11-10T12:00:00Z'); let err = null;
    try { await C.contributeDrive(drive, async () => 'retry', { fetch: fetchFn, now: NOW, trimM: 1000 }); } catch (e) { err = e.message; }
    const ok = await C.contributeDrive(drive, async () => true, { fetch: fetchFn, now: NOW, trimM: 1000 });
    const bad = await C.contributeDrive(drive, async () => false, { fetch: fetchFn, now: NOW, trimM: 1000 });
    out.byHand = { err, sent: ok.sent, bad: bad.sent, built: bad.built }; }
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    p = subprocess.run([NODE, "-e", JS, str(ROOT)], capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_the_apps_stream_says_recorded_from_the_drives_first_row_on(out):
    posts = out["up"]["posts"]
    assert len(posts) >= 5
    before, after = [r for lo, r in posts if lo < 250], [r for lo, r in posts if lo >= 500]
    assert before and set(before) == {0}                    # built before Start was pressed: an ambient pass
    assert after and set(after) == {1}                      # rows of the recorded drive, and what follows it in the trip
    flags = [r for _, r in posts]
    assert flags == sorted(flags)                           # once it says so it keeps saying so (End inside the trip changes nothing)


def test_what_waits_for_signal_remembers_it_was_recorded(out):
    d = out["down"]
    assert d["posts"] == []
    assert d["left"]["deliberate"] is True and d["left"]["rows"] == 800    # a plain boolean: it is stored and sent later


def test_other_streams_are_unchanged(out):
    assert out["plain"] == [[0], [1], [0]]


def test_sharing_by_hand_does_not_count_a_busy_server_as_shared(out):
    h = out["byHand"]
    assert h["err"] == "upload failed" and h["sent"] >= 1
    assert h["bad"] == 0 and h["built"] >= 1                # refused as bad data: not shared, and not an error to retry


def test_the_page_wires_it():
    html = cockpit_source()
    assert re.search(r"deliberate: \(\) => !!\(drive\.native && drive\.rec\)", html)
    # a drive the mounted stream covered, or one whose road feel waits for signal, is not offered by hand in the Log
    assert "else if (nativeShared) ApexAnalysis.job('patch', { id: res.driveId, fields: { contributed: true } })" in html
    assert "if ((shared && shared.chunks > 0) || waits) await ApexAnalysis.job('patch'" in html
    assert "&& !d.contributed" in (ROOT / "web" / "analysis.html").read_text()
