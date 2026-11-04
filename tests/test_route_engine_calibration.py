"""Calibration on REAL routes around Cincinnati (tests/fixtures/route_engine/*.json, captured by
tools/route_engine_fixtures.js from valhalla1.openstreetmap.de, the Terrarium DEM and the OpenFreeMap poi layer; OSM ODbL).
Each case is one of the owner's bad cases or the repo's fixture drive, and asserts the order a driver would pick
(docs/ROUTE_ENGINE.md §Calibration). The old ranking's order is asserted too where it was wrong, so the fix is visible."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const H = require(process.argv[1] + '/tests/route_engine_harness.js');
const out = {};
for (const c of ['subdivision', 'northgate', 'colerain', 'harrison']) for (const l of ['quick', 'fun', 'max']) out[c + ':' + l] = H.compare(c, l);
// degraded: each source missing in turn, and all of them (the old ranking)
for (const skip of [['router'], ['dem'], ['business'], ['router', 'dem', 'business']]) out['colerain:quick:-' + skip.join('+')] = H.compare('colerain', 'quick', { skip });
out['harrison:fun:none'] = H.compare('harrison', 'fun', { noContext: true });
// the real 35 mph country stretches on the Harrison back roads (posted 56 km/h, density 2 or less)
{
  const [c] = H.cands('harrison', { only: ['router0'] });
  const smp = H.Engine.samples(c.corridor, c.ctx), lim = c.ctx.channels.speed_limit_kph, den = c.ctx.channels.density, biz = c.ctx.channels.business_per_km;
  // open country: no more than a farm stand or two beside it (the last 300 m reach Harrison's edge: shops, 26 driveways a km)
  const q = []; for (let i = 0; i < smp.n; i++) if (lim[i] === 56 && den[i] <= 2 && biz[i] < 3) q.push(smp.quality[i]);
  out.rural35 = { n: q.length, min: Math.min(...q), gate: Math.min(...q.map(H.Engine.gate)) };
}
// the DEM along the real roads: Harrison's back roads are hill country beside the Great Miami and Whitewater valleys
const fx = H.load('harrison');
out.dem = Object.fromEntries(fx.candidates.map((c) => {
  const e = c.dem.elev_m.filter((v) => v != null), rel = c.dem.relief_m.filter((v) => v != null);
  return [c.label, { status: c.dem.status, min: Math.min(...e), max: Math.max(...e), relief: rel.reduce((a, b) => a + b, 0) / rel.length }];
}));
(async () => {
  // with C's context grid (the real Cincinnati bundles in web/data/ctx/v1) on every candidate
  for (const c of ['subdivision', 'northgate', 'colerain', 'harrison']) for (const l of ['quick', 'fun', 'max']) out['grid:' + c + ':' + l] = await H.compareGrid(c, l);
  const without = async (level, ch) => { const list = H.cands('colerain'); await H.addGrid(list); for (const x of list) { delete x.ctx.channels[ch]; x.ev = null; } return H.compare('colerain', level, { list }); };
  out['grid:colerain:fun:-aadt'] = await without('fun', 'aadt');
  out['grid:colerain:fun:-noise'] = await without('fun', 'noise_db');
  process.stdout.write(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def r():
    res = subprocess.run([NODE, "-e", RUNNER, os.path.abspath(".")], capture_output=True, text=True, timeout=120, env={**os.environ, "TZ": "America/New_York"})
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_subdivision_cut_through_never_wins(r):
    """Menominee Drive: five good corners in 1.3 km of subdivision. The old ranking took it at Fun and Max."""
    for lv in ("quick", "fun", "max"):
        assert r[f"subdivision:{lv}"]["engine"][0] == "router0", (lv, r[f"subdivision:{lv}"])
    assert r["subdivision:fun"]["old"][0] == "subdivision", "the bug this fixes"
    p = r["subdivision:fun"]["parts"]["subdivision"]
    assert p["good"] == 0 and p["rawGood"] >= 6, "its corners are on side streets: gated to nothing"


def test_highway_beats_the_suburban_arterial(r):
    """Northgate → NE: Springdale and Mill Roads (the router's own costing) vs I-275, quicker and far fewer driveways."""
    for lv in ("quick", "fun", "max"):
        assert r[f"northgate:{lv}"]["engine"][0] == "highway", (lv, r[f"northgate:{lv}"]["engine"])
    assert r["northgate:fun"]["old"][0] == "router1", "the old ranking took Pippin and Kemper Roads for 3 corners"


def test_strip_mall_arterial_loses_to_quieter_roads(r):
    """Colerain Avenue (18 signals, 244 businesses beside it) vs Pippin and Struble Roads, 1.4 min longer."""
    for lv in ("quick", "fun", "max"):
        assert r[f"colerain:{lv}"]["engine"][0] in ("router0", "router2"), (lv, r[f"colerain:{lv}"]["engine"])
        e = r[f"colerain:{lv}"]["engine"]
        assert e.index("router1") > e.index("router0"), "Colerain Avenue (also the highway costing's answer) ranks below Pippin Road"
    assert r["colerain:quick"]["old"][0] in ("router1", "highway")
    assert "signals" in r["colerain:quick"]["why"] or "strip malls" in r["colerain:quick"]["why"], r["colerain:quick"]["why"]


def test_back_roads_at_fun_highway_at_quick(r):
    """Harrison (the fixture drive's country): I-275/I-74 22 min vs Lees Creek and Day Roads 26 min."""
    assert r["harrison:quick"]["engine"][0] == "highway"
    assert r["harrison:fun"]["engine"][0] == "router0" and r["harrison:max"]["engine"][0] == "router0"
    assert r["harrison:fun"]["engine"][-1] == "highway"
    w = r["harrison:fun"]["why"]
    assert "more good corners" in w and w.endswith("+4 min"), w


def test_each_source_missing_degrades_gracefully(r):
    for skip in ("router", "dem", "business"):
        d = r[f"colerain:quick:-{skip}"]
        assert d["engine"], skip
    # without the router's edges the businesses alone still keep Colerain Avenue off the top
    assert r["colerain:quick:-router"]["engine"][0] != "router1"
    allgone = r["colerain:quick:-router+dem+business"]
    assert allgone["engine"] == allgone["old"], "no context at all: exactly the old ranking"
    assert r["harrison:fun:none"]["engine"] == r["harrison:fun:none"]["old"]


def test_confidence_is_reported(r):
    for case in ("colerain:fun", "harrison:fun"):
        for label, p in r[case]["parts"].items():
            assert 0.2 <= p["conf"] <= 0.6, (case, label, p["conf"])


def test_dem_along_real_roads(r):
    for label, d in r["dem"].items():
        assert d["status"] == "ok", label
        assert 140 < d["min"] < d["max"] < 320, (label, d)
    assert r["dem"]["router0"]["relief"] > 40, "hill country"


def test_picks_hold_with_the_context_grid(r):
    """C's national grid (night lights, impervious, canopy, noise, AADT, IRI, HPMS limits, fatal crashes, flood zones…) on."""
    for lv in ("quick", "fun", "max"):
        assert r[f"grid:subdivision:{lv}"]["engine"][0] == "router0"
        assert r[f"grid:northgate:{lv}"]["engine"][0] == "highway", "AADT, noise and crashes per km don't count against a motorway"
        e = r[f"grid:colerain:{lv}"]["engine"]
        assert e[0] in ("router0", "router2") and e.index("router1") > e.index("router0")
    assert r["grid:harrison:quick"]["engine"][0] == "highway" and r["grid:harrison:fun"]["engine"][0] == "router0"
    assert all(s == "ok" for k, v in r.items() if k.startswith("grid:") and "gridStatus" in v for s in v["gridStatus"])


def test_grid_channels_change_close_picks(r):
    """Colerain at Fun: Pippin and Struble Roads vs Blue Rock Road, a close call. The grid's traffic counts (AADT) and road
    noise say Blue Rock carries more traffic: Pippin stays ahead; without either, Blue Rock wins. At Max fun Blue Rock's
    corners and country carry it either way."""
    assert r["grid:colerain:fun"]["engine"][0] == "router0"
    assert r["grid:colerain:fun:-noise"]["engine"][0] == "router2" and r["grid:colerain:fun:-aadt"]["engine"][0] == "router2"
    assert r["grid:colerain:max"]["engine"][0] == "router2"

def test_real_35_mph_country_road_keeps_its_corners(r):
    """Lees Creek and Day Roads near Harrison are posted 35 mph in open country: a low limit there is the road's character."""
    x = r["rural35"]
    assert x["n"] > 50, x
    assert x["min"] >= 0.55 and x["gate"] >= 0.85, x
