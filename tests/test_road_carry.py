"""Road data that waited for signal (web/road_carry.js with web/contributor.js createLive; IDEAS Q-06): a trip that ends
with no signal keeps what it had not sent on the phone, and it goes when signal is back: the same sections an online trip
sends, never the private ends, once. Synthetic roads in the test only, never shipped."""
import json
import pathlib
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = pathlib.Path(__file__).resolve().parents[1]

RUNNER = r"""
const C = require(process.argv[1] + '/web/contributor.js');
const R = require(process.argv[1] + '/web/road_carry.js');
const M = require(process.argv[1] + '/web/my_data.js');
const Core = require(process.argv[1] + '/web/apex_core.js');
const lat0 = 35.0, lon0 = -83.0, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
const way = [[lat0, lon0], [lat0, lon0 + 40000 / mLon]];              // a 40 km straight way
const row = (i) => ({ lat: lat0 + 3 / 110540, lon: lon0 + (i * 5) / mLon, roughness_rms: 0.1, camber_deg: 2, camber_v: C.CAM_V, crest: -0.1, speed_mps: 20, lon_g: 0 });
// the network: net.up false is no signal (fetch throws, as a phone's does); net.failAfter lets that many matches through first
const fake = (net) => async (url, init) => {
  if (!net.up) throw new TypeError('Load failed');
  if (url.includes('trace_attributes')) {
    if (net.failAfter != null && net.matches >= net.failAfter) throw new TypeError('Load failed');
    const sh = JSON.parse(init.body).shape; net.matches++; net.sizes.push(sh.length);
    return { ok: true, json: async () => ({ edges: [{ way_id: 77, road_class: 'tertiary' }], matched_points: sh.map(() => ({ type: 'matched', edge_index: 0 })) }) };
  }
  return { ok: true, json: async () => ({ elements: [{ type: 'way', id: 77, geometry: way.map(([la, lo]) => ({ lat: la, lon: lo })) }] }) };
};
const network = (up = true) => ({ up, matches: 0, sizes: [], failAfter: null });
const memStore = () => { const m = new Map(); return { m, keys: async () => [...m.keys()], get: async (id) => m.get(id), put: async (id, v) => { m.set(id, JSON.parse(JSON.stringify(v))); }, del: async (id) => { m.delete(id); }, clear: async () => { m.clear(); } }; };
const memStorage = () => { const m = {}; return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; },
  get length() { return Object.keys(m).length; }, key: (i) => Object.keys(m)[i] }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const binsOf = (posts) => posts.flatMap((p) => p.bins.map((b) => b.i));
const span = (posts) => { const b = binsOf(posts); return { n: b.length, unique: new Set(b).size, lo: Math.min(...b), hi: Math.max(...b) }; };

// One phone: a carry over a store and a storage, a post that records, a clock.
function phone({ ready = async () => true, maxRows, post } = {}) {
  const P = { store: memStore(), storage: memStorage(), posts: [], t: Date.parse('2026-10-25T12:00:00Z'), net: network(false), readyCalls: 0 };
  P.post = post || (async (c) => { if (!P.net.up) return 'retry'; P.posts.push(c); return true; });
  P.make = () => (P.carry = R.createCarry({ store: P.store, storage: P.storage, now: () => P.t, ...(maxRows ? { maxRows } : {}),
    ready: async () => { P.readyCalls++; return ready(); },
    resume: (item) => R.resumeItem(item, { Contributor: C, Core, post: (c) => P.post(c), fetch: fake(P.net) }) }));
  P.make();
  P.live = (id, extra = {}) => C.createLive({ Core, skip: 200, lag: 200, fetch: fake(P.net), driveId: id, drivenOn: '2026-10-25', retryMs: 1000, now: () => P.t, post: (c) => P.post(c), carry: P.carry, ...extra });
  P.drive = async (live, from, to) => { for (let i = from; i < to; i++) { live.push(row(i)); if (i % 50 === 0) { await tick(); P.t += 1500; } } };
  return P;
}
const out = {};
(async () => {
  // the reference: the same 6 km trip with signal all the way
  { const P = phone(); P.net.up = true; const live = P.live('d_carry_ref_01'); await P.drive(live, 0, 1200); await live.finish(); await P.carry.idle();
    out.online = { ...span(P.posts), kept: P.carry.size() }; }

  // 1. no signal for the whole trip: nothing is sent, the unsent middle is kept; signal back, it all goes, once
  { const P = phone(); const live = P.live('d_carry_test_01'); await P.drive(live, 0, 1200); const st = await live.finish(); await P.carry.idle();
    const kept = [...P.store.m.values()][0];
    out.dead = { posts: P.posts.length, error: !!st.error, kept: P.carry.size(), rows: kept.rows.lat.length,
      firstLon: kept.rows.lon[0], lastLon: kept.rows.lon[kept.rows.lon.length - 1], lon200: row(200).lon, lon999: row(999).lon,
      waitingM: P.carry.waitingM(), text: M.phoneText(M.phoneSummary([], P.storage)), keysToClear: M.keysToClear(P.storage) };
    out.deadFlushOffline = { km: await P.carry.flush(), kept: P.carry.size(), matches: P.net.matches };
    P.net.up = true; P.t += 3600000;
    const km = await P.carry.flush();
    out.deadSent = { km, ...span(P.posts), kept: P.carry.size(), stored: P.store.m.size, index: P.storage.getItem(R.KEY), ids: [...new Set(P.posts.map((p) => p.drive_id))], days: [...new Set(P.posts.map((p) => p.driven_on))],
      keys: Object.keys(P.posts[0]).sort().join(), again: await P.carry.flush(), postsAfter: P.posts.length, postsBefore: P.posts.length }; }

  // 2. signal drops in the middle of a trip and comes back before its end: kept while it was gone, nothing kept after, nothing twice
  { const P = phone(); P.net.up = true; const live = P.live('d_carry_test_02');
    await P.drive(live, 0, 600); P.net.up = false; await P.drive(live, 600, 900); await P.carry.idle();
    const during = P.carry.size();
    P.net.up = true; P.t += 400000; await P.drive(live, 900, 1200); await live.finish(); await P.carry.idle();
    out.blip = { during, after: P.carry.size(), ...span(P.posts), flush: await P.carry.flush() }; }

  // 3. the app is closed mid-trip with no signal (no finish): the last failed try kept the rows; the next launch sends them
  { const P = phone(); const live = P.live('d_carry_test_03'); await P.drive(live, 0, 1200); await P.carry.idle();
    const kept = [...P.store.m.values()][0];
    P.make(); P.net.up = true;                                           // a new page over the same storage
    await P.carry.flush();
    out.killed = { keptRows: kept.rows.lat.length, ...span(P.posts), kept: P.carry.size() }; }

  // 4. going to the background checkpoints a trip under way; it is not flushed while it is being driven
  { const P = phone(); P.net.up = true; const live = P.live('d_carry_test_04'); await P.drive(live, 0, 650); await tick();
    const before = P.carry.size(); P.carry.checkpoint(); await P.carry.idle();
    const n0 = P.posts.length, held = P.carry.size();
    const flushed = await P.carry.flush();
    out.checkpoint = { before, held, flushed, postsDuring: P.posts.length - n0 };
    await P.drive(live, 650, 1200); await live.finish(); await P.carry.idle();
    out.checkpointEnd = { kept: P.carry.size(), ...span(P.posts) }; }

  // 5. a chunk that was built but not posted (the server was down) goes again as the same payload
  { const calls = []; let down = true;
    const P = phone(); P.post = async (c) => { calls.push(JSON.stringify(c)); if (down) return 'retry'; P.posts.push(c); return true; };
    P.net.up = true; const live = P.live('d_carry_test_05'); await P.drive(live, 0, 1200); await live.finish(); await P.carry.idle();
    const kept = [...P.store.m.values()][0], tried = calls.length;
    down = false; P.t += 3600000; await P.carry.flush();
    out.pending = { keptPending: kept.pending.length, same: calls[0] === calls[tried], ...span(P.posts), kept: P.carry.size() }; }

  // 6. a refusal (signed out, Road data off on the server) drops what was kept; with Road data off nothing is even matched
  { const P = phone(); const live = P.live('d_carry_test_06');
    await P.drive(live, 0, 1200); await live.finish(); await P.carry.idle();
    const kept = P.carry.size(); P.net.up = true; P.post = async () => 'stop'; await P.carry.flush();
    out.refused = { kept, after: P.carry.size(), stored: P.store.m.size }; }
  { const P = phone({ ready: async () => false }); const live = P.live('d_carry_test_07'); await P.drive(live, 0, 1200); await live.finish(); await P.carry.idle();
    P.net.up = true; const km = await P.carry.flush();
    out.notReady = { km, kept: P.carry.size(), matches: P.net.matches }; }
  { const P = phone(); out.nothingWaiting = { km: await P.carry.flush(), readyCalls: P.readyCalls }; }

  // 7. a long stretch goes up in pieces: signal lost again part way keeps only what is left
  { const P = phone(); const live = P.live('d_carry_test_08'); await P.drive(live, 0, 5400); await live.finish(); await P.carry.idle();   // 27 km, 25 km kept
    const rows0 = [...P.store.m.values()][0].rows.lat.length;
    P.net.up = true; P.net.failAfter = 1; await P.carry.flush();
    const rows1 = [...P.store.m.values()][0].rows.lat.length, sent1 = span(P.posts).n;
    P.net.failAfter = null; P.t += 3600000; await P.carry.flush();
    out.pieces = { rows0, rows1, sent1, maxMatch: Math.max(...P.net.sizes), ...span(P.posts), kept: P.carry.size() }; }

  // 8. too old for the server (14 days): dropped unsent. Over the cap: the oldest trip makes room
  { const P = phone(); const live = P.live('d_carry_test_09'); await P.drive(live, 0, 1200); await live.finish(); await P.carry.idle();
    P.t += 14 * 86400000; P.net.up = true; const km = await P.carry.flush();
    out.old = { km, kept: P.carry.size(), stored: P.store.m.size, posts: P.posts.length, matches: P.net.matches }; }
  { const P = phone({ maxRows: 1000 });
    for (const id of ['d_carry_test_10', 'd_carry_test_11']) { const live = P.live(id); await P.drive(live, 0, 1000); await live.finish(); await P.carry.idle(); P.t += 60000; }
    out.cap = { ids: [...P.store.m.keys()], index: Object.keys(JSON.parse(P.storage.getItem(R.KEY))) }; }

  // 9. Erase everything clears apex.* from localStorage and reloads: the kept rows go with it
  { const P = phone(); const live = P.live('d_carry_test_12'); await P.drive(live, 0, 1200); await live.finish(); await P.carry.idle();
    const before = P.store.m.size;
    for (const k of M.keysToClear(P.storage)) P.storage.removeItem(k);
    P.make(); await P.carry.idle(); P.net.up = true;
    out.erased = { before, stored: P.store.m.size, km: await P.carry.flush(), posts: P.posts.length }; }

  // 10. a trip too short to share keeps nothing; a stream without a carry behaves as before
  { const P = phone(); const live = P.live('d_carry_test_13'); await P.drive(live, 0, 380); await live.finish(); await P.carry.idle();
    out.short = { kept: P.carry.size(), stored: P.store.m.size }; }
  { const P = phone(); const live = P.live('d_carry_test_14', { carry: null }); await P.drive(live, 0, 1200); const st = await live.finish();
    out.noCarry = { error: !!st.error, left: live.leftover().rows.lat.length }; }
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    p = subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, timeout=180)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_a_trip_with_no_signal_is_kept_and_sent_later_as_an_online_trip_would_have_been(out):
    on, dead, sent = out["online"], out["dead"], out["deadSent"]
    assert on["kept"] == 0 and on["n"] == on["unique"] > 700
    assert dead["posts"] == 0 and dead["error"] and dead["kept"] == 1
    assert out["deadFlushOffline"] == {"km": 0, "kept": 1, "matches": 0}
    # the same sections of the same road as the trip with signal, each once, under the trip's own id and day
    assert (sent["n"], sent["unique"], sent["lo"], sent["hi"]) == (on["n"], on["unique"], on["lo"], on["hi"])
    assert sent["km"] == pytest.approx(on["n"] * 5 / 1000)
    assert sent["ids"] == ["d_carry_test_01"] and sent["days"] == ["2026-10-25"]
    assert sent["kept"] == 0 and sent["stored"] == 0 and sent["index"] is None
    assert sent["again"] == 0 and sent["postsAfter"] == sent["postsBefore"]      # a second flush sends nothing again


def test_what_is_kept_never_holds_the_first_or_last_km(out):
    dead = out["dead"]
    assert dead["rows"] == 800                                           # rows 200..999 of 1200: the private ends were never kept
    assert dead["firstLon"] == dead["lon200"] and dead["lastLon"] == dead["lon999"]
    assert out["killed"]["keptRows"] <= 800


def test_what_is_sent_later_is_bins_only(out):
    assert out["deadSent"]["keys"] == "bins,cam_v,cls,dir,drive_id,driven_on,rec,shape,way_id"   # as a live trip posts: no position, path, speed or time


def test_signal_back_before_the_end_keeps_nothing_and_sends_nothing_twice(out):
    b, on = out["blip"], out["online"]
    assert b["during"] == 1 and b["after"] == 0 and b["flush"] == 0
    assert b["n"] == b["unique"] == on["n"] and (b["lo"], b["hi"]) == (on["lo"], on["hi"])


def test_an_app_closed_mid_trip_without_signal_sends_what_it_kept_at_the_next_launch(out):
    k = out["killed"]
    assert k["keptRows"] >= 500 and k["n"] == k["unique"] >= 500 and k["kept"] == 0
    assert k["lo"] >= out["online"]["lo"] and k["hi"] <= out["online"]["hi"]


def test_a_trip_under_way_is_checkpointed_in_the_background_and_left_to_send_itself(out):
    c, e, on = out["checkpoint"], out["checkpointEnd"], out["online"]
    assert c == {"before": 0, "held": 1, "flushed": 0, "postsDuring": 0}
    assert e["kept"] == 0 and e["n"] == e["unique"] == on["n"]


def test_a_built_chunk_goes_again_as_the_same_payload(out):
    p, on = out["pending"], out["online"]
    assert p["keptPending"] >= 1 and p["same"] and p["kept"] == 0
    assert p["n"] == p["unique"] == on["n"]


def test_a_refusal_or_road_data_off_sends_nothing(out):
    assert out["refused"] == {"kept": 1, "after": 0, "stored": 0}
    assert out["notReady"] == {"km": 0, "kept": 1, "matches": 0}       # Road data off: no position goes to the map matcher either
    assert out["nothingWaiting"] == {"km": 0, "readyCalls": 0}           # nothing waiting: nothing is asked


def test_a_long_stretch_goes_in_pieces_and_a_second_dropout_costs_one_piece(out):
    p = out["pieces"]
    assert p["rows0"] == 5000 and 0 < p["rows1"] < p["rows0"] and p["sent1"] == p["rows0"] - p["rows1"]
    assert p["maxMatch"] <= 2100                                         # 10 km a try (and the matcher's context)
    assert p["n"] == p["unique"] == 5000 and p["kept"] == 0


def test_old_trips_expire_and_the_cap_drops_the_oldest(out):
    assert out["old"] == {"km": 0, "kept": 0, "stored": 0, "posts": 0, "matches": 0}
    assert out["cap"] == {"ids": ["d_carry_test_11"], "index": ["d_carry_test_11"]}


def test_erase_everything_removes_it(out):
    assert out["dead"]["keysToClear"] == ["apex.roadCarry"]
    assert out["erased"] == {"before": 1, "stored": 0, "km": 0, "posts": 0}


def test_your_data_says_what_waits(out):
    assert out["dead"]["waitingM"] == 4000
    assert "road data from 2.5 mi waiting for signal" in out["dead"]["text"]


def test_short_trips_and_streams_without_a_carry(out):
    assert out["short"] == {"kept": 0, "stored": 0}
    assert out["noCarry"] == {"error": True, "left": 800}


def test_the_page_loads_it_before_the_contributor_and_the_privacy_page_says_so():
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert html.index('<script src="road_carry.js" defer>') < html.index('<script src="contributor.js" defer>')
    src = (ROOT / "web" / "road_carry.js").read_text(encoding="utf-8")
    assert "root.APEX_REVIEW" in src and "contributionEnabled()" in src
    privacy = (ROOT / "web" / "privacy.html").read_text(encoding="utf-8")
    assert "wait on the phone" in privacy and "13 days" in privacy


# ---- what the upload says, and a drive begun with no signal (web/sync.js) -------------------------------------------------
SHARE = r"""
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
let net = { status: 200, body: { signed_in: true, member: true, contribute: true } };   // /api/me
const posted = [];
globalThis.fetch = async (url, init) => {
  if (init && init.method === 'POST') { posted.push(JSON.parse(init.body)); return { ok: true, status: 202, json: async () => ({}) }; }
  if (!net) throw new TypeError('Load failed');
  return { ok: net.status === 200, status: net.status, json: async () => net.body };
};
const S = require(process.argv[1] + '/web/sync.js'), R = require(process.argv[1] + '/web/road_carry.js');
(async () => {
  const out = {};
  out.signedOutNoSignal = await (async () => { const was = net; net = null; const r = await S.roadShare(); net = was; return r; })();
  S.setSession('tok_test');
  out.on = await S.roadShare();
  net = null; out.remembered = await S.roadShare();
  net = { status: 200, body: { signed_in: true, member: true, contribute: false } }; out.off = await S.roadShare();
  net = null; out.offRemembered = await S.roadShare();
  net = { status: 200, body: { signed_in: true, member: false } }; out.notMember = await S.roadShare();
  net = { status: 200, body: { signed_in: true, member: true, contribute: true } }; await S.roadShare();
  net = { status: 401, body: {} }; out.signedOut = await S.roadShare();
  net = null; out.afterSignedOut = await S.roadShare();
  const c = { way_id: 77, dir: 0, driven_on: '2026-11-09', drive_id: 'd_payload_02', bins: [{ i: 1, rough: 0.1 }], shape: null, cls: 'secondary', cam_v: 2 };
  await S.contribute({ ...c, rec: 1, hr: 7 }); await S.contribute({ ...c, rec: 0 }); await S.contribute({ ...c, rec: 1, hr: null });
  out.posted = posted.map((b) => ({ rec: b.rec ?? null, hr: b.hr ?? null, hasRec: 'rec' in b, hasHr: 'hr' in b }));
  // a trip whose map matching worked but whose uploads didn't leaves built chunks and few rows: Your data counts those too
  { const m = new Map(), st = { keys: async () => [...m.keys()], get: async (id) => m.get(id), put: async (id, v) => { m.set(id, v); }, del: async (id) => { m.delete(id); }, clear: async () => { m.clear(); } };
    const carry = R.createCarry({ store: st, storage: globalThis.localStorage, resume: async () => ({ km: 0, stopped: false, left: null }) });
    carry.hold({ driveId: 'd_chunks_only_01', drivenOn: '2026-11-09', rows: { lat: [1, 2], lon: [1, 2] }, pending: [{ bins: Array.from({ length: 398 }, (_, i) => ({ i })) }] }, true);
    await carry.idle(); out.waitingM = carry.waitingM(); await carry.clear(); await carry.idle(); out.afterClear = carry.waitingM(); }
  out.itemM = [R.itemM(null), R.itemM({ rows: { lat: [1, 2, 3] }, pending: [] }), R.itemM({ rows: { lat: [] }, pending: [{ bins: [1, 2] }, { bins: [3] }] })];
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def share():
    p = subprocess.run([NODE, "-e", SHARE, str(ROOT)], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_the_upload_says_a_recorded_drive_is_one(share):
    """contributor.js built `rec` (and `hr` under the quiet_hours flag), the server read them and the privacy page described
    them, but sync.js sent neither: no road was ever counted as loved (backend contribute.ts `again: c.rec`)."""
    assert share["posted"] == [{"rec": 1, "hr": 7, "hasRec": True, "hasHr": True}, {"rec": None, "hr": None, "hasRec": False, "hasHr": False},
                               {"rec": 1, "hr": None, "hasRec": True, "hasHr": False}]


def test_a_drive_begun_with_no_signal_shares_on_the_last_answer_only_while_signed_in(share):
    """startLiveSharing asked the server before it shared, so a drive begun where there is no signal never shared and had
    nothing to carry. roadShare() remembers the last answer; what is measured on it waits, and is sent only once the server
    says Road data is still on (road_carry.js ready())."""
    assert share["signedOutNoSignal"] == {"on": False, "known": False, "member": False}
    assert share["on"] == {"on": True, "known": True, "member": True}
    assert share["remembered"] == {"on": True, "known": False, "member": True}
    assert share["off"] == {"on": False, "known": True, "member": True} and share["offRemembered"]["on"] is False
    assert share["notMember"] == {"on": False, "known": True, "member": False}
    assert share["signedOut"] == {"on": False, "known": True, "member": False} and share["afterSignedOut"]["on"] is False


def test_the_page_empties_it_on_sign_out_and_says_what_waits(share):
    assert share["itemM"] == [0, 15, 15]
    assert share["waitingM"] == 2000 and share["afterClear"] == 0          # 2 rows + 398 built bins, 5 m each
    js = (ROOT / "web" / "cockpit.js").read_text(encoding="utf-8")
    # Road data switched off (both switches), both Sign outs, the account deleted: emptied at once
    assert js.count("clearCarry()") == 6 and "if (!on) clearCarry();" in js and "if (contribOn && r && r.ok) clearCarry();" in js
    assert js.count("ApexSync.setSession(null); clearCarry();") == 4
    assert "const sh = await ApexSync.roadShare();" in js and "await ApexSync.member())) return;\n        if (!(await ApexSync.contributionEnabled()))" not in js
    assert "ApexRoadCarry.onPost = (r) => health.bump(" in js and "more waits for signal." in js
    carry = (ROOT / "web" / "road_carry.js").read_text(encoding="utf-8")
    assert "!!(await sync().member()) && !!(await sync().contributionEnabled())" in carry, "a remembered yes never sends: the server is asked first"


def test_road_share_reads_api_me_not_the_whole_export():
    """The Share road feel flag comes from /api/me; the export reads every table of the account (rows read on D1 Free)."""
    src = (ROOT / "web/sync.js").read_text()
    assert "/api/me/export" not in src
