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
  return { lat, lon, camber: lat.map((_, i) => (i % 7 === 0 ? null : 4)), rough: lat.map(() => 0.2), crest: lat.map((_, i) => 0.1 + (i % 10) / 100), kappa: lat.map(() => 0.01), cam_v: C.CAM_V };
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
out.shape = JSON.stringify(a[0].shape) === JSON.stringify(way.map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]));   // the way's map line, not the drive's points (3 m off it)
out.keys = Object.keys(a[0]).sort().join() + '|' + Object.keys(a[0].bins[0]).sort().join();
out.cls = a[0].cls;
// a drive recorded before the camber fix (no cam_v): its placeholder camber is never sent; everything else is
{ const { cam_v, ...old } = d; const o = run({ ...old, camber: d.camber.map(() => 0) }, m)[0];
  out.oldDrive = { camV: o.cam_v, cams: [...new Set(o.bins.map((b) => b.cam))], rough: [...new Set(o.bins.map((b) => b.rough))], bins: o.bins.length, newCamV: a[0].cam_v }; }
// a 10 km twisty way (corners of 15-75 m radius every 5 m, straights with end nodes only): the line sent keeps its length
{ let seed = 1, x = 0, y = 0, h = 0, total = 0, sign = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pts = [[0, 0]];
  while (total < 10000) {
    const L = rnd() * 60; x += L * Math.cos(h); y += L * Math.sin(h); total += L; pts.push([x, y]);
    const R = 15 + rnd() * 60, A = (30 + rnd() * 150) * Math.PI / 180, st = 5 / R; sign = rnd() < 0.8 ? -sign : sign;
    for (let q = st; q <= A; q += st) { h += sign * st; x += 5 * Math.cos(h); y += 5 * Math.sin(h); total += 5; pts.push([x, y]); }
  }
  const poly = pts.map(([px, py]) => [lat0 + py / 110540, lon0 + px / mLon]), cum = C.cumulative(poly), sh = C.shapeOf(poly), cs = C.cumulative(sh);
  out.twisty = { nodes: poly.length, sent: sh.length, kept: cs[cs.length - 1] / cum[cum.length - 1], ends: JSON.stringify([sh[0], sh[sh.length - 1]]) === JSON.stringify([poly[0], poly[poly.length - 1]].map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)])) }; }
// bump flags (IDEAS Q-02): a spike over clean road is 1 in its bin, the rest 0; no core, no peaks or walking pace: unknown
{ const Core = require(process.argv[1] + '/web/apex_core.js');
  const rough = d.lat.map(() => 0.03), vpeak = d.lat.map((_, i) => (i === 500 ? 0.9 : 0.1));
  const bins = (extra) => run({ ...d, rough, vpeak, ...extra }, m, { 77: way }, { Core })[0].bins;
  const b = bins({}), hit = b.filter((x) => x.bp === 1);
  out.bump = { hits: hit.length, hitBin: hit.length ? hit[0].i : null, zeros: b.filter((x) => x.bp === 0).length, total: b.length,
    noCore: [...new Set(run({ ...d, rough, vpeak }, m, { 77: way }, { Core: null })[0].bins.map((x) => x.bp))],
    noPeaks: [...new Set(run({ ...d, rough }, m, { 77: way }, { Core })[0].bins.map((x) => x.bp))],
    walking: [...new Set(bins({ speed_mps: d.lat.map(() => 1) }).map((x) => x.bp))],
    driving: bins({ speed_mps: d.lat.map(() => 20) }).filter((x) => x.bp === 1).length,
    unknownPeak: bins({ vpeak: vpeak.map((v, i) => (i >= 600 && i < 700 ? null : v)) }).filter((x) => x.bp === null).length }; }
// network shell with a fake fetch: Valhalla trace_attributes + Overpass, then upload
// a mostly disputed road: 45 of 50 measured bins disagree, 5 agree on smooth: tiny weight, no Surface
out.mostlyDisputed = (() => { const m = { km: 0.5, coverage: 0.5, roughCoverage: 0.05, roughness: 0.05, avgPasses: 3, bankedKm: 0, offCamberKm: 0 }; return { adj: C.measuredAdjust(m), surface: C.surfaceScore(m) }; })();
out.offCamber = C.measuredAdjust({ roughness: null, coverage: 1, km: 10, bankedKm: 0, offCamberKm: 1, avgPasses: 3 });
out.adjust2 = { onePass: C.measuredAdjust({ roughness: 0.6, coverage: 1, avgPasses: 1 }), banked: C.measuredAdjust({ roughness: null, coverage: 1, km: 10, bankedKm: 1, avgPasses: 3 }),
  bankedLittle: C.measuredAdjust({ roughness: null, coverage: 1, km: 10, bankedKm: 0.5, avgPasses: 2 }), zeroCoverage: C.measuredAdjust({ roughness: 0.6, coverage: 0, km: 10, bankedKm: 1 }) };
out.surface = [C.surfaceScore(null), C.surfaceScore({ roughness: 0.05, coverage: 0.1 }), C.surfaceScore({ roughness: 0.05, coverage: 0.5 }), C.surfaceScore({ roughness: 0.5, coverage: 1 }), C.surfaceScore({ roughness: 0.23, coverage: 1 })];
out.adjust = [C.measuredAdjust(null), C.measuredAdjust({ roughness: null, coverage: 1 }), C.measuredAdjust({ roughness: 0.05, coverage: 1 }), C.measuredAdjust({ roughness: 0.6, coverage: 1 }), C.measuredAdjust({ roughness: 0.6, coverage: 0.1 }), C.measuredAdjust({ roughness: 0.23, coverage: 0.5 })];
(async () => {
  // measured data along a route: way 77 direction 0 has bins 200..399 merged from 3 passes, one banked stretch, one unmeasured-camber stretch
  const roads = { 77: { 0: { i: Array.from({ length: 200 }, (_, j) => 200 + j), n: Array(200).fill(3), cam: Array.from({ length: 200 }, (_, j) => (j < 40 ? 5 : j < 60 ? null : 1)), rough: Array(200).fill(0.1), crest: Array(200).fill(0.2) } } };
  const rt = drive(1000), rm = rt.lat.map(() => ({ way: 77, cls: 'tertiary' }));
  out.measured = C.summarize(C.locate({ drive: rt, match: rm, ways: { 77: way } }), roads, 1000);
  // passes disagree on roughness for the first 100 bins and on camber for the banked 40: those don't steer a route
  const disputedRoads = { 77: { 0: { ...roads[77][0], rsd: Array.from({ length: 200 }, (_, j) => (j < 100 ? 0.2 : 0.01)), cn: Array(200).fill(3), csd: Array.from({ length: 200 }, (_, j) => (j < 40 ? 4 : 0.5)) } } };
  out.disputed = C.summarize(C.locate({ drive: rt, match: rm, ways: { 77: way } }), disputedRoads, 1000);
  // repaved (IDEAS Q-12): 50 bins restarted in 2026-09, 10 more in 2026-10; the summary says how much and the newest month
  const repavedRoads = { 77: { 0: { ...roads[77][0], ch: Array.from({ length: 200 }, (_, j) => (j < 50 ? '2026-09' : j < 60 ? '2026-10' : null)) } } };
  out.repaved = C.summarize(C.locate({ drive: rt, match: rm, ways: { 77: way } }), repavedRoads, 1000);
  out.unknownRoad = C.summarize(C.locate({ drive: rt, match: rm, ways: { 77: way } }), {}, 1000);
  out.reverseRoute = C.summarize(C.locate({ drive: drive(1000, true), match: rm, ways: { 77: way } }), roads, 1000);
  const fk = async (url, init) => url.includes('trace_attributes')
    ? { ok: true, json: async () => ({ edges: [{ way_id: 77, road_class: 'tertiary' }], matched_points: JSON.parse(init.body).shape.map(() => ({ type: 'matched', edge_index: 0 })) }) }
    : { ok: true, json: async () => ({ elements: [{ type: 'way', id: 77, geometry: way.map(([la, lo]) => ({ lat: la, lon: lo })) }] }) };
  const viaNet = await C.measuredAlong(rt, async (ids) => { out.lookupIds = ids; return roads; }, { fetch: fk });
  out.series = (() => { const s = C.seriesFrom(C.locate({ drive: rt, match: rm, ways: { 77: way } }), roads, 1000); return { len: s.cam.length, known: s.cam.filter((v) => v != null).length, unknownRough: s.rough.filter((v) => v == null).length, first: s.cam.findIndex((v) => v != null), n: s.n.find((v) => v != null) }; })();
  // crowd-verified bumps (IDEAS Q-02): [bin, posterior] become one route event each, never two at one spot
  { const br = { 77: { 0: { ...roads[77][0], bp: [[250, 0.86], [251, 0.9], [300, 0.83], [5000, 0.9]] } } };
    const s = C.seriesFrom(C.locate({ drive: rt, match: rm, ways: { 77: way } }), br, 1000);
    const t = { lat: rt.lat, lon: rt.lon, dist: rt.lat.map((_, i) => i * 5) };
    const ev = C.bumpEvents(t, s.bumps, [{ type: 'bump', dist_m: s.bumps.length > 2 ? t.dist[s.bumps[2].index] + 10 : -1 }]);
    out.crowdBumps = { series: s.bumps.map((b) => [b.index, b.p]), events: C.bumpEvents(t, s.bumps).map((e) => [e.index, e.call, e.crowd.p, e.severity_g]),
      besideOwn: ev.length, bad: C.bumpEvents(t, [{ index: -1, p: 0.9 }, { index: 1e6, p: 0.9 }]).length, none: C.seriesFrom([], {}, 10).bumps.length }; }
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


def test_payload_has_no_drive_coordinates_or_times(result):
    assert result["shape"] is True
    assert result["keys"] == "bins,cam_v,cls,dir,drive_id,driven_on,rec,shape,way_id|bp,cam,crest,fl,hb,i,k,rough"
    assert result["cls"] == "tertiary", "the map match's road class goes with it (the server's open-road rule)"


def test_a_drive_recorded_before_the_camber_fix_sends_no_camber(result):
    o = result["oldDrive"]
    assert result["oldDrive"]["newCamV"] == 2, "a drive from the fixed pipeline says so"
    assert o["camV"] is None and o["cams"] == [None], "the old pipeline's placeholder 0s are never shared as measured"
    assert o["rough"] == [0.2] and o["bins"] == 600, "roughness and the rest still go"


def test_a_long_twisty_way_keeps_its_length_in_the_line_sent(result):
    t = result["twisty"]
    assert t["nodes"] > 1000 and 2 <= t["sent"] <= 64 and t["ends"]
    assert t["kept"] > 0.88, "the server drops a line under 80% of the length the bins reach (contribute.ts validateShape)"


def test_network_shell_matches_fetches_and_uploads_bins_only(result):
    sh = result["shell"]
    assert sh["res"] == {"built": 1, "sent": 1} and sh["posted"] == 1
    assert sh["valhalla"] == 1 and sh["overpass"] == 1
    assert sh["keys"] == "bins,cam_v,cls,dir,drive_id,driven_on,rec,shape,way_id"


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
    assert rough_full == pytest.approx(-8) and -8 < rough_little < 0 and mid == pytest.approx(-3), "half measured counts three quarters"
    a = result["adjust2"]
    assert a["onePass"] == pytest.approx(-6), "one pass counts three quarters"
    assert a["banked"] == pytest.approx(2) and a["bankedLittle"] == pytest.approx(1)
    assert a["zeroCoverage"] == 0
    assert result["surface"] == [None, None, 100, 0, 50]
    assert result["offCamber"] == pytest.approx(-2), "off-camber road is a hazard, never a bonus"
    assert 0 < result["mostlyDisputed"]["adj"] <= 0.25 and result["mostlyDisputed"]["surface"] is None


def test_disagreeing_passes_do_not_steer_routes(result):
    d, m = result["disputed"], result["measured"]
    assert d["coveredKm"] == pytest.approx(m["coveredKm"]), "still covered"
    assert d["bankedKm"] == 0 and m["bankedKm"] > 0, "banking the passes disagree on is not banking"
    assert d["smoothKm"] == pytest.approx(m["smoothKm"] / 2, abs=0.02)
    assert d["disputedKm"] == pytest.approx(0.5, abs=0.02)
    assert d["roughCoverage"] == pytest.approx(m["roughCoverage"] / 2, abs=0.01), "weights count agreed readings only"
    assert m["offCamberKm"] == 0


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
    const live = C.createLive({ Core, skip: 200, lag: 200, fetch: fake(st), driveId: 'd_live_test_01', drivenOn: '2026-10-25', post: async (c) => { posts.push(c); return true; }, onStatus: (s) => statuses.push(s.state) });
    for (let i = 0; i < N; i++) { live.push(row(i)); if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0)); }
    const stats = await live.finish();
    const bins = posts.flatMap((p) => p.bins.map((b) => b.i)), lo = Math.min(...bins), hi = Math.max(...bins);
    out.normal = { posts: posts.length, lo, hi, n: bins.length, unique: new Set(bins).size, overpass: st.overpass, ids: [...new Set(posts.map((p) => p.drive_id))], crest: [...new Set(posts.flatMap((p) => p.bins.map((b) => b.crest)))], keys: Object.keys(posts[0]).sort().join(), km: stats.km, firstState: statuses[0] }; }
  // 2. failures are retried, rows are not lost
  { const st = { matches: 0, overpass: 0, failTimes: 1 }, posts = []; let t = 0;
    const live = C.createLive({ Core, skip: 200, lag: 200, fetch: fake(st), driveId: 'd_live_test_02', drivenOn: '2026-10-25', retryMs: 1000, now: () => t, post: async (c) => { posts.push(c); return true; } });
    for (let i = 0; i < N; i++) live.push(row(i));
    await live.finish(); out.afterFail = { posts: posts.length, error: !!live.stats().error };
    t += 2000; live.push(row(N)); await live.finish(); out.afterRetry = { posts: posts.length, error: !!live.stats().error }; }
  // 3. the server refusing stops everything
  { const st = { matches: 0, overpass: 0, failTimes: 0 }; let calls = 0;
    const live = C.createLive({ Core, skip: 200, lag: 200, fetch: fake(st), driveId: 'd_live_test_03', drivenOn: '2026-10-25', post: async () => { calls++; return 'stop'; } });
    for (let i = 0; i < N; i++) live.push(row(i));
    await live.finish(); out.stopped = { stopped: live.stats().stopped, calls }; }
  // 4. a short drive sends nothing at all
  { const st = { matches: 0, overpass: 0, failTimes: 0 }, posts = [];
    const live = C.createLive({ Core, skip: 200, lag: 200, fetch: fake(st), driveId: 'd_live_test_04', drivenOn: '2026-10-25', post: async (c) => { posts.push(c); return true; } });
    for (let i = 0; i < 380; i++) live.push(row(i));          // 1.9 km: first km and last km stay private, only 0 rows remain
    await live.finish(); out.short = { posts: posts.length, matches: st.matches }; }
  // 5. a network blip or server error keeps the chunk and resends the same payload; sharing never stops
  { const st = { matches: 0, overpass: 0, failTimes: 0 }, calls = [], ok = []; let t = 0, blips = 2;
    const live = C.createLive({ Core, skip: 200, lag: 200, fetch: fake(st), driveId: 'd_live_test_05', drivenOn: '2026-10-25', retryMs: 1000, now: () => t,
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
    const live = C.createLive({ Core, skip: 200, lag: 200, fetch: two, driveId: 'd_live_test_06', drivenOn: '2026-10-25', post: async (c) => { posts.push(c); return true; } });
    for (let i = 0; i < N; i++) { live.push(row(i)); if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0)); }
    await live.finish();
    const keys = posts.flatMap((p) => p.bins.map((b) => p.way_id + ':' + b.i)), on = (w) => posts.filter((p) => p.way_id === w).flatMap((p) => p.bins.map((b) => b.i));
    out['split' + split] = { n: keys.length, unique: new Set(keys).size, max77: Math.max(...on(77)), min78: Math.min(...on(78)) };
  }
  // 7. defaults: each trip keeps a random 0.5-1.5 km at each end; under 1 km in all is never sent
  { const e = [0, 0.5, 0.999999].map((r) => C.privateEdge(() => r)), many = new Set(Array.from({ length: 50 }, () => C.privateEdge()));
    const st = { matches: 0, overpass: 0, failTimes: 0 }, posts = [];
    const live = C.createLive({ Core, fetch: fake(st), driveId: 'd_live_test_07', drivenOn: '2026-10-25', post: async (c) => { posts.push(c); return true; } });
    for (let i = 0; i < 199; i++) live.push(row(i));
    await live.finish(); out.edges = { e, distinct: many.size, min: Math.min(...many), max: Math.max(...many), shortPosts: posts.length, matches: st.matches }; }
  // 8. camber: a row from the fixed pipeline (camber_v 2) keeps its camber; a row without it (an older build's frame) is unknown
  for (const v of [2, undefined]) {
    const st = { matches: 0, overpass: 0, failTimes: 0 }, posts = [];
    const live = C.createLive({ Core, skip: 200, lag: 200, fetch: fake(st), driveId: 'd_live_test_08', drivenOn: '2026-10-25', post: async (c) => { posts.push(c); return true; } });
    for (let i = 0; i < N; i++) { live.push({ ...row(i), camber_deg: i % 2 ? 3 : null, camber_v: v }); if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0)); }
    await live.finish();
    out['cam' + (v || 'Old')] = { camV: [...new Set(posts.map((p) => p.cam_v))], cams: [...new Set(posts.flatMap((p) => p.bins.map((b) => b.cam)))].sort() };
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
    assert n["ids"] == ["d_live_test_01"] and n["keys"] == "bins,cam_v,cls,dir,drive_id,driven_on,rec,shape,way_id"
    assert n["overpass"] == 1 and n["firstState"] == "on"             # way geometry fetched once, then cached


def test_live_private_edges_are_random_half_to_one_and_a_half_km(live):
    e = live["edges"]
    assert e["e"] == [100, 200, 300]                                  # 0.5, 1.0 and 1.5 km in 5 m rows
    assert e["distinct"] > 10 and 100 <= e["min"] and e["max"] <= 300  # drawn per trip, never a fixed distance
    assert e["shortPosts"] == 0 and e["matches"] == 0                 # a trip under 1 km never leaves the phone, not even to the matcher


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


def test_live_camber_only_from_the_fixed_pipeline(live):
    assert live["cam2"]["camV"] == [2] and 3 in live["cam2"]["cams"]
    assert live["camOld"]["cams"] == [None], "an older build's camber (a decayed placeholder) is never sent"


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


def test_repaved_stretches_are_counted(result):
    r, m = result["repaved"], result["measured"]
    assert r["repavedKm"] == pytest.approx(0.3) and r["repavedOn"] == "2026-10"
    assert m["repavedKm"] == 0 and m["repavedOn"] is None, "an older server without ch says nothing"


def test_bump_flags(result):
    """Each bin says whether this pass felt a spike there (IDEAS Q-02); unknown is never sent as clean."""
    b = result["bump"]
    assert b["hits"] == 1 and b["zeros"] == b["total"] - 1
    assert b["hitBin"] in (499, 500)                                # sample 500, 2500 m along the way (float floor)
    assert b["noCore"] == [None] and b["noPeaks"] == [None] and b["walking"] == [None]
    assert b["driving"] == 1
    assert 90 <= b["unknownPeak"] <= 101                            # the 100 samples with no peak: their bins unknown


def test_crowd_bumps_on_a_route(result):
    b = result["crowdBumps"]
    # bins 250, 251 and 300 are on the route (bin 5000 is not); 250 and 251 are 5 m apart: one note, not two
    idx = [x[0] for x in b["series"]]
    assert len(idx) == 3 and idx[1] - idx[0] == 1 and idx[2] - idx[0] == 50 and abs(idx[0] - 250) <= 1   # the drive is 3 m off the way
    assert len(b["events"]) == 2 and all(e[1] == "Bump" and e[3] is None for e in b["events"])
    assert b["events"][0][2] == 0.86
    assert b["besideOwn"] == 1                                       # one already on the track 10 m from the third
    assert b["bad"] == 0 and b["none"] == 0


def test_way_geometry_from_our_build_first_overpass_only_for_the_rest():
    """A drive's ways come from our weekly build (GET /api/ctx/ways, the 0.05 degree tiles its matched samples fall in and
    the way ids, which the contribution sends anyway); only a way the build doesn't have goes to Overpass, and with the
    server down every way does, as before."""
    js = r"""
const C = require(process.argv[1] + '/web/contributor.js');
(async () => {
  const drive = { lat: [39.101, 39.102, 39.149], lon: [-84.51, -84.51, -84.51] };
  const match = [{ way: 7 }, { way: 7 }, { way: 9 }];
  const asked = [], over = [];
  globalThis.ApexSync = { apiFetch: async (p) => { asked.push(p); return { ok: true, json: async () => ({ ways: { 7: [[39.1, -84.51], [39.11, -84.51]] } }) }; } };
  const fetch = async (u, init) => { over.push(decodeURIComponent(init.body)); return { ok: true, json: async () => ({ elements: [{ type: 'way', id: 9, geometry: [{ lat: 39.14, lon: -84.51 }, { lat: 39.15, lon: -84.51 }] }] }) }; };
  const got = await C.fetchWays([7, 9], fetch, { drive, match });
  globalThis.ApexSync = { apiFetch: async () => { throw new Error('offline'); } };
  const over0 = over.length, down = await C.fetchWays([7, 9], fetch, { drive, match });
  console.log(JSON.stringify({ tiles: C.wayTiles(drive, match), asked, got: Object.keys(got).sort(), over: over.slice(0, over0), downOver: over.slice(over0) }));
})();
"""
    root = str(__import__("pathlib").Path(__file__).resolve().parents[1])
    o = json.loads(subprocess.run([NODE, "-e", js, root], capture_output=True, text=True, check=True).stdout)
    assert o["tiles"] == ["782_-1691"]                                # one 0.05 degree tile holds all three samples
    assert o["asked"] == [f"/api/ctx/ways?tiles={','.join(o['tiles'])}&ids=7,9"]
    assert o["got"] == ["7", "9"] and len(o["over"]) == 1 and "way(id:9)" in o["over"][0]
    assert len(o["downOver"]) == 1 and "way(id:7,9)" in o["downOver"][0]
