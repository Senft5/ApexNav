"""Route context, the crowd (web/route_ctx/crowd.js) and the flow members' phones send for it (web/contributor.js binFlow):
members' measured roads, flow confidence, loved roads, busy times (off by default) and the driver's taste, per 25 m sample,
with unknown as NaN; the provider never blocks and never throws."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="needs node")

PRE = f"""
const W = {json.dumps(str(ROOT / 'web'))} + '/';
const C = require(W + 'route_ctx/crowd.js'), K = require(W + 'contributor.js');
const nanify = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v instanceof Float32Array || v instanceof Float64Array ? Array.from(v, (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 'NaN')) : v)));
// a straight corridor north from 35.5, -83.5: n samples 25 m apart
const corridor = (n, id = 'c1') => {{ const lat = new Float64Array(n), lon = new Float64Array(n), distM = new Float64Array(n), etaAt = new Float64Array(n);
  for (let i = 0; i < n; i++) {{ lat[i] = 35.5 + i * 25 / 110540; lon[i] = -83.5; distM[i] = i * 25; etaAt[i] = Date.parse('2026-11-07T09:00:00') + i * 2000; }}
  return {{ id, lat, lon, distM, etaAt, heading: new Float32Array(n), bbox: [35.5, -83.5, lat[n - 1], -83.5] }}; }};
"""


def run(js: str):
    p = subprocess.run([NODE, "-e", PRE + f"(async () => {{ const out = await ({js}); console.log(JSON.stringify(nanify(out))); }})();"],
                       capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_contract_shape_and_registration():
    out = run("(async () => ({ id: C.provider.id, ch: C.provider.channels, budget: C.provider.budgetMs, pending: globalThis.ApexRouteCtx.pending.map((p) => p.id),"
              " keys: Object.keys(C.provider) }))()")
    assert out["id"] == "crowd" and "crowd" in out["pending"]
    assert set(out["ch"]) >= {"crowd_rough_g", "crowd_bank_deg", "crowd_flow", "loved", "taste", "crowd_busy"}
    assert {"id", "version", "channels", "needs", "budgetMs", "fetch"} <= set(out["keys"]) and out["budget"] > 0
    # every channel is documented in the file header
    head = (ROOT / "web" / "route_ctx" / "crowd.js").read_text().split("(function")[0]
    for ch in out["ch"]:
        assert ch in head, ch


def test_flow_confidence_shrinks_with_few_passes_and_unknown_stays_nan():
    out = run("[C.flowConfidence(1, 0, 3), C.flowConfidence(1, 0, 1), C.flowConfidence(0.8, 0.5, 6), C.flowConfidence(null, null, 0), C.flowConfidence(0.9, null, 0)]")
    assert out[0] == 1 and abs(out[1] - (0.5 + 0.5 / 3)) < 1e-9 and abs(out[2] - 0.4) < 1e-9
    assert out[3] is None and out[4] is None                             # NaN (a plain NaN is null in JSON)


def test_channels_from_roads_answer():
    """One located way with three bins: roughness, a disputed camber, flow, a loved level; the next way unanswered stays NaN."""
    js = """(() => {
      const runs = [{ way: 9, dir: 0, pts: [{ i: 0, bin: 0 }, { i: 1, bin: 5 }, { i: 2, bin: 10 }] }, { way: 10, dir: 0, pts: [{ i: 3, bin: 0 }, { i: 4, bin: 5 }] }];
      const roads = { 9: { 0: { i: [0, 5, 10], n: [3, 1, 5], rough: [0.1, 0.2, 0.05], rsd: [0.01, null, 0.2], cam: [4, -3, 1], cn: [3, 1, 5], csd: [3, null, 0.5],
        k: [0.01, null, 0.02], kn: [2, 0, 3], fl: [0.9, null, 0.2], hb: [0, null, 0.5], fn: [3, 0, 4], ag: 2 } } };
      const r = C.channelsFrom(6, runs, roads, { names: ['Gap Rd', 'Gap Rd', 'Gap Rd', null, null, null], votes: { r: { 'gap rd': 1650 } } });
      return { ch: r.channels, located: r.located };
    })()"""
    out = run(js)
    ch = out["ch"]
    assert ch["crowd_rough_g"][:3] == [0.1, 0.2, "NaN"]                 # bin 10's passes disagree (0.2 g spread): left out
    assert ch["crowd_bank_deg"][:3] == ["NaN", -3, 1]                   # bin 0's camber spread 3 deg: disputed
    assert ch["crowd_conf"][:3] == [2, 1, 3]
    assert ch["crowd_flow"][0] == 0.9 and ch["crowd_flow"][1] == "NaN" and ch["crowd_flow"][2] == 0.1
    assert ch["loved"][:3] == [1, 1, 1]                                 # the road's own vote (Elo 1650) beats the crowd level 0.7
    assert all(v == "NaN" for v in ch["crowd_rough_g"][3:]) and ch["loved"][3] == "NaN" and ch["loved"][5] == "NaN"
    assert all(v == "NaN" for v in ch["crowd_busy"])                    # quiet hours off: never a busy number
    assert abs(out["located"] - 5 / 6) < 1e-6


def test_loved_parts_crew_and_your_own_drives_known_zero_off_them():
    js = """(() => {
      const t = corridor(40), on = { lat: Array.from(t.lat.subarray(0, 20)), lon: Array.from(t.lon.subarray(0, 20)) };
      const crew = C.lineGrid([on]), again = C.againGrid([on, on]);
      const r = C.channelsFrom(40, [], null, { lat: t.lat, lon: t.lon, crewGrid: crew, againGrid: again });
      const one = C.channelsFrom(40, [], null, { lat: t.lat, lon: t.lon, againGrid: C.againGrid([on]) });
      return { loved: r.channels.loved, mine: one.channels.loved };
    })()"""
    out = run(js)
    assert out["loved"][5] == 0.8 and out["loved"][35] == 0         # on the crew's line; off it known 0, not unknown
    assert all(v == 0 for v in out["mine"])                          # a road driven once is not "again"


def test_busy_times_only_with_quiet_hours_on():
    js = """(() => {
      const hr = Array(12).fill(1 / 12); const b = C.bucketOf(Date.parse('2026-11-07T09:00:00')); hr[b] = 0.25;
      const runs = [{ way: 9, dir: 0, pts: [{ i: 0, bin: 0 }] }];
      const roads = { 9: { 0: { i: [0], n: [5], rough: [0.1], cam: [null], k: [null], kn: [0], fl: [null], hb: [null], fn: [0], hr } } };
      const eta = [Date.parse('2026-11-07T09:00:00')];
      return { bucket: b, off: C.channelsFrom(1, runs, roads, { etaAt: eta }).channels.crowd_busy[0], on: C.channelsFrom(1, runs, roads, { etaAt: eta, quietHours: true }).channels.crowd_busy[0] };
    })()"""
    out = run(js)
    assert out["bucket"] == 6 + 2                                     # a Saturday, 08:00-12:00
    assert out["off"] is None and abs(out["on"] - 3) < 1e-6


def test_provider_signed_out_and_slow_server_never_block():
    js = """(async () => {
      const t = corridor(60);
      t.edges = [{ fromM: 0, toM: 1500, way: 77, cls: 'tertiary', name: 'Ridge Rd' }];
      const signedOut = await C.provider.fetch([t], { Contributor: K });
      const t0 = Date.now();
      const slow = await C.provider.fetch([t], { Contributor: K, lookupCells: () => new Promise(() => {}), budgetMs: 300 });
      return { s: signedOut.c1.status, note: signedOut.c1.note, n: signedOut.c1.channels.crowd_rough_g.length, slow: slow.c1.status, ms: Date.now() - t0 };
    })()"""
    out = run(js)
    assert out["s"] == "no-key" and "signing in" in out["note"] and out["n"] == 60
    assert out["slow"] == "unavailable" and out["ms"] < 2000


def test_provider_end_to_end_by_cells_and_router_edges():
    """The server gets 0.1-degree cells (VI-1), never way ids or the route; the ways come from the router's own edges (no
    second map match), the lines from the answer."""
    js = """(async () => {
      const t = corridor(60);
      t.edges = [{ fromM: 0, toM: 1500, way: 77, cls: 'tertiary', name: 'Ridge Rd' }];
      const poly = [[35.5, -83.5], [35.5 + 2000 / 110540, -83.5]];
      const bins = Array.from({ length: 300 }, (_, b) => b);
      const asked = [];
      const lookupCells = async (cells) => { asked.push(cells); return { ways: { 77: { 0: { i: bins, n: bins.map(() => 4), rough: bins.map(() => 0.06), rsd: bins.map(() => 0.01), cam: bins.map(() => null), cn: bins.map(() => 0),
        csd: bins.map(() => null), k: bins.map(() => null), kn: bins.map(() => 0), fl: bins.map(() => 0.95), hb: bins.map(() => 0), fn: bins.map(() => 4), ag: 3 } } }, lines: { 77: poly } }; };
      const noTrace = { ...K, matchDrive: () => { throw new Error('a second map match'); }, fetchWays: () => { throw new Error('Overpass for way lines'); } };
      const r = (await C.provider.fetch([t], { Contributor: noTrace, lookupCells }))[`c1`];
      const t2 = corridor(60, 'c2');
      const none = (await C.provider.fetch([t2], { Contributor: noTrace, lookupCells, now: Date.now() + 3600e3 }))[`c2`];
      return { status: r.status, rough: r.channels.crowd_rough_g[10], flow: r.channels.crowd_flow[10], loved: r.channels.loved[10], spans: r.spans.map((s) => [s.kind, s.label]),
        asked, noEdges: [none.status, none.note] };
    })()"""
    out = run(js)
    assert out["status"] == "ok" and abs(out["rough"] - 0.06) < 1e-6 and abs(out["flow"] - 0.95) < 1e-6 and out["loved"] == 1
    assert ["loved", "Ridge Rd"] in out["spans"] and ["flowing", "Members drive it smoothly"] in out["spans"]
    assert out["asked"][0] == ["355_-835"] and all(len(a) == 1 for a in out["asked"]), "one 0.1-degree cell, no way ids, no coordinates"
    assert out["noEdges"][0] in ("unavailable", "partial") and "router edges" in out["noEdges"][1]


def test_contributor_flow_per_bin_is_a_ratio_and_a_yes_no():
    """binFlow: steady speed is 1, stop-start 0, an unexplained hard brake 1, a hard brake before a hairpin 0; no speed leaves."""
    js = """(() => {
      const n = 40, steady = Array(n).fill(20), crawl = Array(n).fill(2), g = Array(n).fill(0), k = Array(n).fill(0);
      const brake = g.slice(); brake[20] = -0.5;
      const bend = k.slice(); bend[30] = 1 / 40;
      const ids = [19, 20, 21];
      return [K.binFlow({ speed: steady, lon_g: g, kappa: k }, ids), K.binFlow({ speed: crawl, lon_g: g, kappa: k }, ids),
        K.binFlow({ speed: steady.map((v, i) => v + (i % 2 ? 6 : -6)), lon_g: g, kappa: k }, ids),
        K.binFlow({ speed: steady, lon_g: brake, kappa: k }, ids), K.binFlow({ speed: steady, lon_g: brake, kappa: bend }, ids),
        K.binFlow({ speed: steady, lon_g: Array(n).fill(null), kappa: k }, ids), K.binFlow({ lon_g: g }, ids),
        K.hourBucket(new Date('2026-11-04T13:30:00')), K.hourBucket(new Date('2026-11-08T23:00:00'))];
    })()"""
    out = run(js)
    assert out[0] == {"fl": 1, "hb": 0} and out[1] == {"fl": 0, "hb": 0}
    assert out[2]["fl"] == 0                                         # +-30 % speed swings: stop-start
    assert out[3]["hb"] == 1 and out[4]["hb"] == 0                   # a corner ahead explains the brake
    assert out[5] == {"fl": None, "hb": None} and out[6] == {"fl": None, "hb": None}
    assert out[7] == 3 and out[8] == 11


def test_contribution_carries_flow_and_rec_but_never_speed():
    js = """(() => {
      const n = 400, lat = [], lon = [];
      for (let i = 0; i < n; i++) { lat.push(35.5 + i * 5 / 110540); lon.push(-83.5); }
      const poly = [[35.5, -83.5], [35.5 + 2100 / 110540, -83.5]];
      const drive = { lat, lon, rough: lat.map(() => 0.05), camber: lat.map(() => null), crest: lat.map(() => null), kappa: lat.map(() => 0), speed: lat.map(() => 18), lon_g: lat.map(() => 0), rec: true };
      const c = K.buildContributions({ drive, match: lat.map(() => ({ way: 5, cls: 'tertiary' })), ways: { 5: poly }, drivenOn: '2026-11-03', driveId: 'd_test_000001', trimM: 0 });
      return { keys: Object.keys(c[0]).sort(), bin: c[0].bins[3], binKeys: [...new Set(c[0].bins.flatMap((b) => Object.keys(b)))].sort(), values: c[0].bins.flatMap(({ i, ...b }) => Object.values(b)) };
    })()"""
    out = run(js)
    assert "rec" in out["keys"] and "hr" not in out["keys"]
    assert out["bin"]["fl"] == 1 and out["bin"]["hb"] == 0
    assert out["binKeys"] == ["bp", "cam", "crest", "fl", "hb", "i", "k", "rough"] and 18 not in out["values"]   # the speed never leaves
