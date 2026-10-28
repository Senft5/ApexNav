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
// crest: signed vertical g in, peak unweighting out (0 when the bin never went light, capped at 3 g)
out.crest = [0.1, -0.12, -4].map((v) => run({ ...d, crest: d.lat.map(() => v) }, m)[0].bins[5].crest);
out.offRoad = run({ ...d, lat: d.lat.map((v) => v + 200 / 110540) }, m).length;
out.noRough = run({ ...d, rough: d.rough.map(() => null) }, m).length;
out.unknownCurvature = [undefined, d.kappa.map(() => null), d.kappa.map(() => NaN), d.kappa.map(() => 0.5)]
  .map(kappa => run({ ...d, kappa }, m).flatMap(chunk => chunk.bins.map(bin => bin.k)));
out.zeroCurvature = run({ ...d, kappa: d.kappa.map(() => 0) }, m).flatMap(chunk => chunk.bins.map(bin => bin.k));
out.eligible = [C.eligible({ rough: [1], kappa: [1], date: '2026-10-20T10:00' }, Date.parse('2026-10-25')), C.eligible({ rough: [1], kappa: [1], date: '2026-09-01T10:00' }, Date.parse('2026-10-25')), C.eligible({ date: '2026-10-24' }, Date.parse('2026-10-25'))];
out.driveIds = [C.driveIdFor({ id: 'rec_Dry Ridge.csv', date: '2026-10-22T09:00' }), C.driveIdFor({ id: 'rec_Dry Ridge.csv', date: '2026-10-22T09:00' }), C.driveIdFor({ id: 'x', date: '' })];
// payload contains only the allowed keys
out.keys = Object.keys(a[0]).sort().join() + '|' + Object.keys(a[0].bins[0]).sort().join();
// network shell with a fake fetch: Valhalla trace_attributes + Overpass, then upload
out.adjust2 = { onePass: C.measuredAdjust({ roughness: 0.6, coverage: 1, avgPasses: 1 }), banked: C.measuredAdjust({ roughness: null, coverage: 1, km: 10, bankedKm: 1, avgPasses: 3 }),
  bankedLittle: C.measuredAdjust({ roughness: null, coverage: 1, km: 10, bankedKm: 0.5, avgPasses: 2 }), zeroCoverage: C.measuredAdjust({ roughness: 0.6, coverage: 0, km: 10, bankedKm: 1 }) };
out.surface = [C.surfaceScore(null), C.surfaceScore({ roughness: 0.05, coverage: 0.1 }), C.surfaceScore({ roughness: 0.05, coverage: 0.5 }), C.surfaceScore({ roughness: 0.5, coverage: 1 }), C.surfaceScore({ roughness: 0.23, coverage: 1 })];
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
  // a route over 125 ways: three lookups of at most 50; one signed-out batch makes the whole answer unknown
  const many = rt.lat.map((_, i) => ({ way: 1000 + Math.floor(i / 8), cls: 'tertiary' }));
  const fkMany = async (url, init) => url.includes('trace_attributes')
    ? { ok: true, json: async () => ({ edges: Array.from({ length: 125 }, (_, k) => ({ way_id: 1000 + k, road_class: 'tertiary' })), matched_points: JSON.parse(init.body).shape.map((_, k) => ({ type: 'matched', edge_index: Math.floor(k / 8) })) }) }
    : { ok: true, json: async () => ({ elements: [] }) };
  out.batches = [];
  await C.measuredAlong(rt, async (ids) => { out.batches.push(ids.length); return {}; }, { fetch: fkMany });
  let nth = 0;
  out.batchSignedOut = await C.measuredAlong(rt, async () => (++nth === 2 ? null : {}), { fetch: fkMany });
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


def test_measured_adjustment_moves_routes_but_never_rewards_or_punishes_the_unknown(result):
    none, unknown_rough, smooth, rough_full, rough_little, mid = result["adjust"]
    assert none == 0 and unknown_rough == 0
    assert smooth == pytest.approx(3), "measured smooth pavement is worth up to 3"
    assert rough_full == pytest.approx(-8) and -8 < rough_little < 0 and mid == pytest.approx(-4)
    a = result["adjust2"]
    assert a["onePass"] == pytest.approx(-6), "one pass counts three quarters"
    assert a["banked"] == pytest.approx(2) and a["bankedLittle"] == pytest.approx(1)
    assert a["zeroCoverage"] == 0
    assert result["surface"] == [None, None, 100, 0, 50]


def test_long_routes_look_up_ways_in_batches(result):
    assert result["batches"] == [50, 50, 25]
    assert result["batchSignedOut"] is None


def test_series_marks_unmeasured_samples_null(result):
    s = result["series"]
    assert s["len"] == 1000
    assert s["known"] == 180                                      # bins 200..399 measured, but camber is unknown for 20 of them
    assert s["unknownRough"] == 800                               # roughness known for exactly the 200 measured bins
    assert s["n"] == 3 and 195 <= s["first"] <= 205


def test_crest_bins_carry_the_peak_unweighting(result):
    assert result["crest"] == [0, 0.12, 3]


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
  // 5. a network blip or server error keeps the chunk and resends the same payload; sharing never stops
  { const st = { matches: 0, overpass: 0, failTimes: 0 }, calls = [], ok = []; let t = 0, blips = 2;
    const live = C.createLive({ Core, fetch: fake(st), driveId: 'd_live_test_05', drivenOn: '2026-10-25', retryMs: 1000, now: () => t,
      post: async (c) => { calls.push(JSON.stringify(c)); if (blips-- > 0) return 'retry'; ok.push(c); return true; } });
    for (let i = 0; i < N; i++) { live.push(row(i)); if (i % 50 === 0) { await new Promise((r) => setTimeout(r, 0)); t += 1500; } }
    const stats = await live.finish(), bins = ok.flatMap((p) => p.bins.map((b) => b.i));
    out.blip = { stopped: stats.stopped, resentSame: calls[0] === calls[1] && calls[1] === calls[2], n: bins.length, unique: new Set(bins).size, pending: stats.pending, error: stats.error }; }
  // 6. a road change next to a chunk edge loses no road piece (old code dropped the 15-row piece on either side of the edge at row 700)
  for (const split of [685, 715]) {
    const S = split * 5, ways = { 77: [[lat0, lon0], [lat0, lon0 + S / mLon]], 78: [[lat0, lon0 + S / mLon], [lat0, lon0 + 12000 / mLon]] };
    const two = async (url, init) => {
      if (url.includes('trace_attributes')) {
        const sh = JSON.parse(init.body).shape;
        return { ok: true, json: async () => ({ edges: [{ way_id: 77, road_class: 'tertiary' }, { way_id: 78, road_class: 'tertiary' }],
          matched_points: sh.map((p) => ({ type: 'matched', edge_index: (p.lon - lon0) * mLon < S ? 0 : 1 })) }) };
      }
      return { ok: true, json: async () => ({ elements: Object.entries(ways).map(([id, g]) => ({ type: 'way', id: +id, geometry: g.map(([la, lo]) => ({ lat: la, lon: lo })) })) }) };
    };
    const posts = [];
    const live = C.createLive({ Core, fetch: two, driveId: 'd_live_test_06', drivenOn: '2026-10-25', post: async (c) => { posts.push(c); return true; } });
    for (let i = 0; i < N; i++) { live.push(row(i)); if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0)); }
    await live.finish();
    const keys = posts.flatMap((p) => p.bins.map((b) => p.way_id + ':' + b.i)), on = (w) => posts.filter((p) => p.way_id === w).flatMap((p) => p.bins.map((b) => b.i));
    out['split' + split] = { n: keys.length, unique: new Set(keys).size, max77: Math.max(...on(77)), min78: Math.min(...on(78)) };
  }
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


def test_unknown_curvature_is_null_and_known_zero_stays_zero(result):
    for bins in result["unknownCurvature"]:
        assert bins
        assert all(value is None for value in bins)
    assert result["zeroCurvature"]
    assert all(value == 0 for value in result["zeroCurvature"])


def test_live_network_blip_resends_instead_of_stopping(live):
    b = live["blip"]
    assert b["stopped"] is False and b["error"] is None and b["pending"] == 0
    assert b["resentSame"]                                            # the failed chunk went out again unchanged (the server merges it once)
    assert b["n"] == b["unique"] and b["n"] >= 780                    # nothing lost, nothing sent twice


@pytest.mark.parametrize("split", [685, 715])
def test_live_road_change_at_a_chunk_edge_loses_nothing(live, split):
    s = live[f"split{split}"]
    assert s["n"] == s["unique"] and s["n"] >= 780
    assert s["max77"] >= split - 2 and s["min78"] <= 2                # both roads are sent right up to where they meet


def test_live_unknown_crest_is_null_not_zero(live):
    assert live["normal"]["crest"] == [None]


def test_live_retries_after_a_failed_match(live):
    assert live["afterFail"] == {"posts": 0, "error": True}
    assert live["afterRetry"]["posts"] >= 1 and live["afterRetry"]["error"] is False


def test_live_stops_when_the_server_refuses(live):
    assert live["stopped"]["stopped"] is True and live["stopped"]["calls"] == 1


def test_live_short_drive_sends_nothing(live):
    assert live["short"] == {"posts": 0, "matches": 0}


AMBIENT = r"""
const C = require(process.argv[1] + '/web/contributor.js');
const S = require(process.argv[1] + '/web/sensors.js');
const lat0 = 35.0, lon0 = -83.0, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
function harness(opts = {}) {
  let t = 0; const lives = [];
  const amb = C.createAmbient({
    now: () => t,
    makeRecorder: () => new S.Recorder(),
    makeLive: () => {
      const L = { rows: 0, finished: false, refuse: !!opts.refuse,
        push() { L.rows++; }, stats: () => ({ km: L.rows * 0.005, stopped: L.refuse && L.rows > 5, error: null }),
        finish: async () => { L.finished = true; return { km: L.rows * 0.005, stopped: L.refuse }; } };
      lives.push(L); return L;
    },
  });
  let x = 0;
  const drive = (secs, { speed = 20, calibration = 'locked', jump = 0 } = {}) => {
    x += jump;
    for (let i = 0; i < secs * 10; i++) {
      t += 100; x += speed * 0.1;
      amb.frame({ has_fix: true, lat: lat0, lon: lon0 + x / mLon, speed_mps: speed, calibration, roughness_rms: 0.1, camber_deg: 2, crest_vertical_g: -0.1 });
    }
  };
  const pause = (secs) => { t += secs * 1000; };
  return { amb, lives, drive, pause };
}
const out = {};
(async () => {
  { const h = harness(); h.drive(30, { calibration: 'default' }); out.unlocked = h.lives.length; }
  { const h = harness(); h.drive(30); out.locked = { trips: h.lives.length, rows: h.lives[0].rows, active: h.amb.stats().active }; }
  { const h = harness(); h.drive(20); h.pause(30); h.drive(20); await new Promise((r) => setTimeout(r, 0));
    out.gap = { trips: h.lives.length, firstFinished: h.lives[0].finished }; }
  { const h = harness(); h.drive(20); h.drive(200, { speed: 0 }); h.drive(20); await new Promise((r) => setTimeout(r, 0));
    out.stop = { trips: h.lives.length, firstFinished: h.lives[0].finished }; }
  { const h = harness(); h.drive(10); h.drive(10, { jump: 2000 }); out.jump = h.lives.length; }
  { const h = harness(); h.drive(10); h.drive(5, { calibration: 'default' }); h.drive(10); out.relock = h.lives.length; }
  { const h = harness({ refuse: true }); h.drive(30); await new Promise((r) => setTimeout(r, 0)); h.drive(30); out.refused = { trips: h.lives.length, paused: h.amb.stats().paused }; }
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def ambient():
    root = str(__import__("pathlib").Path(__file__).resolve().parents[1])
    p = subprocess.run([NODE, "-e", AMBIENT, root], capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_ambient_shares_only_with_a_mounted_phone(ambient):
    assert ambient["unlocked"] == 0                                    # not calibrated: nothing is recorded or sent
    assert ambient["locked"]["trips"] == 1 and ambient["locked"]["rows"] >= 100 and ambient["locked"]["active"]


def test_ambient_cuts_trips_so_each_keeps_its_ends_private(ambient):
    assert ambient["gap"] == {"trips": 2, "firstFinished": True}       # app in the background
    assert ambient["stop"] == {"trips": 2, "firstFinished": True}      # parked for minutes
    assert ambient["jump"] == 2                                        # position jump
    assert ambient["relock"] == 2                                      # remounted


def test_ambient_pauses_after_a_refusal(ambient):
    assert ambient["refused"] == {"trips": 1, "paused": True}
