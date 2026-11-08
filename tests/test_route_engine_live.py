"""Calibration on LIVE captures (tests/fixtures/route_engine_live/*.json, tools/route_engine_live.js, 2026-11-04): the
candidates the app's own planner ranked on the real network, the router's routes and the stage plans it routed, with the
context every provider returned (OSM ODbL via valhalla1.openstreetmap.de and OpenFreeMap; Terrarium DEM; Open-Meteo).
The live check of #292 failed these: Colerain-Quick took Colerain Avenue, Northgate at Fun took a stage plan out along
2 km of Colerain Avenue strip mall "through forest". docs/ROUTE_ENGINE.md, Calibration."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const H = require(process.argv[1] + '/tests/route_engine_live.js');
const out = {};
for (const name of ['northgate_fun', 'colerain_quick', 'colerain_fun', 'harrison_fun', 'subdivision4_fun']) {
  const fx = H.load(name);
  for (const level of ['quick', 'fun', 'max']) {
    const r = H.rank(fx, level);
    const row = (label) => r.rows.find((x) => x.label === label) || null;
    out[name + ':' + level] = { order: r.order, quick: r.quick, why: r.why, names: r.names, top: row(r.order[0]), quickRow: row(r.quick),
      plans: H.cands(fx).filter((c) => c.kind === 'stages').map((c) => ({ label: c.label, colerain: c.route.names.get('Colerain Avenue') || 0 })) };
  }
}
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    res = subprocess.run([NODE, "-e", RUNNER, os.path.abspath(".")], capture_output=True, text=True, timeout=180, env={**os.environ, "TZ": "America/New_York"})
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


LEVELS = ("quick", "fun", "max")


def km(x, road):
    return (x["names"] or {}).get(road, 0)


def test_northgate_takes_i275_at_quick_never_at_fun(r):
    """Northgate to the I-275 / Winton Road side: the highway at Quick; Fun and Long way never drive it (the owner,
    2026-11-08: "fun should never go on the highway"). The stage plan out along Colerain Avenue (2 km of strip mall, then
    suburbs, for 3 km of Bank Road) took Fun and Max on main and stays below."""
    assert km(r["northgate_fun:quick"], "I 275") >= 5, r["northgate_fun:quick"]["names"]
    for lv in LEVELS:
        x = r[f"northgate_fun:{lv}"]
        if lv != "quick":
            assert km(x, "I 275") == 0 and not any(n.startswith("I ") for n in x["names"]), (lv, x["order"], x["names"])
        bad = [p["label"] for p in x["plans"] if p["colerain"] >= 2]
        assert bad and all(x["order"].index(b) > x["order"].index(x["order"][0]) for b in bad if b in x["order"]), (lv, x["order"])
        assert not x["why"] or "forest" not in x["why"], (lv, x["why"])


def test_colerain_avenue_only_at_quick(r):
    """Colerain Avenue (16 signals, the strip malls by Northgate) against Pippin and Struble Roads or Blue Rock Road: never
    Colerain Avenue at Fun or Long way, from either capture. Quick is the normal route (the owner, 2026-11-08): the
    quickest, Colerain Avenue, since Pippin and Struble are 1.5 min longer (over Quick's minute)."""
    for name in ("colerain_quick", "colerain_fun"):
        for lv in ("fun", "max"):
            x = r[f"{name}:{lv}"]
            assert km(x, "Colerain Avenue") < 0.5, (name, lv, x["order"], x["names"])
            assert x["order"][0] != "router1", (name, lv)
        q = r[f"{name}:quick"]
        assert q["order"][0] == q["quick"] == "router1", (name, q["order"])


def test_harrison_highway_quick_back_roads_fun(r):
    """Harrison: I-275 and I-74 at Quick; New Haven, Day, Lees Creek and Blue Rock Roads at Fun and Max."""
    assert km(r["harrison_fun:quick"], "I 275") >= 10
    for lv in ("fun", "max"):
        x = r[f"harrison_fun:{lv}"]
        assert km(x, "New Haven Road") >= 4 and km(x, "Lees Creek Road") >= 3, (lv, x["names"])
        assert x["why"] and "good corners" in x["why"], x["why"]


def test_subdivision_cut_through_only_at_quick(r):
    """4 km across Groesbeck (the subdivision case with endpoints far enough apart that the router offers more than one
    way): its quickest cuts through Cornwall and Comstock Drives, 3.5 min quicker. Quick may take it; Fun and Max take
    Miles Road and Struble Road, and the why line says why without counting corners the engine gated to nothing."""
    assert r["subdivision4_fun:quick"]["order"][0] == "router0"
    for lv in ("fun", "max"):
        x = r[f"subdivision4_fun:{lv}"]
        assert x["order"][0] == "router1" and km(x, "Cornwall Drive") == 0, (lv, x["order"])
        assert x["why"] == "Better roads than the quickest, +3 min", x["why"]


def test_every_why_line_is_true_of_the_roads(r):
    """No why line names scenery on a plan that drives more strip mall than the quickest, says it avoids strip malls when
    it drives more of them, or claims corners the gate counted as nothing."""
    for k, x in r.items():
        w, top, quick = x["why"], x["top"], x["quickRow"]
        if not w or not top or not quick:
            continue
        more_shops = (top["biz"] or 0) - (quick["biz"] or 0) >= 0.3
        if more_shops:
            assert not any(s in w for s in ("forest", "water", "ridges", "nicer country")), (k, w)
        if "strip malls" in w:
            assert (top["biz"] or 0) < (quick["biz"] or 0), (k, w, top["biz"], quick["biz"])
        if "good corners" in w:
            assert top["parts"].get("fun", 0) + top["parts"].get("gain", 0) > quick["parts"].get("fun", 0) + 1, (k, w)
