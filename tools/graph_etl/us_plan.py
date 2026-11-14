"""The lower-48 graph build's plan (.github/workflows/graph-us.yml): which Geofabrik state extracts to fetch, and the
jobs that build the 1 degree blocks (tools/graph_etl/region_blocks.py's blocks, the same MARGIN round each).

The country is cut into bands of 1 degree of latitude and each band into CHUNK_DEG chunks of longitude, one job each,
so no job runs past the runner's 6 hours (Ohio's densest band, ten blocks, took 105 minutes, 2026-11-10). A block is
built only where a state's box touches it (open sea and Canada have none), and a job fetches only the states whose box
touches its blocks' extract boxes.

    python -m tools.graph_etl.us_plan states  --index index-v1.json             one Geofabrik id per line
    python -m tools.graph_etl.us_plan matrix  --index index-v1.json [--only ID,ID] the jobs as JSON (a matrix include)
    python -m tools.graph_etl.us_plan blocks  --job JSON                          region_blocks.py's lines for one job

`--only` (a pilot) keeps the blocks those states touch. Geofabrik's index-v1.json: https://download.geofabrik.de/index-v1.json
(one GeoJSON feature per extract, with its outline).
"""
from __future__ import annotations

import argparse
import json
import math
import sys

from tools.graph_etl.region_blocks import BLOCK, MARGIN

LOWER48 = (-125.0, 24.0, -66.0, 50.0)   # whole degrees round the lower 48 (west, south, east, north)
CHUNK_DEG = 15.0
# east of DENSE_WEST the chunks are DENSE_CHUNK_DEG wide: the -95..-80 chunks took up to 4 h 17 min of the runner's 5 h 45 min
# (Chicago, Detroit and Cleveland: bands 41 to 43, 2026-11-14), the West's under 2 h 15 min
DENSE_WEST, DENSE_CHUNK_DEG = -100.0, 8.0   # whole degrees: the blocks stay on the 1 degree grid


def _ring_box(coords, box):
    for p in coords:
        if isinstance(p[0], (int, float)):
            box[0] = min(box[0], p[0]); box[1] = min(box[1], p[1]); box[2] = max(box[2], p[0]); box[3] = max(box[3], p[1])
        else:
            _ring_box(p, box)
    return box


def states(index):
    """{id: (w, s, e, n)} for Geofabrik's US states inside the lower 48 (Alaska, Hawaii and the territories fall out)."""
    out = {}
    for f in index.get("features", []):
        p = f.get("properties") or {}
        sid = short(p.get("id"))
        if not sid or not is_state(p) or not f.get("geometry"):
            continue
        b = _ring_box(f["geometry"]["coordinates"], [math.inf, math.inf, -math.inf, -math.inf])
        if b[0] >= LOWER48[0] - 1 and b[2] <= LOWER48[2] + 1 and b[1] >= LOWER48[1] - 1 and b[3] <= LOWER48[3] + 1:
            out[sid] = tuple(b)
    return dict(sorted(out.items()))


def short(gid):
    """Geofabrik's id without its "us/" prefix (index-v1 names the states "us/ohio"): a plain name for artifacts."""
    return str(gid).split("/")[-1] if gid else None


def is_state(p):
    return p.get("parent") == "us" or str(p.get("id", "")).startswith("us/")


def urls(index):
    """{short id: pbf url} for the states."""
    return {short(f["properties"]["id"]): (f["properties"].get("urls") or {}).get("pbf")
            for f in index.get("features", []) if is_state(f.get("properties") or {})}


def _touch(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _name(band, lo):
    return f"b{band:+.2f}_{lo:+.2f}".replace("+", "p").replace("-", "m").replace(".", "")


def jobs(st, only=None):
    """[{name, band, west, east, blocks: [[name, box, clip]], states}] in band order; empty chunks left out."""
    want = {k: v for k, v in st.items() if not only or k in only}
    out = []
    w, s, e, n = LOWER48
    band = s
    while band < n - 1e-9:
        lo = w
        while lo < e - 1e-9:
            hi = min(e, lo + (DENSE_CHUNK_DEG if lo >= DENSE_WEST - 1e-9 else CHUNK_DEG), DENSE_WEST if lo < DENSE_WEST - 1e-9 else e)
            bl, need = [], set()
            x = lo
            while x < hi - 1e-9:
                box = (x, band, min(hi, x + BLOCK), min(n, band + BLOCK))
                clip = (box[0] - MARGIN, box[1] - MARGIN, box[2] + MARGIN, box[3] + MARGIN)
                if any(_touch(box, b) for b in want.values()):
                    bl.append([_name(band, x), box, clip])
                    need |= {k for k, b in st.items() if _touch(clip, b)}   # every state under the margin, pilot or not
                x += BLOCK
            if bl:
                out.append({"name": f"{band:g}_{lo:g}", "band": band, "west": lo, "east": hi, "blocks": bl, "states": sorted(need)})
            lo = hi
        band += BLOCK
    return out


def fmt(b):
    return ",".join(f"{x:.2f}" for x in b)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["states", "matrix", "blocks"])
    ap.add_argument("--index")
    ap.add_argument("--only", default="")
    ap.add_argument("--job")
    a = ap.parse_args(argv)
    if a.cmd == "blocks":
        for name, box, clip in json.loads(a.job)["blocks"]:
            print(name, fmt(box), fmt(clip))
        return 0
    st = states(json.load(open(a.index)))
    if a.cmd == "states":
        print("\n".join(st))
        return 0
    only = {x for x in a.only.split(",") if x} or None
    js = jobs(st, only)
    # the matrix carries only what a job needs to start; its blocks are planned again inside it (blocks --job)
    print(json.dumps({"include": [{"name": j["name"], "job": json.dumps(j, separators=(",", ":")), "states": " ".join(j["states"])} for j in js]},
                     separators=(",", ":")))
    print(f"{len(js)} jobs, {sum(len(j['blocks']) for j in js)} blocks", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
