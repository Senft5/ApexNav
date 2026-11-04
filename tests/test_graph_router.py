"""Our own routing on the phone (docs/OWN_ROUTING.md §5): web/graph_router.js over graph tiles, its worker
(web/graph_worker.js) and the planner's side (web/own_routing.js). The cases run in node (tests/graph_router_cases.js) on
synthetic tiles in the decoded shape of web/graph_tiles.js, and through the real codec (tools/graph_etl/tiles.py writes,
graph_tiles.js reads) for the worker."""
import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from tests.graph_fixture import dump, write_tiles  # noqa: E402

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
CASES = os.path.join(ROOT, "tests", "graph_router_cases.js")


def case(name, *args, timeout=240):
    r = subprocess.run([NODE, CASES, name, *args], capture_output=True, text=True, timeout=timeout)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_astar_matches_brute_force_dijkstra():
    """Edge-based A* (turn costs, U-turn rule, restrictions, signals) finds exactly the optimum a brute-force Dijkstra
    finds, on 40 random graphs crossing tile edges, at three goodness weights."""
    r = case("astar")
    assert r["n"] == 720 and r["bad"] == 0, r
    assert r["found"] > 600 and r["restricted"] > 100, r


def test_restrictions_oneways_and_uturns():
    r = case("rules")
    assert r["free"] == ["South", "West"], r                         # the left at C
    assert r["noLeft"] != r["free"] and r["noLeft"][:2] != ["South", "West"], r   # no_left_turn: not that left
    assert r["onlyStraight"][:2] == ["South", "North"], r             # only_straight_on: north first
    assert "Round" in r["ab"] and r["ba"] == ["Oneway"], r            # against the one-way: round; with it: straight
    assert r["uJunction"] == "forbidden" and r["uDeadEnd"] > 0, r     # U-turns only at a dead end
    assert r["left"] > r["right"] > r["straight"] == 0, r             # a left costs more than a right
    assert r["viaFree"] == ["South", "North", "North Road"], r          # straight on, free
    assert "Loop" in r["viaNo"] and r["viaNo"][-1] == "North Road" and r["viaNo"][:2] != ["South", "North"], r   # via-way: round


def test_level_budgets_alternates_and_determinism():
    r = case("budgets")
    assert r["levelsSame"] and r["usesFunRoute"], "the same budgets as fun_route.js LEVELS"
    for t in r["trips"]:
        assert abs(t["limitS"] - t["expectLimit"]) < 1e-6, t
        assert all(x <= t["limitS"] + 1e-6 for x in t["times"]), t    # every route inside the level's budget
        assert t["same"] and t["sameShuffled"], t                     # deterministic, whatever order the tiles came in
        assert all(d >= 0.3 - 1e-9 for d in t["diffs"]), t            # alternates differ by 30 % of their length
        assert t["goodBest"] >= t["goodQuick"] - 1e-9, t              # the pick is at least as good a road as the quickest
        assert "quickest" in t["roles"], t                            # the quickest stays in the pool
    fun = [t for t in r["trips"] if t["level"] != "quick"]
    assert sum(t["alts"] for t in fun) >= 4, fun
    assert any(t["a"] > 0 and t["goodBest"] > t["goodQuick"] + 0.02 for t in fun), fun


def test_fun_never_takes_the_subdivision_or_the_strip_mall():
    """The cut-through subdivision is the quickest; Fun and Max take the back road (corners count only on good road)."""
    r = case("subdivision")
    assert "Oak Hollow Subdivision" in r["quick"]["quickest"], r
    for lv in ("fun", "max"):
        assert "Pippin Road" in r[lv]["best"], r
        assert "Oak Hollow Subdivision" not in r[lv]["best"] and "Colerain Avenue" not in r[lv]["best"], r
        assert r[lv]["timeS"] <= r[lv]["limitS"], r


def test_members_data_steers_the_search():
    """Members' data counts per stretch inside the search (not only in the final ranking): a loved, smooth, flowing lane
    wins a near-tie it lost by 2 s; signed out (no data), the search is as before."""
    r = case("crowd")
    assert r["before"] == ["Plain Lane"] and r["none"] == ["Plain Lane"], r
    assert r["after"] == ["Smooth Lane"] and r["afterA8"], r
    assert r["smoothEdges"] >= 4 and r["items"] == 2, r
    assert r["cells"] <= 16 and r["cell0"] == "392_-847", r


def test_members_data_never_holds_the_search():
    """Members' roads for the search come from the cells kept on the phone; a slow server gives the plan nothing within
    its budget and the fresh answer after it (the planner plans again with it); the next plan over the same cells has it
    at once and doesn't ask again. Signed out (no lookup): nothing."""
    r = case("crowdSoon")
    assert r["now"] is None and r["nowMs"] < 100 and r["late"] == 1, r
    assert r["now2"] == 1 and r["now2Ms"] < 50 and r["late2"] is None and r["asks"] == 1, r
    assert r["kept"] == [1, 1] and r["off"] is None, r


def test_fast_path_quick_score_preload_and_the_engine_fill():
    """The first route is our quickest alone (the same route the plan calls quickest); the preloaded tiles serve the plan
    with no more loads; the tiles' scores lie along any line (and nothing off the tiles); route_engine.js takes them for
    quality and scenery where nothing else knows, and its own channels win where they say enough."""
    r = case("fast")
    assert r["quickSame"] and r["preTiles"] >= 1, r
    assert r["loadsAfterPlan"] == r["loadsAfterPreload"], r
    assert r["known"] > 0.9 and r["outside"], r
    assert abs(r["fillQ"] - 0.7) < 1e-6 and abs(r["fillS"] - 0.6) < 1e-6 and abs(r["fillC"] - 0.8) < 1e-6, r
    assert r["strongQ"] < 0.4, r
    assert r["status"] == "ok" and r["none"] == "unavailable", r
    assert r["tableStatus"] == "ok" and r["tableAgree"] > 0.9, "our route's own edge table gives the worker's scores: " + str(r["tableAgree"])
    assert r["roadCh"][0] > 0.9 and r["roadCh"][1] > 0.9, "v2 road channels reach the engine under its own names: " + str(r["roadCh"])


def test_best_roads_nearby_from_our_tiles():
    """Explore from the tiles: the best-scored edges (quality x corners) chained into stages, timed from here by one
    search; corners on a side street (quality under 0.45) never make a stage."""
    r = case("explore")
    assert r["n"] >= 1 and r["first"] == "Twisty Road" and r["km"] >= 2 and r["good"] > 0, r
    assert r["timed"] and r["shape"], r
    assert "Subdivision Lane" not in r["names"], r


def test_offline_maneuvers():
    r = case("maneuvers")
    assert r["steps"] == [[1, "First Street"], [15, "Second Street"], [10, "Third Street"], [4, None]] or \
        [s[0] for s in r["steps"]][:2] == [1, 15], r
    assert r["steps"][0][0] == 1 and r["steps"][-1][0] == 4 and [15, "Second Street"] in r["steps"], r
    assert r["lonlat0"] == [r["coords0"][1], r["coords0"][0]], "route.coords are [lon, lat] like the router's"
    assert r["times"][0] == 0 and r["times"][-1] == round(r["timeS"]), r
    assert r["names"][:2] == ["First Street", "Second Street"], r


def test_points_routed_on_our_tiles():
    """A reroute (and a stage, a shared road, a drive again) routes through its points on our tiles, offline as well:
    through each via in order, the quickest between them; no via is the quickest; off the tiles it's Valhalla's."""
    r = case("through")
    assert r["sameAsQuickest"], r
    assert r["viaNear"] < 60 and r["toNear"] < 60 and r["longer"], r
    assert r["worker"], r
    assert r["page"] and r["page"]["source"] == "own" and r["page"]["n"] > 2 and r["page"]["steps"] >= 2 and r["page"]["timeS"], r
    assert r["off"] is None, r


def test_the_worker_makes_each_routes_geometry_as_the_page_would():
    r = case("geo")
    assert r["bare"] and r["n"] >= 2 and r["same"], r


def test_loops_come_back_round():
    r = case("loops")
    assert r["n"] >= 2, r
    for lp in r["loops"]:
        assert 8 <= lp["km"] <= 26, lp                                # about the 16 km asked
        assert lp["retraced"] < 0.35, lp
        assert lp["d0"] < 300 and lp["dN"] < 300, lp                  # from the start and back to it


def test_loops_keep_off_the_highway_and_come_from_the_best_roads():
    """The owner (2026-11-04): "it also seems to route mostly highway for loops". On a grid whose arterials are motorways
    (fast, good road, no corners), every loop at every level is built from the best roads (not a ring round the start) and
    keeps motorway to a short link: at most a fifth at Quick, a tenth at Fun and Long way (the old rings: 73-84 % at
    Quick, 11-19 % at Fun)."""
    r = case("loopsOffHighway")
    for level, cap in (("quick", 0.2), ("fun", 0.1), ("max", 0.1)):
        loops = r[level]
        assert len(loops) >= 2, (level, loops)
        for lp in loops:
            assert lp["kind"] == "stages", (level, lp)
            assert lp["hwy"] <= cap, (level, lp)
            assert lp["retraced"] < 0.4, (level, lp)
            assert lp["d0"] < 300 and lp["dN"] < 300, (level, lp)


def test_corridor_tiles_and_coverage():
    r = case("corridor")
    assert r["start"] == {"i": 381, "j": 516}, "the tiles' own grid (graph_tiles.js tileOf)"
    assert r["quick"] <= r["fun"] <= r["max"], r
    assert r["covers"] is True and r["outside"] is False, r


@pytest.fixture(scope="module")
def tile_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("graph")
    write_tiles(dump(), str(d))
    return str(d)


def test_worker_protocol_on_real_tiles(tile_dir):
    """graph_worker.js in a worker-like sandbox, loading .vgr tiles written by the ETL's writer through graph_tiles.js:
    covers, plan and loop answer by id; unknown messages and trips off the tiles answer an error; the routes are the
    same as the in-memory graph's (the codec loses nothing the router reads)."""
    r = case("worker", tile_dir)
    assert r["covers"] == {"id": 1, "covers": True} and r["outside"] == {"id": 2, "covers": False}, r
    assert r["planId"] == 3 and r["planError"] is None and r["n"] >= 2, r
    assert r["sameAsMemory"], r
    s = r["routeShape"]
    assert s["coords"] and s["lonlat"] == 2 and s["names"] and not s["edgeIdx"], s
    assert {"quality", "scenery", "fun", "conf", "a", "role", "level", "source"} <= set(s["why"]), s
    assert r["loopN"] >= 1 and r["loopError"] is None, r
    assert r["unknown"]["id"] == 5 and "unknown" in r["unknown"]["error"], r
    assert r["nowhere"], r


def test_client_worker_fallback_and_timeout():
    r = case("client")
    assert r["cov"] is True and r["n"] >= 2 and r["sent"] == ["covers", "plan"], r
    assert r["inlineSame"], "a worker that won't start: the same answer from the page"
    assert r["timeout"] == "graph router timed out" and r["none"] == "no graph router here", r


def test_planner_glue():
    """own_routing.js: our routes are candidates where tiles cover the trip; out of them, off, or failing: none, and the
    planner takes Valhalla. Online, the chosen route's instructions come from one trace_route on our own line; offline
    or slow, our own maneuvers stay."""
    r = case("glue")
    assert r["inside"] == {"reason": "ok", "n": r["inside"]["n"], "kinds": ["own"], "names": True, "timeS": True, "via": []} and r["inside"]["n"] >= 2, r
    assert r["out"] == "out" and r["outN"] == 0 and r["off"] == "off" and r["broken"] == ["failed", "boom"], r
    assert r["online"] == "valhalla" and r["onlineSteps"] == ["Valhalla Street"] and r["bodies"] == 1, r
    assert r["shapeMatch"] == "map_snap" and r["sameLine"], r
    assert r["offline"] == "own" and r["offlineSteps"] and r["slow"] == "own", r
    assert r["onFlags"] == [False, False, True], "the server flag and the phone's switch both turn it off"
    assert abs(r["clock"][0] - 0.9) < 1e-9 and r["clock"][1] and r["clock"][2] is None, "one clock in the pool: " + str(r["clock"])


def test_performance_on_a_cincinnati_size_network():
    """16 tiles, about 150k edges (the Cincinnati area): a query under 300 ms in node, a whole Fun plan under 1 s."""
    r = case("perf", timeout=600)
    assert r["tiles"] == 16 and 140000 <= r["edges"] <= 190000, r
    worst = max(q["ms"] for q in r["queries"])
    assert worst < 300, r["queries"]
    fun = [p for p in r["plans"] if p["level"] == "fun"]
    assert max(p["ms"] for p in fun) < 1000, r["plans"]
    print(json.dumps({"viewMs": r["viewMs"], "queries": r["queries"], "plans": r["plans"]}))
