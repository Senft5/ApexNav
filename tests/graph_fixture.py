"""Synthetic graph tiles written by the real writer (tools/graph_etl/tiles.py), for the router's worker test and the
own-routing e2e flows: tests/graph_router_harness.js makes a city-like grid, this writes one .vgr per tile and index.json.

    python3 tests/graph_fixture.py <out dir> [seed nx ny stepDeg lat0 lon0 [motorway]]

motorway 1: the grid's arterials are motorways (the loop e2e flow: loops keep off them).
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from tools.graph_etl import tiles as T  # noqa: E402

DUMP = r"""
const H = require(process.argv[1] + '/tests/graph_router_harness.js');
const [seed, nx, ny, stepDeg, lat0, lon0, motorway] = process.argv.slice(2).map(Number);
const g = H.grid({ seed, nx, ny, holes: 0.05, oneway: 0.05, signals: 0.15, stepDeg, lat0, lon0, motorway: motorway === 1 });
process.stdout.write(JSON.stringify(H.dump(H.tiles(g.nodes, g.edges).tiles)));
"""
DEFAULT = (3, 30, 30, 0.004, 39.15, -84.62)


def dump(seed=3, nx=30, ny=30, step=0.004, lat0=39.15, lon0=-84.62, motorway=0):
    node = shutil.which("node")
    out = subprocess.run([node, "-e", DUMP, ROOT, *map(str, (seed, nx, ny, step, lat0, lon0, motorway))], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def write_tiles(tiles, d):
    """Decoded-shape tiles (the harness's dump) through the real writer: one .vgr per tile and index.json, as shipped."""
    os.makedirs(d, exist_ok=True)
    index = {"tiles": {}, "built": "fixture", "osm": None, "model": "fixture"}
    for t in tiles:
        tile = T.Tile(i=t["i"], j=t["j"], lat=t["lat"], lon=t["lon"], node_flags=t["node_flags"], geoms=[[tuple(p) for p in g] for g in t["geoms"]])
        tile.edges = [(e["from"], T.Edge(to=e["to"], to_tile=tuple(e["to_tile"]) if e["to_tile"] else None, len_dm=e["len_dm"], t_ds=e["t_ds"],
                                         quality=e["quality"], scenery=e["scenery"], fun=e["fun"], conf=e["conf"], flags=e["flags"], cls=e["cls"],
                                         speed=e["speed"], name=e["name"], geom=e["geom"], h_in=e["h_in"], h_out=e["h_out"])) for e in t["edges"]]
        tile.restrictions = [T.Restriction(from_edge=r["from_edge"], via=r["via"], to_edge=r["to_edge"], only=r["only"],
                                           from_tile=tuple(r["from_tile"]) if r["from_tile"] else None) for r in t["restrictions"]]
        b = T.write_tile(tile)
        with open(os.path.join(d, f"{t['i']}_{t['j']}.vgr"), "wb") as f:
            f.write(b)
        index["tiles"][f"{t['i']}_{t['j']}"] = {"bytes": len(b), "nodes": len(t["lat"]), "edges": len(t["edges"])}
    with open(os.path.join(d, "index.json"), "w") as f:
        json.dump(index, f)
    return index


if __name__ == "__main__":
    args = sys.argv[2:]
    params = [int(a) if k < 3 or k == 6 else float(a) for k, a in enumerate(args)] if args else DEFAULT
    print(json.dumps(write_tiles(dump(*params), sys.argv[1])["tiles"]))
