"""Merge the region build's blocks into one tile set (.github/workflows/graph-region.yml).

    python -m tools.graph_etl.merge_index OUT_DIR BLOCK_DIR [BLOCK_DIR ...]

Each block dir holds the tiles one block wrote and its index.json (tools/graph_etl/build.py). Blocks write disjoint
tiles; OUT_DIR gets every .vgr and one index.json: the union of the tiles, total bytes, the tile count, summed stats,
and the one build id they share (a build mixing two ids is refused: their cross-tile edges would not agree). Every file
must stay under the 50 MB a git host takes without complaint.
"""
from __future__ import annotations

import json
import os
import shutil
import sys

MAX_FILE = 50 * 1024 * 1024


def merge(out, blocks):
    os.makedirs(out, exist_ok=True)
    merged, builds, stats, models = {}, set(), {}, set()
    base = None
    for d in blocks:
        p = os.path.join(d, "index.json")
        if not os.path.exists(p):
            continue
        ix = json.load(open(p))
        if not ix.get("tiles"):
            continue
        builds.add(ix.get("build"))
        models.add(ix.get("model"))
        base = base or ix
        for name, meta in ix["tiles"].items():
            if name in merged:
                raise SystemExit(f"tile {name} written by two blocks")
            src = os.path.join(d, f"{name}.vgr")
            if os.path.getsize(src) >= MAX_FILE:
                raise SystemExit(f"{name}.vgr is {os.path.getsize(src)} bytes, over 50 MB")
            shutil.copyfile(src, os.path.join(out, f"{name}.vgr"))
            merged[name] = meta
        for k, v in (ix.get("stats") or {}).items():
            if isinstance(v, (int, float)):
                stats[k] = stats.get(k, 0) + v
    if len(builds) > 1 or len(models) > 1:
        raise SystemExit(f"blocks from different builds: {sorted(map(str, builds))}")
    total = sum(m["bytes"] for m in merged.values())
    ix = dict(base or {"version": 3})
    ix.update({"tiles": dict(sorted(merged.items())), "tile_count": len(merged), "bytes": total, "stats": stats,
               "bbox": None, "edges": sum(m.get("edges", 0) for m in merged.values()),
               "nodes": sum(m.get("nodes", 0) for m in merged.values())})
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(ix, fh, indent=1, sort_keys=True)
        fh.write("\n")
    return ix


def main(argv=None):
    a = sys.argv[1:] if argv is None else argv
    ix = merge(a[0], a[1:])
    print(f"{ix['tile_count']} tiles, {ix['bytes'] / 1e6:.1f} MB, {ix['edges']} edges, build {ix.get('build')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
