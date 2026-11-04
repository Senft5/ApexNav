"""Route-context providers end to end through their fetch(): the contract's shape, the registry (or its shim), one fetch for
several corridors, caching, keys that are missing, budgets that run out, and only boxes or tiles in the requests."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const root = process.argv[1];
const T = require(root + '/tests/fixtures/route_ctx/corridor.js');
const F = (n) => require(root + '/tests/fixtures/route_ctx/' + n);
const U = require(root + '/web/route_ctx/ctx_util.js');
const P = ['conditions', 'wildlife', 'events', 'hazards_live', 'photos'].map((n) => require(root + '/web/route_ctx/' + n + '.js'));
const [K, W, E, H, Ph] = P;
const line = [[39.0930, -84.5250], [39.0955, -84.5040], [39.1040, -84.4700], [39.0900, -84.4450], [39.0600, -84.4250], [39.0500, -84.4150], [39.0300, -84.3500], [38.9900, -84.3000], [38.9400, -84.3600]];   // ends in Kentucky (California, KY)
const depart = Date.UTC(2026, 10, 3, 11, 30);
const a = T.corridor('a', line, { departAt: depart }), b = T.corridor('b', line.slice().reverse(), { departAt: depart });
const shape = (r, c, channels) => r && ['ok', 'partial', 'unavailable', 'no-key'].includes(r.status) && Object.keys(r.channels).sort().join() === channels.slice().sort().join()
  && Object.values(r.channels).every((x) => x instanceof Float32Array && x.length === c.lat.length) && Array.isArray(r.spans) && Array.isArray(r.points)
  && r.spans.every((s) => typeof s.fromM === 'number' && s.toM >= s.fromM && typeof s.kind === 'string') && r.points.every((p) => typeof p.atM === 'number' && typeof p.kind === 'string');
(async () => {
  const out = {};
  out.registry = { shim: !!globalThis.ApexRouteCtx.shim, ids: globalThis.ApexRouteCtx.pending.map((p) => [p.id, p.version, p.channels.length, p.needs.network, p.needs.key || null, p.budgetMs]) };
  // events: MLB fixture; schools and churches passed in; no SeatGeek id
  let log = [], st = T.memoryStorage();
  const fx = T.fakeFetch([['statsapi.mlb.com', F('mlb_schedule_2026-07-03.json')]], log);
  const ev = await E.fetch([a, b], { fetchFn: fx, storage: st, now: depart, places: { schools: [], worship: [] } });
  out.events = { shapeA: shape(ev.a, a, E.CHANNELS), shapeB: shape(ev.b, b, E.CHANNELS), calls: log.length, note: ev.a.note };
  await E.fetch([a, b], { fetchFn: fx, storage: st, now: depart + 60e3, places: { schools: [], worship: [] } });
  out.events.cached = log.length;
  log = [];
  const sgFetch = T.fakeFetch([['statsapi.mlb.com', F('mlb_schedule_2026-07-03.json')], ['api.seatgeek.com', { events: [] }]], log);
  await E.fetch([a], { fetchFn: sgFetch, storage: T.memoryStorage(), now: depart, keys: { seatgeekClientId: 'id123' }, places: { schools: [], worship: [] } });
  out.events.sgUrl = log.find((u) => u.includes('seatgeek')) || null;
  // hazards: NWPS, USGS, Indiana's feed direct, Kentucky through the Worker; Ohio has no key
  log = [];
  const hz = T.fakeFetch([['api.water.noaa.gov', F('nwps_gauges_cincinnati.json')], ['waterservices.usgs.gov', F('usgs_iv_cincinnati.json')],
    ['in.carsprogram.org', F('wzdx_indot_se.json')], ['/api/ctx/workzones', F('wzdx_kytc_nky.json')]], log);
  const hr = await H.fetch([a, b], { fetchFn: hz, storage: T.memoryStorage(), now: Date.UTC(2026, 10, 3, 23, 30), apiBase: 'https://w.example' });
  out.hazards = { shape: shape(hr.a, a, H.CHANNELS), calls: log.map((u) => u.split('?')[0]), relay: log.find((u) => u.includes('/api/ctx/workzones')), note: hr.a.note };
  // conditions: one Open-Meteo call for the cells of both corridors (the real answer), then an hour from the cache
  log = [];
  const cLine = line.slice(0, 8), ca = T.corridor('a', cLine, { departAt: depart }), cb = T.corridor('b', cLine, { departAt: depart + 3600e3 });   // the same road an hour later
  const om = T.fakeFetch([['api.open-meteo.com', F('openmeteo_cincinnati_2026-11-03.json')]], log), cst = T.memoryStorage();
  const cr = await K.fetch([ca, cb], { fetchFn: om, storage: cst, now: Date.UTC(2026, 10, 3, 23, 55) });
  const c2 = await K.fetch([ca], { fetchFn: om, storage: cst, now: Date.UTC(2026, 10, 3, 23, 55) + 30 * 60e3 });
  const c3 = await K.fetch([ca], { fetchFn: om, storage: cst, now: Date.UTC(2026, 10, 3, 23, 55) + 61 * 60e3 });
  out.conditions = { shape: shape(cr.a, ca, K.CHANNELS) && shape(cr.b, cb, K.CHANNELS), status: [cr.a.status, cr.b.status, c2.a.status], calls: log.length, url: log[0] };
  // photos: one Commons call per 0.02° cell (2 at a time), each kept 30 days; no Flickr key, no Mapillary token
  log = [];
  const pst = T.memoryStorage(), pf = T.fakeFetch([['commons.wikimedia.org', F('commons_geosearch_riverbend.json')]], log);
  const pr = await Ph.fetch([a, b], { fetchFn: pf, storage: pst, now: depart });
  const firstCalls = log.length;
  await Ph.fetch([a], { fetchFn: pf, storage: pst, now: depart + 864e5 });
  out.photos = { shape: shape(pr.a, a, Ph.CHANNELS), firstCalls, again: log.length - firstCalls, note: pr.a.note, hosts: [...new Set(log.map((u) => new URL(u).host))] };
  // wildlife: no network at all
  const wr = await W.fetch([a], {});
  out.wildlife = { shape: shape(wr.a, a, W.CHANNELS), status: wr.a.status };
  // budgets: a network that never answers → every provider still resolves, within its budget, 'unavailable'/'partial'
  const never = () => new Promise(() => {});
  const t0 = Date.now();
  const slow = await Promise.all([K, E, H, Ph].map((p) => p.fetch([a], { fetchFn: never, storage: T.memoryStorage(), budgetMs: 300, now: depart, places: { schools: [], worship: [] } })));
  out.budget = { ms: Date.now() - t0, statuses: slow.map((r) => r.a.status), shapes: slow.map((r, k) => shape(r.a, a, [K, E, H, Ph][k].CHANNELS)),
    conditionsSunKnown: !Number.isNaN(slow[0].a.channels.light[0]), conditionsAirUnknown: Number.isNaN(slow[0].a.channels.air_temp_c[0]) };
  // an aborted plan
  const ctrl = new AbortController(); ctrl.abort();
  const ab = await K.fetch([a], { fetchFn: T.fakeFetch([]), storage: null, signal: ctrl.signal, now: depart });
  out.aborted = ab.a.status;
  // keys: opts.keys, then localStorage 'apex.keys'; the Worker's keys never overwrite one entered on the phone
  const ks = T.memoryStorage(); ks.setItem('apex.keys', JSON.stringify({ mapillaryToken: 'mine' }));
  const merged = await U.loadKeys({ fetchFn: T.fakeFetch([['/api/ctx/keys', { keys: { mapillaryToken: 'worker', seatgeekClientId: 'sg' } }]]), storage: ks, apiBase: 'https://w.example', now: 1e12 });
  out.keys = { merged, viaOpts: U.keyFor({ keys: { x: 'k1' } }, 'x'), viaStorage: U.keyFor({ storage: ks }, 'seatgeekClientId'), none: U.keyFor({ storage: T.memoryStorage() }, 'x') };
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_registry_shim_holds_every_provider(out):
    ids = {i[0]: i for i in out["registry"]["ids"]}
    assert out["registry"]["shim"] is True
    assert set(ids) == {"conditions", "wildlife", "events", "hazards-live", "photos"}
    assert ids["wildlife"][3] is False and ids["events"][4] == "seatgeekClientId" and ids["photos"][4] == "mapillaryToken"
    assert all(i[5] > 0 for i in ids.values())


def test_events_one_fetch_for_several_corridors_then_cached(out):
    e = out["events"]
    assert e["shapeA"] and e["shapeB"] and e["calls"] == 1 and e["cached"] == 1
    assert "SeatGeek" in e["note"]
    assert "client_id=id123" in e["sgUrl"] and "lat=" in e["sgUrl"] and "range=" in e["sgUrl"]


def test_hazards_reads_each_source_once_and_kentucky_through_the_worker(out):
    h = out["hazards"]
    assert h["shape"]
    assert sorted(h["calls"]) == sorted(["https://api.water.noaa.gov/nwps/v1/gauges", "https://waterservices.usgs.gov/nwis/iv/", "https://w.example/api/ctx/workzones"])
    assert "state=KY&tiles=78_-169" in h["relay"] or "state=KY&tiles=77_-169" in h["relay"]
    assert "OHGO" in h["note"]                                     # Ohio without a key: unknown, and said


def test_conditions_one_call_then_cached_for_an_hour(out):
    c = out["conditions"]
    assert c["shape"] and c["status"] == ["ok", "ok", "ok"]
    assert c["calls"] == 2                                         # the first plan, then once more after the hour
    assert c["url"].split("&")[0].count(",") == 7                    # 8 cell centres, never the route


def test_photos_cells_once_and_keys_missing_said(out):
    p = out["photos"]
    assert p["shape"] and p["firstCalls"] > 3 and p["again"] == 0 and p["hosts"] == ["commons.wikimedia.org"]
    assert "Mapillary token" in p["note"] and "Flickr" in p["note"]


def test_wildlife_needs_no_network(out):
    assert out["wildlife"]["shape"] and out["wildlife"]["status"] == "partial"


def test_budgets_are_kept_and_nothing_throws(out):
    b = out["budget"]
    assert b["ms"] < 2500 and all(b["shapes"])
    assert b["statuses"][0] == "unavailable" and b["conditionsSunKnown"] and b["conditionsAirUnknown"]
    assert out["aborted"] == "unavailable"


def test_keys(out):
    k = out["keys"]
    assert k["merged"] == {"mapillaryToken": "mine", "seatgeekClientId": "sg"}
    assert k["viaOpts"] == "k1" and k["viaStorage"] == "sg" and k["none"] is None
