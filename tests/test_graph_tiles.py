"""Graph tiles v1 (docs/OWN_ROUTING.md §4): tools/graph_etl/tiles.py writes, web/graph_tiles.js reads (node), and both
readers agree with what was written: nodes, CSR, every edge column, cross-tile edges, restrictions, names (UTF-8),
geometry both ways, unknowns kept unknown. Plus the shipped tiles, when there are any (web/data/graph/v1)."""
import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from tools.graph_etl import tiles as T  # noqa: E402

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not installed")

DUMP = r"""
const G = require(process.argv[1] + '/web/graph_tiles.js'), fs = require('fs');
const out = [];
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f), t = G.decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const arr = (a) => Array.from(a);
  out.push({ tile: t.tile, nodes: { lat: arr(t.nodes.lat), lon: arr(t.nodes.lon), firstEdge: arr(t.nodes.firstEdge), flags: arr(t.nodes.flags) },
    edges: Object.fromEntries(Object.entries(t.edges).map(([k, v]) => [k, typeof v === 'number' ? v : arr(v)])),
    restrictions: t.restrictions, names: t.names, geom: Array.from({ length: t.edges.count }, (_, k) => arr(t.geom(k))),
    tileOf: G.tileOf(39.1, -84.5) });
}
console.log(JSON.stringify(out));
"""


def js_decode(paths):
    r = subprocess.run([NODE, "-e", DUMP, ROOT, *paths], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def sample_tiles():
    """Two neighbouring tiles: a two-way road crossing the boundary, a one-way, a restriction, unknown scores."""
    a = T.Tile(i=381, j=516, build_day=20761, model_hash=0xDEADBEEF)
    b = T.Tile(i=382, j=516, build_day=20761, model_hash=0xDEADBEEF)
    a.lat, a.lon, a.node_flags = [39100000, 39101000, 39102000], [-84510000, -84509000, -84501000], [T.N_SIGNAL, 0, T.N_STOP | T.N_DEAD_END]
    b.lat, b.lon, b.node_flags = [39102500], [-84499000], [0]
    g0 = [(39100000, -84510000), (39100400, -84509700), (39101000, -84509000)]
    g1 = [(39101000, -84509000), (39102000, -84501000)]
    g2 = [(39102000, -84501000), (39102300, -84500100), (39102500, -84499000)]
    a.geoms = [g0, g1, g2]
    b.geoms = [list(g2)]
    E = T.Edge
    a.edges = [
        (0, E(to=1, len_dm=1234, t_ds=890, quality=0.8, scenery=0.4, fun=3.25, conf=0.9, flags=0, cls=4, speed=72, name="Blue Rock Road", geom=0, h_in=40, h_out=36)),
        (1, E(to=0, len_dm=1234, t_ds=890, quality=0.8, scenery=0.4, fun=3.25, conf=0.9, flags=T.GEOM_REV, cls=4, speed=72, name="Blue Rock Road", geom=0, h_in=164, h_out=168)),
        (1, E(to=2, len_dm=7000, t_ds=500, quality=None, scenery=None, fun=None, conf=0.0, flags=T.ONEWAY | T.SPEED_EST, cls=6, speed=40, name="Rue Café ✓", geom=1, h_in=60, h_out=60)),
        (2, E(to=0, to_tile=(382, 516), len_dm=1900, t_ds=150, quality=0.1, scenery=1.0, fun=0, conf=1.0, flags=T.BRIDGE | T.TOLL, cls=0, speed=105, geom=2)),
    ]
    a.restrictions = [T.Restriction(from_edge=0, via=1, to_edge=2, only=False)]
    b.edges = [(0, E(to=2, to_tile=(381, 516), len_dm=1900, t_ds=150, quality=0.5, scenery=0.5, fun=1, conf=0.5, flags=T.GEOM_REV | T.BRIDGE, cls=0, speed=105, geom=0))]
    b.restrictions = [T.Restriction(from_edge=3, from_tile=(381, 516), via=0, to_edge=0, only=True)]
    return a, b


def test_python_round_trip():
    a, b = sample_tiles()
    ra, rb = T.read_tile(T.write_tile(a)), T.read_tile(T.write_tile(b))
    assert (ra["i"], ra["j"], ra["build_day"], ra["model_hash"]) == (381, 516, 20761, 0xDEADBEEF)
    assert ra["nodes"]["first_edge"] == [0, 1, 3, 4]
    assert ra["nodes"]["flags"] == [T.N_SIGNAL, 0, T.N_STOP | T.N_DEAD_END]
    e = ra["edges"]
    assert e["to"] == [1, 0, 2, 0] and e["len_dm"] == [1234, 1234, 7000, 1900]
    assert e["quality"][2] == T.UNKNOWN_U8 and e["fun"][2] == T.UNKNOWN_FUN and e["conf"][2] == 0
    assert e["quality"][0] == round(0.8 * 254) and e["fun"][0] == 325 and e["conf"][3] == 255
    assert e["to_tile"] == [None, None, None, (382, 516)]
    assert ra["names"][e["name"][2]] == "Rue Café ✓" and e["name"][3] == T.NO_NAME
    assert ra["geom"](0) == a.geoms[0] and ra["geom"](1) == a.geoms[0][::-1] and ra["geom"](3) == a.geoms[2]
    assert ra["restrictions"] == [{"from_edge": 0, "via": 1, "to_edge": 2, "from_tile": None, "only": False}]
    assert rb["restrictions"][0]["from_tile"] == (381, 516) and rb["restrictions"][0]["only"]
    assert rb["geom"](0) == a.geoms[2][::-1]


def test_tile_of():
    assert T.tile_of(39.1, -84.5) == (382, 516)
    assert T.tile_of(39.0, -84.25) == (383, 516)    # on a boundary: the tile to the north-east
    assert T.tile_origin(382, 516) == (39000000, -84500000)


def test_edges_sorted_by_from_and_restrictions_remapped():
    t = T.Tile(i=0, j=0, lat=[10, 20, 30], lon=[10, 20, 30], node_flags=[0, 0, 0], geoms=[[(10, 10), (20, 20)]])
    t.edges = [(2, T.Edge(to=0)), (0, T.Edge(to=1)), (1, T.Edge(to=2))]
    t.restrictions = [T.Restriction(from_edge=1, via=1, to_edge=2)]   # caller's order: edge 1 is 0->1, edge 2 is 1->2
    r = T.read_tile(T.write_tile(t))
    assert r["edges"]["to"] == [1, 2, 0]
    assert r["restrictions"][0]["from_edge"] == 0 and r["restrictions"][0]["to_edge"] == 1


@needs_node
def test_wide_node_indices_and_quantised_geometry(tmp_path):
    """A `to` past 65535 switches the column to u32; geometry is kept in 5 µdeg steps, its ends on the nodes."""
    t = T.Tile(i=382, j=516, lat=[39100005, 39100500], lon=[-84400000, -84400700], node_flags=[0, 0],
               geoms=[[(39100003, -84400001), (39100251, -84400333), (39200000, -84300000)]])
    t.edges = [(0, T.Edge(to=70000, to_tile=(382, 517), len_dm=100, t_ds=10, geom=0)), (1, T.Edge(to=0, flags=T.GEOM_REV, geom=0))]
    p = tmp_path / "w.vgr"
    p.write_bytes(T.write_tile(t))
    r = T.read_tile(p.read_bytes())
    assert r["edges"]["to"] == [70000, 0]
    g0, g1 = r["geom"](0), r["geom"](1)
    assert g0[0] == (39100005, -84400000) and g0[1] == (39100250, -84400335) and g0[2] == (39200000, -84300000)
    assert g1[0] == (39100500, -84400700) and g1[-1] == (39100005, -84400000)     # reversed, snapped to both nodes
    (j,) = js_decode([str(p)])
    assert j["edges"]["to"] == [70000, 0]
    assert j["geom"][1] == pytest.approx([x / 1e6 for pt in g1 for x in pt], abs=1e-9)


@needs_node
def test_js_reads_what_python_wrote(tmp_path):
    a, b = sample_tiles()
    pa, pb = tmp_path / "381_516.vgr", tmp_path / "382_516.vgr"
    pa.write_bytes(T.write_tile(a))
    pb.write_bytes(T.write_tile(b))
    ja, jb = js_decode([str(pa), str(pb)])
    ra, rb = T.read_tile(pa.read_bytes()), T.read_tile(pb.read_bytes())
    for j, r in ((ja, ra), (jb, rb)):
        assert j["tile"]["i"] == r["i"] and j["tile"]["j"] == r["j"] and j["tile"]["modelHash"] == r["model_hash"]
        assert j["nodes"]["lat"] == r["nodes"]["lat"] and j["nodes"]["lon"] == r["nodes"]["lon"]
        assert j["nodes"]["firstEdge"] == r["nodes"]["first_edge"] and j["nodes"]["flags"] == r["nodes"]["flags"]
        for jk, pk in [("to", "to"), ("len_dm", "len_dm"), ("t_ds", "t_ds"), ("quality", "quality"), ("scenery", "scenery"),
                       ("fun", "fun"), ("conf", "conf"), ("flags", "flags"), ("cls", "cls"), ("speed", "speed"),
                       ("name", "name"), ("geomOff", "geom_off"), ("hIn", "h_in"), ("hOut", "h_out")]:
            assert j["edges"][jk] == r["edges"][pk], jk
        assert j["names"] == r["names"]
        for k in range(len(j["geom"])):
            want = [x / 1e6 for pt in r["geom"](k) for x in pt]
            assert j["geom"][k] == pytest.approx(want, abs=1e-9)
    key = lambda i, j: (i << 16) | j  # noqa: E731
    assert ja["edges"]["toTile"] == [key(381, 516)] * 3 + [key(382, 516)]
    assert ja["edges"]["from"] == [0, 1, 1, 2]
    assert jb["restrictions"] == [{"fromEdge": 3, "via": 0, "toEdge": 0, "fromTile": key(381, 516), "only": True}]
    assert ja["tileOf"] == {"i": 382, "j": 516}


@needs_node
def test_js_load_uses_the_index(tmp_path):
    a, _ = sample_tiles()
    d = tmp_path / "data" / "graph" / "v1"
    d.mkdir(parents=True)
    (d / "382_516.vgr").write_bytes(T.write_tile(a))
    (d / "index.json").write_text(json.dumps({"built": "2026-11-04", "tiles": {"382_516": {"bytes": 1}}}))
    js = r"""
const G = require(process.argv[1] + '/web/graph_tiles.js'), fs = require('fs'), path = require('path');
const dir = process.argv[2], asked = [];
const fetchFn = async (url) => { asked.push(url); const p = path.join(dir, url); if (!fs.existsSync(p)) return { ok: false };
  const b = fs.readFileSync(p); return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; };
(async () => {
  const t = await G.load(382, 516, { fetchFn }), none = await G.load(1, 1, { fetchFn }), again = await G.load(382, 516, { fetchFn });
  console.log(JSON.stringify({ edges: t.edges.count, none, same: t === again, asked }));
})();
"""
    r = json.loads(subprocess.run([NODE, "-e", js, ROOT, str(tmp_path)], capture_output=True, text=True, check=True).stdout)
    assert r["edges"] == 4 and r["none"] is None and r["same"]
    assert r["asked"] == ["data/graph/v1/index.json", "data/graph/v1/382_516.vgr"]   # tile 1_1 not in the index: never fetched


SHIPPED = os.path.join(ROOT, "web", "data", "graph", "v1")


@pytest.mark.skipif(not os.path.exists(os.path.join(SHIPPED, "index.json")), reason="no shipped graph tiles")
def test_shipped_tiles_decode_and_agree():
    ix = json.load(open(os.path.join(SHIPPED, "index.json")))
    assert ix["tiles"] and ix.get("model")
    for name, meta in ix["tiles"].items():
        b = open(os.path.join(SHIPPED, f"{name}.vgr"), "rb").read()
        r = T.read_tile(b)
        assert f'{r["i"]}_{r["j"]}' == name and len(b) == meta["bytes"]
        assert len(r["nodes"]["lat"]) == meta["nodes"] and len(r["edges"]["to"]) == meta["edges"]
        fe = r["nodes"]["first_edge"]
        assert fe[0] == 0 and fe[-1] == len(r["edges"]["to"]) and all(fe[k] <= fe[k + 1] for k in range(len(fe) - 1))
        # every local edge points at a node in the tile; nodes are inside the tile
        n = len(r["nodes"]["lat"])
        assert all(t < n for t, tt in zip(r["edges"]["to"], r["edges"]["to_tile"]) if tt is None)
        olat, olon = T.tile_origin(r["i"], r["j"])
        assert all(olat <= la < olat + 250000 for la in r["nodes"]["lat"])
        assert all(olon <= lo < olon + 250000 for lo in r["nodes"]["lon"])
