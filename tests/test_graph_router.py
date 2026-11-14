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


def test_a_gate_on_a_through_road_is_open():
    """2026-11-14 (tools/famous_roads.js): the Blue Ridge Parkway's winter gates (16 between Blowing Rock and Linville
    Falls), Beartooth's and Angeles Crest's each cost the private-road toll, so Fun and Long way went round them. A gate
    on tertiary and up is open; on a residential street, or with access private, it still blocks."""
    r = case("gates")
    assert r["secondary"] == ["Gated"] and r["tertiary"] == ["Gated"], r
    assert "Detour" in r["residential"] and r["privateSecondary"] == ["Detour"], r


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


def test_each_level_spends_its_budget_on_better_road():
    """The levels audit (2026-11-08): Long way returned Fun's route on every trip, the bisection capped at A_MAX with
    budget left. Now a level picks by the goodness its extra time buys: Fun the good road near the quickest way, Long way
    the better road further off (here reached over a short rough stretch that t x exp(a x bad) shuns at every weight)."""
    r = case("levelSpread")["spread"]
    assert r["quick"]["best"] == ["Main Street"], r["quick"]
    assert r["fun"]["best"] == ["Mill Road"], r["fun"]
    assert "Ridge Road" in r["max"]["best"] and "Mill Road" not in r["max"]["best"], r["max"]
    assert r["max"]["best"] != r["fun"]["best"], "Long way is not Fun's route where a better road is inside its budget"
    assert r["max"]["goodness"] > r["fun"]["goodness"] + 0.02, (r["fun"], r["max"])
    for lv in ("fun", "max"):
        assert r[lv]["timeS"] <= r[lv]["limitS"], r[lv]
    assert r["fun"]["limitS"] < r["max"]["timeS"], "the far road is outside Fun's budget"


def test_no_level_lengthens_a_trip_with_no_good_road():
    """A longer way that's hardly better (a plain street for +35 % time) is not worth the time at Fun or Long way: the
    quickest stays the pick, and the longer way stays in the pool for the ranking."""
    r = case("levelSpread")["none"]
    for lv in ("fun", "max"):
        x = r[lv]
        assert x["best"] == ["Main Street"], x
        assert x["timeS"] == x["quickS"] and x["role"] == "quickest", x
        assert "Elm Drive" in x["all"], x                           # found, offered to the ranking, not the pick
        k = x["all"].index("Elm Drive")
        assert x["goods"][k] > x["goodness"], x                      # it is a little better, only not enough for its time


def test_the_pick_weighs_the_road_length_as_the_engine_does():
    """G is a length-weighted mean, so a longer way's extra side street thins out in it, and so does its extra good road;
    the route engine pays for every km of both (2026-11-08, engine-rank). On route summaries shaped like the audit's
    trips: Long way doesn't buy G with more subdivision than a shorter way drives (subdivision4's 17 min), Fun doesn't
    take a strip mall's G (colerain's 20 min), Long way does take 11 km more of the best road (colerain's 32 min) and
    10 km more good road for 10 min (harrison's 42 min), and a trip with no good road stays the quickest."""
    r = case("levelRoad")
    assert r["subdivisionLike"] == {"fun": "A", "max": "A"}, r
    assert r["colerainLike"] == {"fun": "A", "max": "C"}, r
    assert r["harrisonLike"] == {"fun": "A", "max": "D"}, r
    assert r["noGoodRoad"] == {"fun": "base", "max": "base"}, r


def test_members_data_steers_the_search():
    """Members' data counts per stretch inside the search (not only in the final ranking): a loved, smooth, flowing lane
    wins a near-tie it lost by 2 s; signed out (no data), the search is as before."""
    r = case("crowd")
    assert r["before"] == ["Plain Lane"] and r["none"] == ["Plain Lane"], r
    assert r["after"] == ["Smooth Lane"] and r["afterA8"], r
    assert r["smoothEdges"] >= 4 and r["items"] == 2, r
    assert r["cells"] <= 16 and r["cell0"] == "392_-847", r


def test_measured_crests_and_verified_bumps_steer_the_search():
    """Crests members measured (two passes or more) make a lane win a 1 s near-tie; one pass of crest data counts nothing;
    crowd-verified bumps on the crested lane hand the tie back, unverified ones (posterior 0.6) change nothing, and
    verified bumps on the other lane leave the crested lane the pick."""
    r = case("crowdCrestBump")
    assert r["none"]["road"] == ["Flat Lane"], r
    assert r["crest"]["road"] == ["Crest Lane"] and r["crest"]["edges"] >= 4 and r["crest"]["crestMax"] > 0, r
    assert r["onePass"]["road"] == ["Flat Lane"] and r["onePass"]["edges"] == 0, r
    assert r["crestBumps"]["road"] == ["Flat Lane"] and r["crestBumps"]["bumps"] == 6, r
    assert r["weakBumps"]["road"] == ["Crest Lane"] and r["weakBumps"]["bumps"] == 0, r
    assert r["otherBumps"]["road"] == ["Crest Lane"] and r["otherBumps"]["bumps"] == 6, r


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


def test_best_roads_nearby_never_a_neighbourhood_or_a_dead_end():
    """The owner's report: Best roads nearby's top pick was a residential neighbourhood. A curvy subdivision street with
    more corners than the back road (and a tile quality that calls it good) is never a stage; nor is a short twisty road
    that only leads to its own dead end (under 3 km), while a long one stays; a county lane tagged residential with no
    houses beside it stays a road."""
    r = case("exploreRoads")
    assert r["first"] == "Twisty Road", r
    assert r["loops"] >= 1 and not {"Maple Court", "Long Hollow Road"} & set(r["loopStages"]), r
    assert r["spurCut"], "the dead-end spur past the twisty road's last junction is cut back: " + str(r)
    assert "Maple Court" not in r["names"] and "Spur Road" not in r["names"], r
    assert "Creek Lane" in r["names"], "class alone never decides: " + str(r)
    # a long good rural road that ends (3 km or more of it past the last junction) stays: worth driving there and back
    assert r["longHollow"] and r["longHollow"]["deadEnd"] and r["longHollow"]["km"] >= 3, r
    assert r["street"] == [True, False, None], "the subdivision is a street, the lane isn't, and class alone is unknown"
    assert "Maple Court" in r["v1names"], "a v1 tile knows nothing beside the road: the tile's quality decides, no guess"


@pytest.mark.parametrize("place", ["devou_park", "mount_airy_forest"])
def test_best_roads_nearby_on_the_real_tiles(place):
    """Two public places on the Cincinnati tiles: the map's stage search ranked with our tiles' context (cockpit.js where
    the tiles cover you and our own search found nothing) and our own search. Neither lists a neighbourhood (our tiles:
    density 6+ or residential class, with 40+ houses per km), at the top or anywhere. Before the fix Devou Park's top pick
    was Parkway Avenue through Kenton Hills (74 houses per km, density 10) and Mount Airy's list had Lafayette Avenue
    through Clifton, the road the owner was shown."""
    r = case("bestRoadsReal")[place]
    assert r["list"], r
    assert not [s for s in r["list"] if s["neighbourhood"]], r["list"]
    assert not [s for s in r["own"] if s["neighbourhood"]], r["own"]
    if place == "devou_park":
        assert r["list"][0]["name"] == "Petersburg Road", r["list"]
    else:
        assert ["Lafayette Avenue", "street"] in r["dropped"] and "Lafayette Avenue" not in [s["name"] for s in r["list"]], r
        assert r["list"][0]["name"] == "Miles Road", r["list"]


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


def test_plan_reuses_the_first_routes_search_with_the_same_answer():
    """The plan asked right behind the first route, on the same view, reuses its time-only search: the routes are the
    same as a plan made from scratch, with a heading, avoid choices and prefs; another trip doesn't reuse it."""
    r = case("quickMemo")
    assert all(x["same"] and x["memo"] for x in r["out"]), r
    assert r["other"], r


def test_posted_limits_on_our_routes_from_the_tiles():
    """The limit sign and the ETA's limits on one of our routes come from the tiles it was planned on (offline too, no
    Valhalla map matching): each sample gets its edge's posted limit, an edge with none (or only the class's estimate)
    is null, a loop with a spur cut out still lines up, and a line that isn't ours gets nothing (Valhalla's turn)."""
    r = case("limits")
    assert r["n"] > 100 and r["agree"] == r["n"], r
    assert r["posted"] > 0 and r["wantNull"] > 0 and r["nulls"] > 0, r
    assert r["sameCut"], r
    assert r["noTable"] is None and r["ofLine"] and r["notOurs"] is None, r


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
    # Fun and Long way (the owner, 2026-11-08): never a motorway where a loop can keep off it; a stage only reachable over
    # the motorway (a pocket the grid's holes cut off) takes the one shortest link, never more
    for level in ("fun", "max"):
        assert sum(lp["hwy"] == 0 for lp in r[level]) >= 3, (level, r[level])
        assert all(lp["hwy"] * lp["km"] <= 0.6 for lp in r[level]), (level, r[level])


def test_fun_and_long_way_never_take_the_highway():
    """The owner, 2026-11-08: "fun should never go on the highway. Quick should essentially be a normal route". A motorway
    and a trunk road beside a curvy back road: Quick drives the motorway; Fun and Long way the back road, in the plan, its
    first route (quickest) and a reroute (through), with the highway quickest still in the pool as the measure."""
    r = case("levelsHighway")["one"]
    q = r["quick"]
    assert q["bestHwyM"] > 9000 and q["mode"] == "any" and q["quickestHwyM"] > 9000 and q["throughHwyM"] > 9000, q
    assert abs(q["limitS"] - (q["quickS"] + 60)) < 1e-6, "Quick: the quickest, a nicer road within a minute at most"
    for lv in ("fun", "max"):
        x = r[lv]
        assert x["mode"] == "free" and x["bestHwyM"] == 0 and x["hwyKm"] == 0, (lv, x)
        assert x["best"] == ["Start Lane", "Back Road", "End Lane"] and "US-52" not in x["best"], (lv, x["best"])
        assert all(m == 0 for m in x["others"]), "no route of the level's drives a motorway or trunk road"
        assert x["quickestHwyM"] == 0 and x["throughHwyM"] == 0, x
        assert x["hasQuick"] and x["quickHwyM"] > 9000, "the highway quickest stays in the pool: Quick's card, the level's measure"
        assert x["limitS"] >= x["timeS"], "the budget never shuts out the highway-free way"


def test_the_highway_exception_takes_the_shortest_link_and_says_why():
    """A river crossed only by I-275's bridge: Fun and Long way drive River Road to the bridge's ramp, the bridge and the
    ramp off (1.7 km), not I-275 from the start (5.3 km, Quick's way), and the card says so; a car on I-275 rerouted at
    Fun leaves it by the shortest way ("you start on it")."""
    r = case("levelsHighway")["river"]
    assert r["quick"]["mode"] == "any" and r["quick"]["hwyKm"] > 5, r["quick"]
    for lv in ("fun", "max"):
        x = r[lv]
        assert x["mode"] == "link" and x["reason"] == "across" and x["hwyName"] == "I-275", (lv, x)
        assert 1.5 < x["hwyKm"] < 1.8 and "River Road" in x["names"], (lv, x)
        assert all(k <= x["hwyKm"] + 1e-6 for k in x["others"]), (lv, x)
    assert r["onIt"]["reason"] == "start", r["onIt"]
    assert r["why"] == "Uses 1.1 mi of I-275 (no other way across)", r["why"]


def test_no_highway_free_way_in_a_sensible_time():
    """The only way without the motorway is three times as long: Fun still keeps off it (the hard rule), plans nothing
    longer, and the card says Quick is the way; Quick takes the motorway."""
    r = case("levelsHighway")["absurd"]
    assert r["absurd"] and r["mode"] == "free" and r["hwyKm"] == 0 and r["ratio"] > 2, r
    assert r["names"] == ["Start Lane", "Loop Road", "End Lane"] and r["routes"] == 2, r
    assert r["rankHwy"] == [0] and r["rankAbsurd"] == [True], r
    assert r["why"] == "No highway-free way in a sensible time; Quick is the way", r["why"]
    assert r["quickPick"] > 8, "Quick: the motorway"


def test_an_expressway_below_trunk_class_is_a_highway_to_the_levels():
    """A limited-access expressway mapped as `primary` (motorroad=yes / expressway=yes: the tiles' expressway flag) beside
    a plain back road. Flagged: Quick drives it, Fun and Long way never (the plan, its first route, every route of the
    level's), and the route's highway km count it. Unflagged (tiles built before the flag): a road like any other."""
    r = case("expressway")
    f, p = r["flagged"], r["plain"]
    assert f["isHwy"] == 6 and p["isHwy"] == 0, (f["isHwy"], p["isHwy"])
    assert "OH-126" in f["quick"]["best"] and f["quick"]["mode"] == "any" and f["quick"]["hwyKm"] > 9, f["quick"]
    for lv in ("fun", "max"):
        x = f[lv]
        assert x["mode"] == "free" and x["hwyKm"] == 0 and "OH-126" not in x["best"] and "OH-126" not in x["quickest"], (lv, x)
        assert all(k == 0 for k in x["others"]) and x["quickHwyKm"] > 9, (lv, x)
        assert "OH-126" in p[lv]["quickest"] and p[lv]["hwyKm"] == 0 and p[lv]["mode"] == "free", (lv, p[lv])


def test_quick_is_the_quickest():
    """Quick is the normal route: on the city grid its budget is the quickest + 60 s and nothing it offers is slower."""
    r = case("levelsHighway")["quick"]
    assert abs(r["limitS"] - (r["quickS"] + 60)) < 1e-6 and r["over"] <= 60 + 1e-6 and r["mode"] == "any", r


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
    assert r["funWait"] == "waiting" and r["maxWait"] == "waiting", "Fun and Long way outlast the page's own timeout"


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


def test_avoid_police_reports_keeps_off_the_road_by_a_report():
    """Avoid police reports (graph_router.js objectiveOf, AVOID_POINT_X): the roads within 150 m of a live report cost x8,
    so the quickest and the plan's routes go round one on the quickest's middle, for a little more time; off, the
    points are ignored."""
    r = case("avoidPolice")
    assert r["baseNear"] < 20, r
    assert r["quickNear"] > 150 and r["quickS"] > r["baseS"], r
    assert r["planNear"] and all(d > 150 for d in r["planNear"]), r
    assert r["offNear"] < 20, r


def test_avoid_cameras_keeps_off_the_road_a_camera_is_on():
    """Avoid cameras (graph_router.js AVOID_CAM_X): the edges within 35 m of a plate reader or speed camera cost x8, so our
    own routes go round one the way Valhalla's do (exclude_locations); off, or no camera list, nothing changes."""
    r = case("avoidCameras")
    assert r["baseNear"] < 20, r
    assert r["quickNear"] > 35 and r["quickS"] > r["baseS"], r
    assert r["planNear"] and all(d > 35 for d in r["planNear"]), r
    assert r["offNear"] < 20 and r["noneS"] == r["baseS"], r
    assert r["max1"] == 8 and r["max2"] == 8, r          # two cameras on one road: x8 once, not x64


def test_reported_closures_keep_our_routes_and_loops_off_the_road():
    """Members' "Road closed" reports (graph_router.js CLOSED_X, avoid.closed): the edges within 40 m of one cost x50,
    always (no switch), so our quickest and plan go round it now that Fun and Long way never ask Valhalla; two on one road
    cost x50 once. Loops take the avoid lists too: a camera on the best loop sends the loops off that road."""
    r = case("closures")
    assert r["baseNear"] < 20, r
    assert r["quickNear"] > 40 and r["quickS"] > r["baseS"], r
    assert r["planNear"] and all(d > 40 for d in r["planNear"]), r
    assert r["max1"] == 50 and r["max2"] == 50, r
    assert r["loop0Near"] < 20, r
    assert r["loopNear"] and all(d > 35 for d in r["loopNear"]), r


def test_confirmed_road_hazards_nudge_the_search():
    """Members' confirmed pothole, gravel and debris reports (graph_router.js HAZARD_X, avoid.hazards): the edges within
    30 m of one cost x1.3, always (no switch), once however many sit on a road; a nudge, not a closure, so the quickest
    still drives one when the way round costs more; a report far from any road changes nothing."""
    r = case("hazards")
    assert r["baseNear"] < 20, r
    assert abs(r["r1"]["m"] - 1.3) < 1e-3 and abs(r["r2"]["m"] - 1.3) < 1e-3, r
    assert 0 < r["r1"]["n"] <= 12 and r["r2"]["n"] == r["r1"]["n"], r
    assert r["quickS"] >= r["baseS"] and r["quickS"] < r["baseS"] * 1.3, r
    assert r["farMax"] == 1, r


def test_corner_prefs_steer_the_search_to_the_corners_asked_for():
    """Plan -> Hairpins and Sweepers fewer/more (IDEAS R-19) in our router's search, not only the ranking: each edge's fun
    counts up to 60 % more or less by its share of tight (radius under 40 m) and fast (100 to 260 m) turning, read from
    the tiles' geometry (graph_router.js cornerMix, only when a pref is set). Two roads alike but for their corners: the
    one asked for is planned, either way round; with no pref they cost the same."""
    r = case("cornerPrefs")
    assert r["mixBefore"] is None, "no pref, no geometry pass"
    assert r["hpTight"] > 0.6 and r["hpFast"] < 0.2 and r["swFast"] > 0.8 and r["swTight"] < 0.2, r
    assert r["bad0"]["hp"] == r["bad0"]["sw"], r
    assert r["badTight"]["hp"] < r["badTight"]["sw"] and r["badFast"]["sw"] < r["badFast"]["hp"], r
    assert all(0 <= x <= 1 for k in ("badTight", "badFast") for x in r[k].values()), "goodness stays inside 0..1"
    for k, road, other in (("tight", "Hairpin Road", "Sweeper Road"), ("tightOnly", "Hairpin Road", "Sweeper Road"),
                           ("fast", "Sweeper Road", "Hairpin Road"), ("fastOnly", "Sweeper Road", "Hairpin Road")):
        assert road in r[k] and other not in r[k], (k, r[k])
    # Best roads nearby, and so the stages a loop is built from, rank by the prefs too
    assert r["exploreTight"][0] == "Hairpin Road" and r["exploreFast"][0] == "Sweeper Road", r


def test_map_stages_are_timed_on_our_tiles():
    """Best roads nearby with highlights on uses the map's own stage search; their drive times now come from our tiles
    where they cover you (graph_router.js times, host type 'times'), not Valhalla's matrix: a point by a road gets the
    reach's time (no turn costs, so no more than the quickest), a point with no road near it or past maxS none."""
    r = case("times")
    t, field, bad = r["times"]
    assert t is not None and 0 < t <= r["quickS"] + 1, r
    assert field is None and bad is None and r["tight"] == [None], r
    assert r["host"] == [t], r


def test_explore_times_the_map_stages_on_our_tiles_first():
    src = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    i = src.index("const ownTimes = async (targets) => {")
    b = src[i:src.index("lastExploreTimes", i)]
    assert "ownRouter().covers([c])" in b and "ownRouter().times(" in b
    assert "(await ownTimes(FunRoute.exploreTargets(list))) || await valhallaMatrix([c], FunRoute.exploreTargets(list))" in b


def test_there_and_back_comes_home_by_other_road():
    """There and back (graph_router.js roundTrip): to a destination and home again, the way back costing the way out x4 both
    ways, so a round trip drives little of itself twice; at Fun and Long way the way home buys good road as a plan does;
    each starts and ends at home and passes the destination. A dead-end valley, the one way in, is still offered, said as
    driven twice."""
    r = case("roundTrips")
    for level in ("quick", "fun", "max"):
        trips = r[level]["trips"]
        assert len(trips) >= 2, (level, trips)
        assert r[level]["ms"] < 2000, r[level]["ms"]
        for t in trips:
            assert t["kind"] == "round" and t["role"] == "round", t
            assert t["retraced"] <= 0.2, (level, t)
            assert t["d0"] < 300 and t["dN"] < 300, (level, t)          # from home and back to it
            assert t["reaches"] < 300, (level, t)                       # through the destination
            assert abs(t["timeS"] - t["outS"] - t["backS"]) < 1, t      # the stop at the destination is not a manoeuvre
    quick_best = min(t["backS"] for t in r["quick"]["trips"])
    assert max(t["backS"] for t in r["fun"]["trips"]) > quick_best      # Fun's way home spends time on good road
    assert r["fun"]["trips"][0]["retraced"] <= r["fun"]["trips"][-1]["retraced"] + 0.2
    assert r["deadEnd"] and r["deadEnd"][0]["retraced"] > 0.9, r["deadEnd"]


def test_loops_land_near_the_length_asked_on_real_tiles():
    for c in case("loopLengthReal"):
        assert c["offs"], c
        assert min(abs(o) for o in c["offs"]) <= 0.2, c
        assert all(abs(o) <= 0.6 for o in c["offs"]) and all(r <= 0.4 for r in c["retraced"]), c
