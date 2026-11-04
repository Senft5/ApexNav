"""The region build's blocks (.github/workflows/graph-region.yml): one band of latitude cut into 1 degree blocks of whole
0.25 degree tiles, each built from its own extract with MARGIN degrees round it. The margin holds the neighbouring
tiles whole (plus some), so a block numbers its neighbours' nodes exactly as their own block does, and edges across a
block edge agree.

    python -m tools.graph_etl.region_blocks --region=-89.75,36.5,-80.5,42.5 --band 39.5 --dir DIR

writes DIR/extract.json (osmium extract --config: one pass for the band's blocks) and prints one line per block:
"<name> <west,south,east,north of its tiles>".
"""
from __future__ import annotations

import argparse
import json
import os

BLOCK = 1.0
MARGIN = 0.4


def blocks(region, band):
    w, s, e, n = region
    out = []
    lo = w
    while lo < e - 1e-9:
        hi = min(e, lo + BLOCK)
        top = min(n, band + BLOCK)
        if band < n - 1e-9:
            out.append((f"b{band:+.2f}_{lo:+.2f}".replace("+", "p").replace("-", "m").replace(".", ""), (lo, band, hi, top)))
        lo = hi
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", required=True)
    ap.add_argument("--band", type=float, required=True)
    ap.add_argument("--dir", required=True)
    a = ap.parse_args(argv)
    region = tuple(float(x) for x in a.region.split(","))
    os.makedirs(a.dir, exist_ok=True)
    bl = blocks(region, a.band)
    cfg = {"directory": a.dir, "extracts": [
        {"output": f"{name}.osm.pbf", "bbox": [b[0] - MARGIN, b[1] - MARGIN, b[2] + MARGIN, b[3] + MARGIN]} for name, b in bl]}
    with open(os.path.join(a.dir, "extract.json"), "w") as fh:
        json.dump(cfg, fh, indent=1)
    for name, b in bl:
        print(name, ",".join(f"{x:.2f}" for x in b))
    return 0


if __name__ == "__main__":
    main()
