"""The lower-48 tiles packed for a GitHub release (.github/workflows/graph-us.yml; backend/src/graph.ts).

A release takes at most 1000 files and the workflow's token about 1000 requests an hour, so the ~15,000 tiles of the
country go up as one pack per PACK x PACK tiles (2 degrees square): the tiles one after another, no header. The
Worker reads a tile with an HTTP Range of its pack, from packs.json:

    python -m tools.graph_etl.pack MERGED_DIR OUT_DIR

MERGED_DIR: merge_index.py's output (every <i>_<j>.vgr and index.json). OUT_DIR gets p<I>_<J>.bin for each pack,
packs.json ({ build, pack: PACK, tiles: { "i_j": [pack name, offset, length] } }) and index.json: the merged index
as the phone reads it (tiles: { "i_j": { bytes } }: what it routes over, the rest left out).
"""
from __future__ import annotations

import json
import os
import sys

PACK = 8                     # tiles per side (0.25 degree tiles: 2 degrees)
MAX_ASSET = 2 * 1024 ** 3    # GitHub's limit per release file


def pack_of(name):
    i, j = (int(x) for x in name.split("_"))
    return f"p{i // PACK}_{j // PACK}.bin"


def pack(src, out):
    ix = json.load(open(os.path.join(src, "index.json")))
    os.makedirs(out, exist_ok=True)
    by = {}
    for name in sorted(ix.get("tiles") or {}):
        by.setdefault(pack_of(name), []).append(name)
    tiles = {}
    for p, names in sorted(by.items()):
        off = 0
        with open(os.path.join(out, p), "wb") as fh:
            for name in names:
                b = open(os.path.join(src, f"{name}.vgr"), "rb").read()
                if len(b) != ix["tiles"][name]["bytes"]:
                    raise SystemExit(f"{name}.vgr is {len(b)} bytes, the index says {ix['tiles'][name]['bytes']}")
                fh.write(b)
                tiles[name] = [p, off, len(b)]
                off += len(b)
        if off >= MAX_ASSET:
            raise SystemExit(f"{p} is {off} bytes, over a release file's 2 GB")
    build = ix.get("build")
    with open(os.path.join(out, "packs.json"), "w") as fh:
        json.dump({"build": build, "pack": PACK, "tiles": tiles}, fh, separators=(",", ":"), sort_keys=True)
    slim = {k: v for k, v in ix.items() if k not in ("tiles",)}
    slim["tiles"] = {k: {"bytes": v["bytes"]} for k, v in sorted(ix["tiles"].items())}
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(slim, fh, separators=(",", ":"), sort_keys=True)
    return {"packs": len(by), "tiles": len(tiles), "bytes": sum(t[2] for t in tiles.values()), "build": build}


def main(argv=None):
    a = sys.argv[1:] if argv is None else argv
    r = pack(a[0], a[1])
    print(f"{r['tiles']} tiles in {r['packs']} packs, {r['bytes'] / 1e6:.1f} MB, build {r['build']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
