"""OSM route context tiles built from an extract (tools/osm_ctx/build.py): what Overpass would answer for a 0.05 degree
tile (backend/src/osm_relay.ts query()), in the relay's compact shape, in 0.25 degree bundles the Worker reads a tile of with two ranged reads."""
import gzip
import json
import os
import re
import shutil
import subprocess

import pytest

osmium = pytest.importorskip("osmium")
pytest.importorskip("shapely")
from tools.osm_ctx import build as B  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")


def write_osm(path, nodes, ways, rels=()):
    w = osmium.SimpleWriter(str(path))
    for nid, (la, lo, tags) in sorted(nodes.items()):
        w.add_node(osmium.osm.mutable.Node(id=nid, version=1, location=(lo, la), tags=tags))
    for wid, (refs, tags) in sorted(ways.items()):
        w.add_way(osmium.osm.mutable.Way(id=wid, version=1, nodes=refs, tags=tags))
    for rid, (mem, tags) in rels:
        w.add_relation(osmium.osm.mutable.Relation(id=rid, version=1, members=mem, tags=tags))
    w.close()


M = 1 / 110540   # a metre of latitude


def toy(tmp_path):
    """Main Street runs east along 39.12 from -84.54 across the tile edge at -84.50 to -84.48 (tiles 782_-1691 and
    782_-1690); a signal on it; a curve sign 30 m north of it and one 60 m north; a guard rail 10 m south; a footway (not
    drivable); a viewpoint and a fuel station in the west tile; a bicycle route over Main Street."""
    la = 39.12
    nodes = {1: (la, -84.54, {}), 2: (la, -84.52, {"highway": "traffic_signals"}), 3: (la, -84.48, {}),
             10: (la + 30 * M, -84.53, {"traffic_sign": "US:W1-2", "note": "dropped"}), 11: (la + 60 * M, -84.53, {"hazard": "curve"}),
             20: (la - 10 * M, -84.535, {}), 21: (la - 10 * M, -84.525, {}),
             30: (la + 0.01, -84.54, {}), 31: (la + 0.01, -84.53, {}),
             40: (la + 0.02, -84.53, {"tourism": "viewpoint", "name": "Overlook"}), 41: (la + 0.02, -84.52, {"amenity": "fuel", "brand": "Shell"})}
    ways = {100: ([1, 2, 3], {"highway": "secondary", "name": "Main Street", "maxspeed": "45 mph", "source": "dropped"}),
            101: ([20, 21], {"barrier": "guard_rail"}), 102: ([30, 31], {"highway": "footway"})}
    rels = [(500, ([("w", 100, ""), ("w", 102, "")], {"type": "route", "route": "bicycle", "network": "lcn", "name": "Loop"}))]
    p = tmp_path / "toy.osm.pbf"
    write_osm(p, nodes, ways, rels)
    return p


def test_a_tile_holds_what_the_query_asks_for(tmp_path):
    raw = B.read(str(toy(tmp_path)))
    west, east = (782, -1691), (782, -1690)
    built = B.tiles(raw, {west, east, (783, -1691)})
    w = built[west]["elements"]
    ids = [(e["type"], e["id"]) for e in w]
    assert ("way", 100) in ids and ("way", 102) not in ids, "drivable ways only"
    road = next(e for e in w if e["id"] == 100)
    assert road["tags"] == {"highway": "secondary", "name": "Main Street", "maxspeed": "45 mph"}, "only the tags the phone reads"
    assert road["nodes"] == [1, 2, 3] and len(road["geometry"]) == 3, "the whole way with its node ids, as out body geom"
    assert ("node", 2) in ids, "the signal on it"
    assert ("node", 10) in ids and ("node", 11) not in ids, "signs within 40 m only"
    assert next(e for e in w if e["id"] == 10)["tags"] == {"traffic_sign": "US:W1-2"}
    assert ("way", 101) in ids and "nodes" not in next(e for e in w if e["id"] == 101), "the guard rail 10 m away, tags and geometry"
    assert ("node", 40) in ids and ("node", 41) in ids, "the viewpoint and the fuel in the tile"
    k = ids.index(("relation", 500))
    assert ids[k + 1:] == [("way", 100)], "the route, then its member ways in the tile (not the footway)"
    e = built[east]["elements"]
    assert [x["id"] for x in e if x["type"] == "way" and "geometry" in x] == [100, 101] and ("node", 40) not in [(x["type"], x["id"]) for x in e]
    assert ("node", 2) in [(x["type"], x["id"]) for x in e], "a signal on a way through the tile, as node(w.r) gives"
    assert built[(783, -1691)] == {"elements": []}, "a tile with no roads is built empty, not left unknown"


def test_bundles_and_coverage(tmp_path):
    raw = B.read(str(toy(tmp_path)))
    poly = tmp_path / "x.poly"
    # a square from -84.60 to -84.45, 39.05 to 39.20: tiles wholly inside it only
    poly.write_text("x\n1\n  -84.60 39.05\n  -84.45 39.05\n  -84.45 39.20\n  -84.60 39.20\nEND\nEND\n")
    want = B.wanted((-84.75, 39.0, -84.25, 39.25), B.read_poly(str(poly)))
    assert (782, -1691) in want and (781, -1692) in want and (780, -1692) not in want and (782, -1689) not in want
    built = B.tiles(raw, want)
    files = B.write(str(tmp_path / "out"), built)
    assert sorted(os.path.basename(f) for f in files) == ["156_-338.bin", "156_-339.bin"], "0.25 degree bundles: j -1690 starts the next"
    names = []
    for f in files:
        blob = open(f, "rb").read()
        head = json.loads(blob[:B.HEAD].decode("ascii"))["t"]
        assert all(B.bundle_of(*map(int, t.split("_"))) == tuple(map(int, os.path.basename(f)[:-4].split("_"))) for t in head)
        for t, (off, n) in head.items():
            assert off >= B.HEAD and gzip.decompress(blob[off:off + n])   # each member stands alone: one ranged read
            i, j = map(int, t.split("_"))
            assert B.unpack(blob, t) == built[(i, j)]
        assert B.unpack(blob, "1_1") is None
        names += head
    assert sorted(names) == sorted(B.tile_name(i, j) for i, j in want)


def test_a_dense_bundle_header_still_fits():
    """25 tiles with offsets in the hundreds of millions still leave room in the header."""
    t = {B.tile_name(9999, -9999 + k): [10 ** 9, 10 ** 8] for k in range(25)}
    assert len(json.dumps({"t": t}, separators=(",", ":"))) < B.HEAD / 3


def test_kept_in_step_with_the_relay():
    src = open(os.path.join(ROOT, "backend", "src", "osm_relay.ts")).read()
    keep = set(re.findall(r'"([a-z_:]+)"', src[src.index("export const KEEP"):src.index("]);", src.index("export const KEEP"))]))
    assert keep == B.KEEP
    drivable = re.search(r'export const DRIVABLE = "(.+?)";', src).group(1)
    assert drivable == B.DRIVABLE.pattern
    assert "export const BUNDLE = 5," in src and B.BUNDLE == 5 and B.TILE == 0.05
    assert 'osm\\/v2\\/(index\\.json|falls\\.json|closures\\.json|-?\\d{1,4}_-?\\d{1,4}\\.bin)' in open(os.path.join(ROOT, "backend", "src", "data_store.ts")).read()
    assert f"HEAD = {B.HEAD}," in src and 'BUILT = "osm/v2"' in src


PARSE = r"""
globalThis.ApexRouteCtx = { register() {} };
const P = require(process.argv[1] + '/web/route_ctx/osm_overpass.js');
const els = P.parse(JSON.parse(process.argv[2]));
console.log(JSON.stringify(els && { ways: [...els.ways.keys()], nodes: [...els.nodes.keys()], rels: [...els.rels.values()].map((r) => [r.id, r.ways]) }));
"""


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_phone_reads_a_built_tile(tmp_path):
    raw = B.read(str(toy(tmp_path)))
    tile = B.tiles(raw, {(782, -1691)})[(782, -1691)]
    out = subprocess.run([NODE, "-e", PARSE, ROOT, json.dumps(tile)], capture_output=True, text=True)
    got = json.loads(out.stdout or "null")
    if got is None:
        pytest.skip("osm_overpass.js exposes no parse for tests: " + out.stderr[-200:])
    assert sorted(got["ways"]) == [100, 101] and 2 in got["nodes"] and 40 in got["nodes"] and got["rels"] == [[500, [100]]]


def test_the_regions_waterfalls(tmp_path):
    """tools/osm_ctx/region.py: natural=waterfall or waterway=waterfall, a node or a way at the mean of its nodes, one per
    place, kept only in the 0.25 degree cells wholly inside the .poly, which the file lists so the phone knows where it ends."""
    from tools.osm_ctx import region as F
    la = 39.12
    nodes = {1: (la, -84.54, {"natural": "waterfall", "name": " Shaker Run Falls "}), 2: (la, -84.54, {"waterway": "waterfall"}),
             3: (la + 0.01, -84.52, {}), 4: (la + 0.01, -84.50, {}), 5: (la + 0.5, -84.54, {"natural": "waterfall", "name": "Outside"}),
             6: (la, -84.53, {"tourism": "viewpoint"})}
    ways = {10: ([3, 4], {"waterway": "waterfall"})}
    p = tmp_path / "f.osm.pbf"
    write_osm(p, nodes, ways)
    got = F.read([str(p)])
    assert [(round(a, 4), round(b, 4), n) for a, b, n in got] == [(39.12, -84.54, "Shaker Run Falls"), (39.13, -84.51, None), (39.62, -84.54, "Outside")]
    poly = tmp_path / "x.poly"
    poly.write_text("x\n1\n  -84.80 38.95\n  -84.20 38.95\n  -84.20 39.30\n  -84.80 39.30\nEND\nEND\n")
    d = F.doc(got, B.read_poly(str(poly)), built="2026-11-14")
    assert d["bundle"] == 0.25 and sorted(map(tuple, d["cells"])) == [(156, -339), (156, -338)]
    assert [f[2] for f in d["falls"]] == ["Shaker Run Falls", None], "a waterfall outside the covered cells is left out"


def test_the_regions_roads_with_conditional_access(tmp_path):
    """tools/osm_ctx/region.py closures: a highway way with a conditional access key (conditional_closures.js KEYS), at the
    mean of its nodes, with those keys and its name and ref only; a non-road with the key is left out."""
    from tools.osm_ctx import region as F
    js = open(os.path.join(ROOT, "web", "conditional_closures.js")).read()
    assert set(re.search(r"const KEYS = \[(.+?)\];", js).group(1).replace("'", "").replace(" ", "").split(",")) == set(F.CKEYS)
    la = 39.12
    nodes = {1: (la, -84.54, {}), 2: (la, -84.52, {}), 3: (la + 0.01, -84.54, {}), 4: (la + 0.01, -84.52, {})}
    ways = {20: ([1, 2], {"highway": "tertiary", "name": "Gate Rd", "access:conditional": "no @ (19:00-07:00)", "surface": "asphalt"}),
            21: ([3, 4], {"leisure": "park", "access:conditional": "no @ (dusk-dawn)"})}
    p = tmp_path / "c.osm.pbf"
    write_osm(p, nodes, ways)
    got = F.read_closures([str(p)])
    assert got == [(39.12, -84.53, {"access:conditional": "no @ (19:00-07:00)", "name": "Gate Rd"})]
    poly = tmp_path / "x.poly"
    poly.write_text("x\n1\n  -84.80 38.95\n  -84.20 38.95\n  -84.20 39.30\n  -84.80 39.30\nEND\nEND\n")
    d = F.closures_doc(got, B.read_poly(str(poly)), built="2026-11-14")
    assert d["ways"] == [[39.12, -84.53, {"access:conditional": "no @ (19:00-07:00)", "name": "Gate Rd"}]] and len(d["cells"]) == 2
