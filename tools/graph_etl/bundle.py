"""The graph tiles shipped inside the app (web/data/graph/v1: Cincinnati's 16 tiles) cut from a region build, so the
shipped copy and the region's are always one build (web/graph_tiles.js uses the shipped copy first only then).

    python -m tools.graph_etl.bundle SRC OUT [--tiles=-85.0,38.75,-84.0,39.75]

SRC is a region tile directory (v1/ with index.json) or a URL prefix of one (the graph-data branch on
raw.githubusercontent.com). OUT gets the tiles in the box, an index.json with the region's build id and only those
tiles, and nothing else (older tiles there are removed). .github/workflows/graph-region.yml runs it after every
region build.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

from . import tiles as T

CINCY = "-85.0,38.75,-84.0,39.75"


def read(src, name):
    if src.startswith("http"):
        with urllib.request.urlopen(src.rstrip("/") + "/" + name, timeout=120) as r:
            return r.read()
    with open(os.path.join(src, name), "rb") as fh:
        return fh.read()


def bundle(src, out, box=CINCY):
    w, s, e, n = (float(x) for x in box.split(","))
    i0, j0 = T.tile_of(s, w)
    i1, j1 = T.tile_of(n - 1e-9, e - 1e-9)
    want = {f"{i}_{j}" for i in range(i0, i1 + 1) for j in range(j0, j1 + 1)}
    ix = json.loads(read(src, "index.json"))
    names = sorted(k for k in ix["tiles"] if k in want)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith(".vgr") and f[:-4] not in names:
            os.remove(os.path.join(out, f))
    total = 0
    for k in names:
        b = read(src, f"{k}.vgr")
        r = T.read_tile(b)
        assert (r["i"], r["j"]) == tuple(map(int, k.split("_"))), k
        with open(os.path.join(out, f"{k}.vgr"), "wb") as fh:
            fh.write(b)
        total += len(b)
    sub = {kk: v for kk, v in ix.items() if kk not in ("tiles", "bytes", "tile_count", "edges", "nodes", "stats")}
    sub.update({"tiles": {k: ix["tiles"][k] for k in names}, "bytes": total, "tile_count": len(names), "bbox": [w, s, e, n],
                "edges": sum(ix["tiles"][k].get("edges", 0) for k in names), "nodes": sum(ix["tiles"][k].get("nodes", 0) for k in names),
                "bundled_from": "the region build (graph-data branch), tools/graph_etl/bundle.py"})
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(sub, fh, indent=1, sort_keys=True)
        fh.write("\n")
    return sub


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--tiles", default=CINCY)
    a = ap.parse_args(argv)
    ix = bundle(a.src, a.out, a.tiles)
    print(f"{ix['tile_count']} tiles, {ix['bytes'] / 1e6:.2f} MB, build {ix.get('build')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
