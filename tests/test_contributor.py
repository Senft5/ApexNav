"""Phone-side contributor (web/contributor.js): drive + way geometry -> bin summaries. Synthetic roads in the test only, never shipped."""
import json
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const C = require(process.argv[1] + '/web/contributor.js');
const lat0 = 35.0, lon0 = -83.0, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
// A straight east-west way of 6 km starting at lon0 (way node order = west to east).
const way = [[lat0, lon0], [lat0, lon0 + 6000 / mLon]];
const drive = (n, rev = false) => {
  const lat = [], lon = [];
  for (let i = 0; i < n; i++) { const x = (rev ? n - 1 - i : i) * 5; lat.push(lat0 + 3 / 110540); lon.push(lon0 + x / mLon); }
  return { lat, lon, camber: lat.map((_, i) => (i % 7 === 0 ? null : 4)), rough: lat.map(() => 0.2), crest: lat.map((_, i) => 0.1 + (i % 10) / 100), kappa: lat.map(() => 0.01) };
};
const run = (d, m, w = { 77: way }, extra = {}) => C.buildContributions({ drive: d, match: m, ways: w, drivenOn: '2026-10-20', driveId: 'drive_test_0001', ...extra });
const out = {};
const d = drive(1000);                                           // 5 km drive on a 6 km way
const m = d.lat.map(() => ({ way: 77, cls: 'tertiary' }));
const a = run(d, m);
out.fwd = a.map((c) => ({ way: c.way_id, dir: c.dir, bins: c.bins.length, first: c.bins[0].i, cams: [...new Set(c.bins.map((b) => b.cam))].sort() }));
const r = run(drive(1000, true), m);
out.rev = r.map((c) => ({ dir: c.dir, first: c.bins[0].i, last: c.bins[c.bins.length - 1].i }));
out.skipped = run(d, d.lat.map(() => ({ way: 77, cls: 'residential' }))).length;
out.unmatched = run(d, d.lat.map(() => null)).length;
out.noGeom = run(d, m, {}).length;
out.short = run(drive(300), drive(300).lat.map(() => ({ way: 77, cls: 'tertiary' })), { 77: way }, { trimM: 100 }).length;   // 100 samples inside trim -> 100-40 = 60 bins is ok
out.trimmed = a[0].bins.length;
out.offRoad = run({ ...d, lat: d.lat.map((v) => v + 200 / 110540) }, m).length;
out.noRough = run({ ...d, rough: d.rough.map(() => null) }, m).length;
out.eligible = [C.eligible({ rough: [1], kappa: [1], date: '2026-10-20T10:00' }, Date.parse('2026-10-25')), C.eligible({ rough: [1], kappa: [1], date: '2026-09-01T10:00' }, Date.parse('2026-10-25')), C.eligible({ date: '2026-10-24' }, Date.parse('2026-10-25'))];
out.driveIds = [C.driveIdFor({ id: 'rec_Dry Ridge.csv', date: '2026-10-22T09:00' }), C.driveIdFor({ id: 'rec_Dry Ridge.csv', date: '2026-10-22T09:00' }), C.driveIdFor({ id: 'x', date: '' })];
// payload contains only the allowed keys
out.keys = Object.keys(a[0]).sort().join() + '|' + Object.keys(a[0].bins[0]).sort().join();
// network shell with a fake fetch: Valhalla trace_attributes + Overpass, then upload
out.adjust = [C.measuredAdjust(null), C.measuredAdjust({ roughness: null, coverage: 1 }), C.measuredAdjust({ roughness: 0.05, coverage: 1 }), C.measuredAdjust({ roughness: 0.6, coverage: 1 }), C.measuredAdjust({ roughness: 0.6, coverage: 0.1 }), C.measuredAdjust({ roughness: 0.23, coverage: 0.5 })];
(async () => {
  // measured data along a route: way 77 direction 0 has bins 200..399 merged from 3 passes, one banked stretch, one unmeasured-camber stretch
  const roads = { 77: { 0: { i: Array.from({ length: 200 }, (_, j) => 200 + j), n: Array(200).fill(3), cam: Array.from({ length: 200 }, (_, j) => (j < 40 ? 5 : j < 60 ? null : 1)), rough: Array(200).fill(0.1), crest: Array(200).fill(0.2) } } };
  const rt = drive(1000), rm = rt.lat.map(() => ({ way: 77, cls: 'tertiary' }));
  out.measured = C.summarize(C.locate({ drive: rt, match: rm, ways: { 77: way } }), roads, 1000);
  out.unknownRoad = C.summarize(C.locate({ drive: rt, match: rm, ways: { 77: way } }), {}, 1000);
  out.reverseRoute = C.summarize(C.locate({ drive: drive(1000, true), match: rm, ways: { 77: way } }), roads, 1000);
  const fk = async (url, init) => url.includes('trace_attributes')
    ? { ok: true, json: async () => ({ edges: [{ way_id: 77, road_class: 'tertiary' }], matched_points: JSON.parse(init.body).shape.map(() => ({ type: 'matched', edge_index: 0 })) }) }
    : { ok: true, json: async () => ({ elements: [{ type: 'way', id: 77, geometry: way.map(([la, lo]) => ({ lat: la, lon: lo })) }] }) };
  const viaNet = await C.measuredAlong(rt, async (ids) => { out.lookupIds = ids; return roads; }, { fetch: fk });
  out.series = (() => { const s = C.seriesFrom(C.locate({ drive: rt, match: rm, ways: { 77: way } }), roads, 1000); return { len: s.cam.length, known: s.cam.filter((v) => v != null).length, unknownRough: s.rough.filter((v) => v == null).length, first: s.cam.findIndex((v) => v != null), n: s.n.find((v) => v != null) }; })();
  out.viaNetwork = viaNet && { coveredKm: Math.round(viaNet.coveredKm * 100) / 100, banked: viaNet.bankedKm };
  out.signedOut = await C.measuredAlong(rt, async () => null, { fetch: fk });
  const calls = [];
  const fake = async (url, init) => {
    calls.push(url);
    if (url.includes('trace_attributes')) {
      const shape = JSON.parse(init.body).shape;
      return { ok: true, json: async () => ({ edges: [{ way_id: 77, road_class: 'tertiary' }], matched_points: shape.map(() => ({ type: 'matched', edge_index: 0 })) }) };
    }
    return { ok: true, json: async () => ({ elements: [{ type: 'way', id: 77, geometry: way.map(([la, lo]) => ({ lat: la, lon: lo })) }] }) };
  };
  const posted = [];
  const dd = { ...drive(1000), date: '2026-10-22T09:00' };
  const res = await C.contributeDrive(dd, async (c) => { posted.push(c); return true; }, { fetch: fake, now: Date.parse('2026-10-25') });
  out.shell = { res, posted: posted.length, keys: Object.keys(posted[0]).sort().join(), valhalla: calls.filter((u) => u.includes('trace_attributes')).length, overpass: calls.filter((u) => u.includes('overpass')).length };
  const stopped = await C.contributeDrive(dd, async () => 'stop', { fetch: fake, now: Date.parse('2026-10-25') });
  out.stopped = stopped;
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def result():
    root = str(__import__("pathlib").Path(__file__).resolve().parents[1])
    p = subprocess.run([NODE, "-e", RUNNER, root], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_forward_drive_bins_from_way_start(result):
    (c,) = result["fwd"]
    assert c["way"] == 77 and c["dir"] == 0
    assert abs(c["first"] - 200) <= 1                       # 1 km trimmed from the start, bins count from the way's first node
    assert result["trimmed"] == 600                # 1000 samples - 2 * 200 trimmed
    assert c["cams"] == [4, None]   # unknown camber stays null, never filled in


def test_reverse_drive_is_other_direction(result):
    (c,) = result["rev"]
    assert c["dir"] == 1 and c["first"] < c["last"]


def test_private_roads_unmatched_and_missing_geometry_are_skipped(result):
    assert result["skipped"] == 0 and result["unmatched"] == 0 and result["noGeom"] == 0


def test_off_road_and_unknown_roughness_are_not_invented(result):
    assert result["offRoad"] == 0 and result["noRough"] == 0


def test_short_drive_after_trim(result):
    assert result["short"] == 1


def test_eligibility_window(result):
    assert result["eligible"] == [True, False, False]


def test_payload_has_no_coordinates_or_times(result):
    assert result["keys"] == "bins,dir,drive_id,driven_on,way_id|cam,crest,i,k,rough"


def test_network_shell_matches_fetches_and_uploads_bins_only(result):
    sh = result["shell"]
    assert sh["res"] == {"built": 1, "sent": 1} and sh["posted"] == 1
    assert sh["valhalla"] == 1 and sh["overpass"] == 1
    assert sh["keys"] == "bins,dir,drive_id,driven_on,way_id"


def test_server_refusal_stops_uploading(result):
    assert result["stopped"] == {"built": 1, "sent": 0}


def test_measured_along_route_reports_coverage_and_never_zero_fills(result):
    m = result["measured"]
    assert m["coveredKm"] == pytest.approx(1.0, abs=0.02) and m["roughness"] == pytest.approx(0.1)
    assert m["avgPasses"] == 3 and m["bankedKm"] == pytest.approx(0.2, abs=0.02)
    u = result["unknownRoad"]
    assert u["coveredKm"] == 0 and u["roughness"] is None and u["avgPasses"] is None      # nothing measured -> unknown, not zero


def test_measured_is_per_direction_and_network_path(result):
    assert result["reverseRoute"]["coveredKm"] == 0                  # data is for the other direction
    assert result["lookupIds"] == [77] and result["viaNetwork"]["coveredKm"] > 0.9
    assert result["signedOut"] is None


def test_measured_adjustment_is_gentle_and_never_rewards_or_punishes_the_unknown(result):
    none, unknown_rough, smooth, rough_full, rough_little, mid = result["adjust"]
    assert none == 0 and unknown_rough == 0 and smooth == 0
    assert rough_full == pytest.approx(-6) and -6 < rough_little < 0 and mid == pytest.approx(-3)


def test_series_marks_unmeasured_samples_null(result):
    s = result["series"]
    assert s["len"] == 1000
    assert s["known"] == 180                                      # bins 200..399 measured, but camber is unknown for 20 of them
    assert s["unknownRough"] == 800                               # roughness known for exactly the 200 measured bins
    assert s["n"] == 3 and 195 <= s["first"] <= 205


def test_drive_id_is_stable_and_valid(result):
    ids = result["driveIds"]
    assert ids[0] == ids[1] and ids[0] != ids[2]
    import re
    assert all(re.fullmatch(r"[A-Za-z0-9_-]{8,64}", i) for i in ids)


LIVE = r"""
const C = require(process.argv[1] + '/web/contributor.js');
const Core = require(process.argv[1] + '/web/apex_core.js');
const lat0 = 35.0, lon0 = -83.0, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
const way = [[lat0, lon0], [lat0, lon0 + 12000 / mLon]];              // a 12 km straight way
const N = 1200;                                                       // 6 km driven = 1200 rows of 5 m
const row = (i) => ({ lat: lat0 + 3 / 110540, lon: lon0 + (i * 5) / mLon, roughness_rms: 0.1 });
const fake = (state) => async (url, init) => {
  if (url.includes('trace_attributes')) {
    if (state.failTimes > 0) { state.failTimes--; return { ok: false, status: 429, json: async () => ({}) }; }
    const sh = JSON.parse(init.body).shape; state.matches++;
    return { ok: true, json: async () => ({ edges: [{ way_id: 77, road_class: 'tertiary' }], matched_points: sh.map(() => ({ type: 'matched', edge_index: 0 })) }) };
  }
  state.overpass++;
  return { ok: true, json: async () => ({ elements: [{ type: 'way', id: 77, geometry: way.map(([la, lo]) => ({ lat: la, lon: lo })) }] }) };
};
const out = {};
(async () => {
  // 1. normal streaming drive
  { const st = { matches: 0, overpass: 0, failTimes: 0 }, posts = [], statuses = [];
    const live = C.createLive({ Core, fetch: fake(st), driveId: 'd_live_test_01', drivenOn: '2026-10-25', post: async (c) => { posts.push(c); return true; }, onStatus: (s) => statuses.push(s.state) });
    for (let i = 0; i < N; i++) { live.push(row(i)); if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0)); }
    const stats = await live.finish();
    const bins = posts.flatMap((p) => p.bins.map((b) => b.i)), lo = Math.min(...bins), hi = Math.max(...bins);
    out.normal = { posts: posts.length, lo, hi, n: bins.length, unique: new Set(bins).size, overpass: st.overpass, ids: [...new Set(posts.map((p) => p.drive_id))], crest: [...new Set(posts.flatMap((p) => p.bins.map((b) => b.crest)))], keys: Object.keys(posts[0]).sort().join(), km: stats.km, firstState: statuses[0] }; }
  // 2. failures are retried, rows are not lost
  { const st = { matches: 0, overpass: 0, failTimes: 1 }, posts = []; let t = 0;
    const live = C.createLive({ Core, fetch: fake(st), driveId: 'd_live_test_02', drivenOn: '2026-10-25', retryMs: 1000, now: () => t, post: async (c) => { posts.push(c); return true; } });
    for (let i = 0; i < N; i++) live.push(row(i));
    await live.finish(); out.afterFail = { posts: posts.length, error: !!live.stats().error };
    t += 2000; live.push(row(N)); await live.finish(); out.afterRetry = { posts: posts.length, error: !!live.stats().error }; }
  // 3. the server refusing stops everything
  { const st = { matches: 0, overpass: 0, failTimes: 0 }; let calls = 0;
    const live = C.createLive({ Core, fetch: fake(st), driveId: 'd_live_test_03', drivenOn: '2026-10-25', post: async () => { calls++; return 'stop'; } });
    for (let i = 0; i < N; i++) live.push(row(i));
    await live.finish(); out.stopped = { stopped: live.stats().stopped, calls }; }
  // 4. a short drive sends nothing at all
  { const st = { matches: 0, overpass: 0, failTimes: 0 }, posts = [];
    const live = C.createLive({ Core, fetch: fake(st), driveId: 'd_live_test_04', drivenOn: '2026-10-25', post: async (c) => { posts.push(c); return true; } });
    for (let i = 0; i < 380; i++) live.push(row(i));          // 1.9 km: first km and last km stay private, only 0 rows remain
    await live.finish(); out.short = { posts: posts.length, matches: st.matches }; }
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def live():
    root = str(__import__("pathlib").Path(__file__).resolve().parents[1])
    p = subprocess.run([NODE, "-e", LIVE, root], capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_live_never_sends_first_or_last_km(live):
    n = live["normal"]
    assert n["lo"] >= 200 - 1 and n["hi"] <= 1200 - 200 + 1          # rows 0-199 and the last 200 rows never leave the phone
    assert n["n"] == n["unique"] and n["n"] >= 780                    # about 800 settled rows, none sent twice
    assert n["ids"] == ["d_live_test_01"] and n["keys"] == "bins,dir,drive_id,driven_on,way_id"
    assert n["overpass"] == 1 and n["firstState"] == "on"             # way geometry fetched once, then cached


def test_live_unknown_crest_is_null_not_zero(live):
    assert live["normal"]["crest"] == [None]


def test_live_retries_after_a_failed_match(live):
    assert live["afterFail"] == {"posts": 0, "error": True}
    assert live["afterRetry"]["posts"] >= 1 and live["afterRetry"]["error"] is False


def test_live_stops_when_the_server_refuses(live):
    assert live["stopped"]["stopped"] is True and live["stopped"]["calls"] == 1


def test_live_short_drive_sends_nothing(live):
    assert live["short"] == {"posts": 0, "matches": 0}
