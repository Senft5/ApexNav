"""Road feel that waits for signal (web/contributor.js leftover / sendLeftover, IDEAS Q-06): what a drive couldn't send
is kept on the phone, as the chunks that were built and the settled rows that weren't matched yet, and goes later once.
The first and last stretch of the drive are in neither; a resend is the same payload; a refusal drops it."""
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
const N = 1200;                                                       // 6 km driven = 1200 rows of 5 m
const row = (i) => ({ lat: lat0 + 3 / 110540, lon: lon0 + (i * 5) / mLon, roughness_rms: 0.1 });
const net = { up: true, matches: 0 };
const fetchFn = async (url, init) => {
  if (!net.up) throw new TypeError('Failed to fetch');
  if (url.includes('trace_attributes')) {
    const sh = JSON.parse(init.body).shape; net.matches++;
    return { ok: true, json: async () => ({ edges: [{ way_id: 77, road_class: 'tertiary' }], matched_points: sh.map(() => ({ type: 'matched', edge_index: 0 })) }) };
  }
  return { ok: true, json: async () => ({ elements: [{ type: 'way', id: 77, geometry: way.map(([la, lo]) => ({ lat: la, lon: lo })) }] }) };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const binsOf = (posts) => posts.flatMap((p) => p.bins.map((b) => b.i));
const span = (b) => ({ lo: Math.min(...b), hi: Math.max(...b), n: b.length, unique: new Set(b).size });
const NOW = Date.parse('2026-10-26T12:00:00Z'), day = '2026-10-25', wire = (x) => JSON.parse(JSON.stringify(x));   // as it is stored
const mk = (id, post, extra = {}) => C.createLive({ Core, skip: 200, lag: 200, fetch: fetchFn, driveId: id, drivenOn: day, retryMs: 1, post, deliberate: true, ...extra });
const out = {};
(async () => {
  // 1. no signal for the whole drive: nothing is matched, everything settled waits as rows
  { net.up = false; const posts = [];
    const live = mk('d_later_test_01', async (c) => { posts.push(c); return true; });
    for (let i = 0; i < N; i++) { live.push(row(i)); if (i % 100 === 0) await tick(); }
    const stats = await live.finish(), left = wire(live.leftover());
    const during = posts.length;
    net.up = true;
    const r = await C.sendLeftover(left, { Core, fetch: fetchFn, now: NOW, post: async (c) => { posts.push(c); return true; } });
    out.none = { during, chunks: stats.chunks, pending: left.pending.length, rows: left.rows.lat.length, from: left.from, to: left.to, keys: Object.keys(left).sort().join(),
                 state: r.state, item: r.item, km: r.km, bins: span(binsOf(posts)), ids: [...new Set(posts.map((p) => p.drive_id))], rec: posts[0].rec, day: posts[0].driven_on,
                 firstLon: left.rows.lon[0], lon200: row(200 - 20).lon }; }
  // 2. the signal goes halfway: what went stays gone, the chunk that failed is kept as it was, the rest waits as rows
  { net.up = true; const ok = [], tried = []; let n = 0;
    const live = mk('d_later_test_02', async (c) => { tried.push(JSON.stringify(c)); if (!net.up) return 'retry'; ok.push(c); return true; });
    for (let i = 0; i < N; i++) { live.push(row(i)); if (i === 650) { await tick(); await tick(); net.up = false; } if (i % 50 === 0) await tick(); }
    const stats = await live.finish(), left = wire(live.leftover());
    const failed = tried.filter((t) => !ok.some((c) => JSON.stringify(c) === t));
    net.up = true; const later = [];
    const r = await C.sendLeftover(left, { Core, fetch: fetchFn, now: NOW, post: async (c) => { later.push(c); return true; } });
    out.half = { liveChunks: stats.chunks, liveBins: span(binsOf(ok)), pending: left.pending.length, keptSame: !failed.length || JSON.stringify(later[0]) === failed[0],
                 all: span(binsOf([...ok, ...later])), state: r.state, laterChunks: r.chunks }; }
  // 3. sending later fails partway: the rows are chunks from then on, and the same payload goes again
  { net.up = false;
    const live = mk('d_later_test_03', async () => true, { chunk: 100 });
    for (let i = 0; i < N; i++) live.push(row(i));
    await live.finish(); const left = wire(live.leftover());
    net.up = true; const before = net.matches, calls = [];
    const r1 = await C.sendLeftover(left, { Core, fetch: fetchFn, now: NOW, post: async (c) => { calls.push(JSON.stringify(c)); return 'retry'; } });
    const kept = wire(r1.item);
    const r2 = await C.sendLeftover(kept, { Core, fetch: fetchFn, now: NOW, post: async (c) => { calls.push(JSON.stringify(c)); return true; } });
    net.up = false;
    const r0 = await C.sendLeftover(left, { Core, fetch: fetchFn, now: NOW, post: async () => true });   // still no signal: untouched
    out.again = { s1: r1.state, changed1: r1.changed, rows1: kept.rows, pending1: kept.pending.length, matches: net.matches - before, same: calls[0] === calls[1],
                  s2: r2.state, item2: r2.item, s0: r0.state, changed0: r0.changed, rows0: !!r0.item.rows }; net.up = true; }
  // 4. refused (signed out, or Share road feel turned off) and too old: dropped, nothing more sent
  { net.up = false;
    const live = mk('d_later_test_04', async () => true);
    for (let i = 0; i < N; i++) live.push(row(i));
    await live.finish(); const left = wire(live.leftover()); net.up = true;
    const built = wire((await C.sendLeftover(left, { Core, fetch: fetchFn, now: NOW, post: async () => 'retry' })).item);
    let calls = 0; const before = net.matches;
    const stop = await C.sendLeftover(built, { Core, fetch: fetchFn, now: NOW, post: async () => { calls++; return 'stop'; } });
    const old = await C.sendLeftover(left, { Core, fetch: fetchFn, now: NOW + 20 * 86400000, post: async () => { calls++; return true; } });
    const junk = await C.sendLeftover({ v: 9 }, { Core, fetch: fetchFn, now: NOW, post: async () => { calls++; return true; } });
    const bad = await C.sendLeftover(built, { Core, fetch: fetchFn, now: NOW, post: async () => false });   // bad data: never resent
    out.drop = { stop: stop.state, stopItem: stop.item, calls, old: old.state, junk: junk.state, matches: net.matches - before, bad: bad.state, badKm: bad.km }; }
  // 5. nothing owed: a drive that sent everything, one the server refused, one too short
  { net.up = true;
    const a = mk('d_later_test_05', async () => true); for (let i = 0; i < N; i++) { a.push(row(i)); if (i % 50 === 0) await tick(); } await a.finish();
    const b = mk('d_later_test_06', async () => 'stop'); for (let i = 0; i < N; i++) b.push(row(i)); await b.finish();
    net.up = false;
    const c = mk('d_later_test_07', async () => true); for (let i = 0; i < 380; i++) c.push(row(i)); await c.finish();
    out.nothing = [a.leftover(), b.leftover(), c.leftover()]; net.up = true; }
  // 6. taking the leftover closes the stream: rows after it are never sent from there
  { net.up = false; const posts = [];
    const live = mk('d_later_test_08', async (c) => { posts.push(c); return true; });
    for (let i = 0; i < N; i++) live.push(row(i));
    await live.finish(); live.leftover(); net.up = true;
    for (let i = N; i < N + 400; i++) live.push(row(i));
    await tick(); await live.run(true); await live.finish();
    out.closed = posts.length; }
  // 7. sharing a saved drive by hand: a busy server is not "shared"
  { const drive = { id: 'x', date: '2026-10-25T10:00:00Z', lat: [], lon: [], rough: [], kappa: [] };
    for (let i = 0; i < N; i++) { const x = row(i); drive.lat.push(x.lat); drive.lon.push(x.lon); drive.rough.push(0.1); drive.kappa.push(0); }
    let err = null;
    try { await C.contributeDrive(drive, async () => 'retry', { fetch: fetchFn, now: NOW, trimM: 1000 }); } catch (e) { err = e.message; }
    const ok = await C.contributeDrive(drive, async () => true, { fetch: fetchFn, now: NOW, trimM: 1000 });
    out.byHand = { err, sent: ok.sent }; }
  // 8. the app's mounted sharing: a trip that ends with no signal hands over what it owes; one that sent everything hands over nothing
  { const mkAmbient = (left) => { let t = 0; const amb = C.createAmbient({ now: () => t, onLeftover: (x) => left.push(wire(x)),
        makeRecorder: () => { const rows = []; return { rows, add: (fr) => rows.push({ lat: fr.lat, lon: fr.lon, roughness_rms: 0.1, speed_mps: 15 }) }; },
        makeLive: () => mk('d_later_test_09', async () => true, { deliberate: () => drive.rec }) });
      return { amb, step: () => { t += 100; } }; };
    const drive = { rec: false };
    for (const up of [false, true]) {
      net.up = up; drive.rec = false; const left = [], a = mkAmbient(left);
      for (let i = 0; i < N; i++) { if (i === 300) drive.rec = true; if (i === 900) drive.rec = false;      // Start and End inside the trip
        a.step(); a.amb.frame({ ...row(i), has_fix: true, calibration: 'locked', speed_mps: 15 }); if (i % 50 === 0) await tick(); }
      a.amb.stop(); for (let i = 0; i < 80 && !left.length; i++) await new Promise((r) => setTimeout(r, 10));
      out[up ? 'ambientUp' : 'ambientDown'] = left.map((x) => ({ rows: x.rows ? x.rows.lat.length : 0, pending: x.pending.length, rec: x.rec }));
    }
    net.up = true; }
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    p = subprocess.run([NODE, "-e", JS, str(ROOT)], capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_a_drive_with_no_signal_waits_whole_and_goes_later_without_its_ends(out):
    n = out["none"]
    assert n["during"] == 0 and n["chunks"] == 0 and n["pending"] == 0
    assert n["keys"] == "drive_id,driven_on,from,pending,rec,rows,to,v"       # no name, no time of day, no account
    assert (n["from"], n["to"], n["rows"]) == (20, 820, 840)                  # rows 200..1000 and 20 rows of matcher context each side
    assert n["firstLon"] == pytest.approx(n["lon200"], abs=1e-6)              # the first kilometre is not in what's kept
    assert n["state"] == "done" and n["item"] is None and n["km"] == pytest.approx(4.0, abs=0.1)
    b = n["bins"]
    assert b["lo"] >= 199 and b["hi"] <= 1001 and b["n"] == b["unique"] and b["n"] >= 780
    assert n["ids"] == ["d_later_test_01"] and n["rec"] == 1 and n["day"] == "2026-10-25"   # the drive's own id and day


def test_signal_lost_halfway_sends_the_rest_once(out):
    h = out["half"]
    assert h["liveChunks"] >= 1 and h["liveBins"]["hi"] < 800                 # some went while there was signal
    assert h["keptSame"]                                                      # a built chunk is kept as it was
    assert h["state"] == "done" and h["laterChunks"] >= 1
    a = h["all"]
    assert a["n"] == a["unique"] and a["lo"] >= 199 and a["hi"] <= 1001 and a["n"] >= 780   # nothing twice, nothing lost


def test_a_failed_later_send_keeps_built_chunks_and_resends_the_same_payload(out):
    a = out["again"]
    assert (a["s1"], a["changed1"], a["rows1"]) == ("retry", True, None) and a["pending1"] >= 1
    assert a["matches"] == 1                                                  # matched once; the second try only posts
    assert a["same"] and a["s2"] == "done" and a["item2"] is None
    assert (a["s0"], a["changed0"], a["rows0"]) == ("retry", False, True)     # no signal: nothing to save again


def test_refused_or_too_old_is_dropped(out):
    d = out["drop"]
    assert d["stop"] == "stop" and d["stopItem"] is None and d["calls"] == 1  # one answer is enough: nothing more is tried
    assert d["old"] == "expired" and d["junk"] == "expired" and d["matches"] == 0
    assert d["bad"] == "done" and d["badKm"] == 0                             # bad data is never resent, and never counted


def test_nothing_owed_and_the_stream_is_closed(out):
    assert out["nothing"] == [None, None, None]
    assert out["closed"] == 0


def test_sharing_by_hand_does_not_count_a_busy_server_as_shared(out):
    assert out["byHand"]["err"] == "upload failed" and out["byHand"]["sent"] >= 1


def test_the_apps_mounted_sharing_hands_over_what_a_trip_owes(out):
    assert out["ambientDown"] == [{"rows": 840, "pending": 0, "rec": 1}]      # a recorded drive ran inside the trip: it says so
    assert out["ambientUp"] == []                                             # everything went as it was driven: nothing kept


def test_the_app_keeps_it_on_the_phone_and_sends_it_off_the_drive():
    html = cockpit_source()
    assert "onLeftover: (left) => { keepUnsentRoads(left); }" in html         # the app's mounted sharing (where real drives go)
    assert "left: live.leftover()" in html and "left: L.leftover()" in html   # the browser's drive: End, and entering a home zone
    fn = html[html.index("async function sendUnsentRoads()"):]
    fn = fn[:fn.index("setTimeout(sendUnsentRoads, 8000)")]
    assert "driveActive" in fn and "navigator.onLine === false" in fn
    assert "if (r.changed) await ApexRecording.unsentPut(r.item, key); break;" in fn     # built chunks are kept as chunks
    assert "if (r.state === 'stop') { await ApexRecording.unsentRemove(); break; }" in fn  # refused: none of it goes
    # switching Share road feel off (both switches), signing out (both keys) and deleting the account drop it at once
    assert html.count("forgetUnsentRoads()") >= 5
    # a launch with no signal still measures: the server's last answer stands until it can be asked again
    assert "if (!reached && roadFeelWasOn())" in html
    rec = (ROOT / "web" / "recording.js").read_text()
    assert "if (r.kind === 'unsent') continue;" in rec                        # never mistaken for a drive in progress
    assert "UNSENT_MAX = 12, UNSENT_ROWS = 60000" in rec                      # bounded; the oldest go first
    assert re.search(r"deliberate: \(\) => !!\(drive\.native && drive\.rec\)", html)   # a recorded drive counts toward loved roads in the app too
