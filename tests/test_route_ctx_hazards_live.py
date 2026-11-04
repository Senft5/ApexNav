"""Route context `hazards-live` (web/route_ctx/hazards_live.js): river gauges, WZDx work zones and closures, harvest, park
seasons and fall colour, each at the sample's eta. Fixtures are real answers for the Cincinnati area, 2026-11-03."""
import importlib.util
import json
import os
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const root = process.argv[1];
const H = require(root + '/web/route_ctx/hazards_live.js'), C = require(root + '/tests/fixtures/route_ctx/corridor.js');
const F = (n) => require(root + '/tests/fixtures/route_ctx/' + n);
const nan = (a) => Array.from(a, (v) => (Number.isNaN(v) ? null : Math.round(v * 1000) / 1000));
const ky = H.parseWzdx(F('wzdx_kytc_nky.json')), ind = H.parseWzdx(F('wzdx_indot_se.json'));
const gauges = H.parseNwps(F('nwps_gauges_cincinnati.json')), usgs = H.parseUsgs(F('usgs_iv_cincinnati.json'));
const ky8 = ky.find((z) => z.road === 'KY-8' && z.line.length > 50);
const now = Date.UTC(2026, 10, 3, 23, 30);
const along = C.corridor('ky8', ky8.line, { departAt: Date.UTC(2026, 10, 3, 12) });
const after = C.corridor('ky8-dec', ky8.line, { departAt: Date.UTC(2026, 11, 5, 12) });
// a road that crosses KY-8's line at right angles: touches it at one point, so it is not on the route
const mid = ky8.line[30], cross = C.corridor('cross', [[mid[0] - 0.01, mid[1]], [mid[0] + 0.01, mid[1]]], { departAt: Date.UTC(2026, 10, 3, 12) });
const data = { gauges, usgs, zones: { KY: ky }, harvest: {}, now };
const r = H.evaluate(along, data), rd = H.evaluate(after, data), rc = H.evaluate(cross, data);
// a flooded gauge (the Ohio at Cincinnati set to minor) and a ford after rain
const flooded = gauges.map((g) => (g.id === 'CCNO1' ? { ...g, cat: 2 } : g));
const river = C.corridor('river', [[39.0900, -84.5300], [39.0935, -84.5104], [39.0960, -84.4900]], { departAt: Date.UTC(2026, 10, 3, 12) });
const rf = H.evaluate(river, { gauges: flooded, usgs, zones: {}, harvest: {}, now });
const rn = H.evaluate(river, { gauges, usgs, zones: {}, harvest: {}, now });
const rain = new Float32Array(river.lat.length).fill(30);
const ford = { lat: river.lat[40], lon: river.lon[40] };
const rford = H.evaluate(river, { gauges, usgs, zones: {}, harvest: {}, now }, { places: { ford: [ford] }, channels: { river: { precip_48h_mm: rain } } });
const far = C.corridor('far', [[37.5, -83.0], [37.51, -83.0]], { departAt: Date.UTC(2026, 10, 3, 12) });
const rfar = H.evaluate(far, { gauges, usgs, zones: {}, harvest: {}, now });
// parks: Newfound Gap Road in the Smokies in October, the Parkway by name in February
const smokies = C.corridor('grsm', [[35.61, -83.43], [35.64, -83.45]], { departAt: Date.UTC(2026, 9, 15, 16) });
const blri = C.corridor('blri', [[36.0, -81.5], [36.01, -81.49]], { departAt: Date.UTC(2026, 1, 15, 16), extra: { edges: [{ fromM: 0, toM: 1e9, name: 'Blue Ridge Parkway' }] } });
const forest = (c, v) => ({ channels: { [c.id]: { forest_frac: new Float32Array(c.lat.length).fill(v), farmland_frac: new Float32Array(c.lat.length).fill(v) } } });
const hi = forest(smokies, 0.9); hi.channels.grsm.elev_m = new Float32Array(smokies.lat.length).fill(1500);   // Newfound Gap Road
const rs = H.evaluate(smokies, { zones: {}, harvest: {}, now }, hi), rsLow = H.evaluate(smokies, { zones: {}, harvest: {}, now }, forest(smokies, 0.9));
const rb = H.evaluate(blri, { zones: {}, harvest: {}, now });
const lt = (y, m, d) => ({ y, m, d, doy: Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1 });
const nass = H.parseNass({ data: [{ week_ending: '2026-09-27', Value: '4' }, { week_ending: '2026-10-04', Value: '18' }, { week_ending: '2026-11-01', Value: '93' }] });
// a field road in Ohio at harvest by the NASS weekly numbers, with farmland
const farmRoad = C.corridor('farm', [[40.3, -83.5], [40.31, -83.5]], { departAt: Date.UTC(2026, 9, 6, 17) });
const rh = H.evaluate(farmRoad, { zones: {}, harvest: { OH: nass }, now }, forest(farmRoad, 0.8));
console.log(JSON.stringify({
  nKy: ky.length, nInd: ind.length, detours: F('wzdx_indot_se.json').features.filter((f) => (f.properties.core_details || {}).event_type === 'detour').length,
  ky8: { closed: ky8.closed, road: ky8.road, startMs: ky8.startMs },
  closedRoads: ky.filter((z) => z.closed).map((z) => z.road),
  paving: ind.filter((z) => z.paving).map((z) => z.road),
  along: { spans: r.spans, works: nan(r.channels.works), status: r.status, note: r.note },
  after: { spans: rd.spans, works: [...new Set(nan(rd.channels.works))] },
  cross: { spans: rc.spans },
  gauges: gauges.map((g) => [g.id, g.cat, g.fcat]), usgsRise: Object.fromEntries(usgs.map((g) => [g.id, g.riseFt])),
  flooded: { spans: rf.spans, points: rf.points, max: Math.max(...nan(rf.channels.flood_risk)) },
  normal: { spans: rn.spans, risk: [...new Set(nan(rn.channels.flood_risk))] },
  ford: { spans: rford.spans, at: nan(rford.channels.flood_risk)[40] },
  far: [...new Set(nan(rfar.channels.flood_risk))],
  smokies: { busy: nan(rs.channels.park_busy)[0], spans: rs.spans.map((s) => s.kind), foliage: nan(rs.channels.foliage)[0], low: nan(rsLow.channels.foliage)[0] },
  blri: { busy: nan(rb.channels.park_busy)[0] },
  harvestTypical: { ohOct20: H.harvestTypical('OH', lt(2026, 10, 20)), ohJul: H.harvestTypical('OH', lt(2026, 7, 1)), ohSep20: H.harvestTypical('OH', lt(2026, 9, 20)), xx: H.harvestTypical('PA', lt(2026, 10, 20)) },
  nass: [H.harvestFromProgress(nass, Date.UTC(2026, 8, 28)), H.harvestFromProgress(nass, Date.UTC(2026, 9, 6)), H.harvestFromProgress(nass, Date.UTC(2026, 10, 2)), H.harvestFromProgress(nass, Date.UTC(2026, 11, 20))],
  farm: { season: nan(rh.channels.harvest_season)[0], traffic: nan(rh.channels.harvest_traffic)[0], spans: rh.spans.map((s) => s.kind) },
  peak: [H.peakDoy(40, 250), H.peakDoy(35.6, 1800), H.foliageSeason(40, 250, 293), H.foliageSeason(40, 250, 320)],
  urls: [H.nwpsUrl([38.9, -84.6, 39.2, -84.2]), H.usgsUrl([38.9, -84.6, 39.2, -84.2])],
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_wzdx_parses_both_feeds_and_drops_detours(out):
    assert out["nKy"] == 24 and out["detours"] > 0
    assert out["nInd"] == 9
    # KYTC's KY-8 in Campbell County: every lane closed → a closure
    assert out["ky8"]["closed"] and out["ky8"]["road"] == "KY-8"
    assert "KY-8" in out["closedRoads"] and "I-471" not in [r for r in out["closedRoads"] if r == "I-471"]
    assert "I-74" in out["paving"]                                  # "Night Time Construction Work, Paving Operations"


def test_a_closure_on_the_route_is_hard_while_active_only(out):
    a = out["along"]
    assert [s["kind"] for s in a["spans"]] == ["closure"] and a["spans"][0]["value"] == 2
    assert set(a["works"]) == {2}
    assert out["after"]["spans"] == [] and out["after"]["works"] == [0]   # it ended 2026-11-30: known clear, not unknown


def test_a_crossing_road_is_not_inside_the_work_zone(out):
    assert out["cross"]["spans"] == []


def test_gauges_and_flood_risk(out):
    g = dict((k, (c, f)) for k, c, f in out["gauges"])
    assert g["CCNO1"] == (0, 0)                                    # the Ohio at Cincinnati: no flooding, forecast none
    assert g["BVUK2"] == (None, None)                              # no flood stages defined: unknown, not 0
    assert out["usgsRise"]["03255000"] > 0.4                       # the Ohio rose ~0.5 ft that day
    assert out["normal"]["spans"] == [] and out["normal"]["risk"] == [0]
    f = out["flooded"]
    assert f["max"] == 0.75 and [s["kind"] for s in f["spans"]] == ["flood"]
    assert any(p["kind"] == "gauge" and "minor flooding" in p["label"] for p in f["points"])
    assert out["ford"]["at"] >= 0.6 and [s["kind"] for s in out["ford"]["spans"]] == ["low-water"]
    assert out["far"] == [None]                                    # no gauge within 15 km: unknown


def test_parks_and_fall_colour(out):
    assert out["smokies"]["busy"] == 1.51 and "park-season" in out["smokies"]["spans"]
    assert out["blri"]["busy"] == 0.42                             # matched by the road's name, February
    assert out["smokies"]["foliage"] == 0.9                        # mid-October at 1,500 m in the Smokies, canopy 0.9
    assert out["smokies"]["low"] == 0                              # the valleys peak about two weeks later
    p40, p_high, at_peak, late = out["peak"]
    assert p40 == 293 and p_high < 290 and at_peak == 1 and late == 0


def test_harvest(out):
    h = out["harvestTypical"]
    assert h["ohOct20"] == 1 and h["ohJul"] == 0 and 0 < h["ohSep20"] < 1 and h["xx"] is None
    assert out["nass"] == [0.5, 1, 0.5, None]                      # 4 % / 18 % / 93 % harvested; stale after 2 weeks
    assert out["farm"]["season"] == 1 and out["farm"]["traffic"] == 0.8 and "farm-traffic" in out["farm"]["spans"]


def test_urls_send_only_a_box(out):
    for u in out["urls"]:
        assert "-84.60" in u and "39.20" in u


def test_park_table_is_the_nps_statistics():
    """PARKS' Great Smoky Mountains row is tools/make_nps_seasonality.py over the real IRMA answer for 2023-2024."""
    spec = importlib.util.spec_from_file_location("nps", os.path.join(ROOT, "tools", "make_nps_seasonality.py"))
    nps = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(nps)
    xml = open(os.path.join(ROOT, "tests", "fixtures", "route_ctx", "nps_visitation_GRSM_2023-2024.xml"), encoding="utf-8").read()
    src = open(os.path.join(ROOT, "web", "route_ctx", "hazards_live.js"), encoding="utf-8").read()
    row = re.search(r"code: 'GRSM'.*?m: \[([^\]]+)\]", src).group(1)
    assert [float(x) for x in row.split(",")] == nps.ratios(xml)
