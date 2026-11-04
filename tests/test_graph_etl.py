"""The graph ETL (tools/graph_etl, docs/OWN_ROUTING.md §2-3): what is drivable, chains, oneways, barriers, turn
restrictions, the per-edge features, the scorer (web/route_engine.js through tools/graph_etl/score_edges.js), and a full
build of a real piece of Colerain Township (tests/fixtures/graph/colerain_bluerock.osm.pbf: Colerain Avenue, Blue Rock
Road, Springdale Road and I-275, from the OSM API, ODbL) into v1 tiles both readers agree on."""
import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
osmium = pytest.importorskip("osmium")
from tools.graph_etl import features as F  # noqa: E402
from tools.graph_etl import osm_graph as G  # noqa: E402
from tools.graph_etl import tiles as T  # noqa: E402

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not installed")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "graph", "colerain_bluerock.osm.pbf")


# ---- tags -----------------------------------------------------------------------------------------------------------
def test_what_is_drivable():
    assert G.drivable({"highway": "residential"})["rc"] == 6
    assert G.drivable({"highway": "service", "service": "driveway"}) is None
    assert G.drivable({"highway": "service", "service": "parking_aisle"}) is None
    assert G.drivable({"highway": "service"})["use"] == G.USE_SERVICE
    assert G.drivable({"highway": "residential", "access": "private"}) is None
    assert G.drivable({"highway": "residential", "access": "no", "motor_vehicle": "yes"}) is not None
    assert G.drivable({"highway": "residential", "access": "destination"})["destination"] == 1
    assert G.drivable({"highway": "track"}) is None
    assert G.drivable({"highway": "track", "motor_vehicle": "yes"})["cls"] == 8
    assert G.drivable({"highway": "footway"}) is None
    assert G.drivable({"route": "ferry", "motor_vehicle": "yes"})["cls"] == 9
    assert G.drivable({"route": "ferry"}) is None
    m = G.drivable({"highway": "motorway_link"})
    assert m["oneway"] == 1 and m["ramp"] == 1 and m["rc"] == 0 and m["use"] == G.USE_RAMP
    assert G.drivable({"highway": "primary", "junction": "roundabout"})["oneway"] == 1
    assert G.drivable({"highway": "primary", "oneway": "-1"})["oneway"] == -1
    assert G.drivable({"highway": "motorway", "oneway": "no"})["oneway"] == 0
    a = G.drivable({"highway": "secondary", "maxspeed": "45 mph", "lanes": "4", "surface": "gravel", "sidewalk": "both"})
    assert a["maxspeed"] == pytest.approx(72.4, abs=0.1) and a["lanes"] == 2 and a["surface"] == 5 and a["sidewalk"] == 1
    b = G.drivable({"highway": "secondary"})
    assert b["maxspeed"] is None and b["lanes"] is None and b["surface"] is None and b["sidewalk"] is None   # unknown stays unknown


def test_speed_and_business_and_landuse_tags():
    assert G.parse_speed("50") == 50 and G.parse_speed("35 mph") == pytest.approx(56.3, abs=0.1)
    assert G.parse_speed("signals") is None and G.parse_speed("none") is None and G.parse_speed(None) is None
    assert G.is_business({"shop": "supermarket"}) and G.is_business({"amenity": "fast_food"}) and G.is_business({"office": "company"})
    assert not G.is_business({"amenity": "fuel", "shop": "convenience"})       # a gas station, even with its shop
    assert not G.is_business({"amenity": "cafe"}) and not G.is_business({"shop": "coffee"})
    assert not G.is_business({"amenity": "school"}) and not G.is_business({"amenity": "parking"})
    assert G.landuse_class({"landuse": "retail"}) == "retail" and G.landuse_class({"natural": "wood"}) == "forest"
    assert G.landuse_class({"leisure": "park"}) == "park" and G.landuse_class({"landuse": "farmland"}) == "farmland"
    assert G.node_kind({"highway": "traffic_signals"}) == {"signal"}
    assert G.node_kind({"barrier": "bollard"}) == {"block"} and G.node_kind({"barrier": "gate"}) == {"gate"}
    assert G.node_kind({"barrier": "gate", "access": "private"}) == {"block"}
    assert G.node_kind({"railway": "level_crossing"}) == {"level_crossing"}


# ---- a made-up network --------------------------------------------------------------------------------------------
def write_osm(path, nodes, ways, rels=()):
    w = osmium.SimpleWriter(str(path))
    for nid, (la, lo, tags) in sorted(nodes.items()):
        w.add_node(osmium.osm.mutable.Node(id=nid, version=1, location=(lo, la), tags=tags))
    for wid, (refs, tags) in sorted(ways.items()):
        w.add_way(osmium.osm.mutable.Way(id=wid, version=1, nodes=refs, tags=tags))
    for rid, (mem, tags) in enumerate(rels, 1):
        w.add_relation(osmium.osm.mutable.Relation(id=rid, version=1, members=mem, tags=tags))
    w.close()


def toy(tmp_path):
    """A road A (ways 1 + 2, same tags: one edge) crossing a road B at node 3; a one-way C drawn backwards (oneway=-1)
    from node 3; a dead-end D blocked by a bollard at node 21; a driveway joining A at node 2; a no_left_turn from A
    (way 1) onto C at node 3; a signal on A's interior node 2."""
    d = 0.001
    nodes = {1: (39.1, -84.5, {}), 2: (39.1, -84.5 + d, {"highway": "traffic_signals"}), 3: (39.1, -84.5 + 2 * d, {}),
             4: (39.1, -84.5 + 3 * d, {}), 5: (39.1 + d, -84.5 + 2 * d, {}), 6: (39.1 - d, -84.5 + 2 * d, {}),
             7: (39.1 - 2 * d, -84.5 + 2 * d, {}), 20: (39.1 + d, -84.5 + 3 * d, {}), 21: (39.1 + 1.5 * d, -84.5 + 3 * d, {"barrier": "bollard"}),
             22: (39.1 + 2 * d, -84.5 + 3 * d, {}), 30: (39.1 - 0.5 * d, -84.5 + d, {})}
    A = {"highway": "secondary", "name": "Main Street"}
    ways = {1: ([1, 2, 3], A), 2: ([3, 4], A), 3: ([5, 3], {"highway": "tertiary", "name": "Cross Road"}),
            4: ([7, 6], {"highway": "residential", "name": "Back Lane", "oneway": "-1"}), 5: ([6, 3], {"highway": "residential", "name": "Back Lane"}),
            6: ([20, 21, 22], {"highway": "residential", "name": "Dead End"}), 7: ([4, 20], {"highway": "residential", "name": "Dead End"}),
            8: ([2, 30], {"highway": "service", "service": "driveway"})}
    rels = [([("w", 1, "from"), ("n", 3, "via"), ("w", 5, "to")], {"type": "restriction", "restriction": "no_right_turn"}),
            ([("w", 1, "from"), ("w", 2, "via"), ("w", 7, "to")], {"type": "restriction", "restriction": "no_left_turn"})]
    p = tmp_path / "toy.osm.pbf"
    write_osm(p, nodes, ways, rels)
    return p


def test_chains_oneways_barriers(tmp_path):
    raw = G.read(str(toy(tmp_path)))
    assert 8 not in raw.ways                                 # the driveway isn't routable ...
    assert raw.vdeg[2] == 3                                  # ... but it joins Main Street at node 2
    chains, nodes = G.build_chains(raw)
    by = {}
    for c in chains:
        by.setdefault(c.attrs["name"], []).append(c)
    # node 2 (a signal, the driveway) is degree 2 in the graph: Main Street west of the crossing is one chain 1-2-3
    main = sorted(by["Main Street"], key=lambda c: c.nodes)
    assert [c.nodes for c in main] == [[1, 2, 3], [3, 4]]
    # way 4 was drawn against its one-way: reversed, so the chain runs 6 -> 7
    back = [c for c in by["Back Lane"] if c.attrs["oneway"]]
    assert back and back[0].nodes == [6, 7]
    # the bollard: the dead end's chains end at their own copies of node 21, so nothing passes through it
    dead = by["Dead End"]
    ends = [n for c in dead for n in (c.nodes[0], c.nodes[-1])]
    assert 21 not in ends and sum(1 for n in ends if n < 0) == 2
    assert 3 in nodes and 2 not in nodes
    g = F.Graph(raw, chains)
    kinds, full, interior, gates = F.point_counts(g)
    k = chains.index(main[0])
    assert interior[k][kinds.index("signal")] == 1
    assert full[k][-1] == 1 + 0.5 * (raw.vdeg[3] - 2)        # the driveway in full, the crossing's side roads half


@needs_node
def test_full_build_on_the_toy_applies_the_restriction(tmp_path):
    pbf = toy(tmp_path)
    out = tmp_path / "v1"
    from tools.graph_etl import build
    build.main(["--pbf", str(pbf), "--tiles=-84.51,39.09,-84.49,39.11", "--out", str(out), "--work", str(tmp_path / "w"), "--ctx", ""])
    ix = json.load(open(out / "index.json"))
    assert list(ix["tiles"]) == ["382_516"] and ix["model"]
    r = T.read_tile(open(out / "382_516.vgr", "rb").read())
    e, nd = r["edges"], r["nodes"]
    names = r["names"]
    pos = {(la, lo): i for i, (la, lo) in enumerate(zip(nd["lat"], nd["lon"]))}
    node = lambda la, lo: pos[(round(la * 1e6), round(lo * 1e6))]  # noqa: E731
    via = node(39.1, -84.498)
    assert nd["flags"][node(39.1, -84.5)] & T.N_DEAD_END
    # the one-way Back Lane: only 6 -> 7
    bl = [k for k in range(len(e["to"])) if names[e["name"][k]] == "Back Lane" and e["flags"][k] & T.ONEWAY]
    assert len(bl) == 1
    # the restriction: from Main Street's west edge arriving at node 3, onto Back Lane leaving node 3
    assert len(r["restrictions"]) == 1
    # the via-way one: Main Street west, along Main Street east (3 -> 4), onto Dead End (4 -> 20)
    (vr,) = r["via_restrictions"]
    assert names[e["name"][vr["from_edge"]]] == "Main Street" and e["to"][vr["from_edge"]] == via and not vr["only"]
    assert len(vr["via"]) == 1 and names[e["name"][vr["via"][0]]] == "Main Street" and nd["first_edge"][via] <= vr["via"][0] < nd["first_edge"][via + 1]
    assert names[e["name"][vr["to_edge"]]] == "Dead End"
    rs = r["restrictions"][0]
    frm = rs["from_edge"]
    assert e["to"][frm] == via and names[e["name"][frm]] == "Main Street" and rs["via"] == via and not rs["only"]
    to = rs["to_edge"]
    assert names[e["name"][to]] == "Back Lane" and nd["first_edge"][via] <= to < nd["first_edge"][via + 1]
    # every edge has a time and a length; the 3 m geometry ends at its nodes
    assert all(t > 0 for t in e["t_ds"]) and all(x > 0 for x in e["len_dm"])
    for k in range(len(e["to"])):
        g = r["geom"](k)
        frm_node = next(v for v in range(len(nd["lat"])) if nd["first_edge"][v] <= k < nd["first_edge"][v + 1])
        assert g[0] == (nd["lat"][frm_node], nd["lon"][frm_node])
        if e["to_tile"][k] is None:
            assert g[-1] == (nd["lat"][e["to"][k]], nd["lon"][e["to"][k]])


# ---- the scorer ---------------------------------------------------------------------------------------------------
SCORE = r"""
const S = require(process.argv[1] + '/tools/graph_etl/score_edges.js');
const recs = JSON.parse(process.argv[2]);
const src = { dem: null, grid: new Map() };
console.log(JSON.stringify(recs.map((r) => S.score(r, src))));
"""


def score(recs):
    r = subprocess.run([NODE, "-e", SCORE, ROOT, json.dumps(recs)], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def zigzag(lat=39.3, lon=-84.7, n=40, amp=0.0004, step=0.0006):
    """A line of tight bends, [lon, lat]."""
    return [[round(lon + k * step, 6), round(lat + (amp if k % 2 else -amp) * (1 if k % 4 < 2 else 0.6), 6)] for k in range(n)]


@needs_node
def test_scorer_gates_corners_by_quality_and_keeps_unknown_unknown():
    line = zigzag()
    good = {"road_class": 4, "road_use": 0, "speed_limit_kph": 89, "signals_per_km": 0, "access_per_km": 3, "business_per_km": 0}
    bad = {"road_class": 6, "road_use": 0, "speed_limit_kph": 40, "signals_per_km": 2, "access_per_km": 60, "business_per_km": 20}
    n = F.sample_count(F.cumulative([(p[1], p[0]) for p in line])[-1])
    smp_good, smp_bad = {"density": [1] * n}, {"density": [11] * n}
    recs = [{"k": 0, "c": line, "ch": good, "smp": smp_good}, {"k": 1, "c": line, "ch": bad, "smp": smp_bad},
            {"k": 2, "c": line[:3], "ch": {}, "smp": {}}]
    a, b, u = score(recs)
    assert a["q"] > 0.6 and b["q"] < 0.25
    assert a["f"] > 2 and b["f"] == 0                         # the same corners: worth nothing on a bad road
    assert a["est"] == 0 and a["v"] == 89
    assert a["t"] > 0 and b["t"] > a["t"]                     # slower limit, slower road
    assert u["q"] is None and u["c"] == 0                     # nothing known: unknown, never 0
    # a straight good road is quicker than the same length of bends
    straight = [[line[0][0] + k * 0.0006, 39.3] for k in range(40)]
    s = score([{"k": 3, "c": straight, "ch": good, "smp": smp_good}])[0]
    assert s["f"] == 0 and s["t"] < a["t"]


# ---- a real piece of Colerain Township --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def colerain(tmp_path_factory):
    if NODE is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("graph")
    from tools.graph_etl import build
    build.main(["--pbf", FIXTURE, "--tiles=-84.662,39.238,-84.598,39.258", "--out", str(d / "v1"), "--work", str(d / "w")])
    from tools.graph_etl import check
    _, tiles = check.load(str(d / "v1"))
    return d, tiles


def test_real_roads_score_as_a_driver_would(colerain):
    from tools.graph_etl import check
    _, tiles = colerain
    col = check.summarise(tiles, r"^Colerain Avenue$")
    blue = check.summarise(tiles, r"^Blue Rock Road$")
    i275 = check.summarise(tiles, r"^Circle Freeway$")
    assert col and blue and i275
    assert col["quality"] < 0.4 < 0.55 < blue["quality"]
    assert i275["cls"] == 0 and i275["speed"] >= 100 and i275["kmh"] > col["kmh"] + 30
    assert col["fun_per_km"] <= blue["fun_per_km"] + 0.5


def test_real_road_channels_survive_into_the_tiles(colerain):
    """The side-street evidence the router ranks with is in the decoded tiles: Colerain Avenue's businesses, signals,
    driveways and density well above Blue Rock Road's."""
    _, tiles = colerain

    def mean(name, ch):
        num = den = 0.0
        for _, r in tiles.values():
            e = r["edges"]
            for k in range(len(e["to"])):
                if e["name"][k] != T.NO_NAME and r["names"][e["name"][k]] == name and e["ch"][ch][k] is not None:
                    num += e["ch"][ch][k] * e["len_dm"][k]
                    den += e["len_dm"][k]
        return num / den if den else None

    for ch in ("business_per_km", "signals_per_km", "built", "density"):
        assert mean("Colerain Avenue", ch) > mean("Blue Rock Road", ch), ch
    assert mean("Colerain Avenue", "business_per_km") > 10


def test_real_features_colerain_vs_blue_rock():
    raw = G.read(FIXTURE)
    chains, _ = G.build_chains(raw)
    g = F.Graph(raw, chains)
    kinds, full, _, _ = F.point_counts(g)
    per = F.windowed(g, full, F.WINDOW_M)
    biz = F.windowed(g, F.near_counts(g, raw.pois, F.BUSINESS_M)[:, None], F.WINDOW_M)[:, 0]

    def mean(name, col):
        ks = [k for k, c in enumerate(chains) if c.attrs["name"] == name]
        L = sum(g.length[k] for k in ks)
        return sum(col[k] * g.length[k] for k in ks) / L

    sig = kinds.index("signal")
    assert mean("Colerain Avenue", biz) > 3 * max(0.5, mean("Blue Rock Road", biz))
    assert mean("Colerain Avenue", per[:, sig]) > mean("Blue Rock Road", per[:, sig])
    assert mean("Colerain Avenue", per[:, -1]) > mean("Blue Rock Road", per[:, -1])          # access per km


def test_real_tiles_both_readers_agree(colerain):
    d, tiles = colerain
    paths = [str(d / "v1" / f"{n}.vgr") for n in tiles]
    js = r"""
const G = require(process.argv[1] + '/web/graph_tiles.js'), fs = require('fs');
console.log(JSON.stringify(process.argv.slice(2).map((f) => { const b = fs.readFileSync(f), t = G.decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  return { n: t.nodes.count, e: t.edges.count, q: Array.from(t.edges.quality), t: Array.from(t.edges.t_ds), g: Array.from(t.geom(t.edges.count - 1)), r: t.restrictions.length }; })));
"""
    out = json.loads(subprocess.run([NODE, "-e", js, ROOT, *paths], capture_output=True, text=True, check=True).stdout)
    for j, (name, (_, r)) in zip(out, tiles.items()):
        assert j["n"] == len(r["nodes"]["lat"]) and j["e"] == len(r["edges"]["to"]) and j["r"] == len(r["restrictions"])
        assert j["q"] == r["edges"]["quality"] and j["t"] == r["edges"]["t_ds"]
        assert j["g"] == pytest.approx([x / 1e6 for p in r["geom"](j["e"] - 1) for x in p], abs=1e-9)
