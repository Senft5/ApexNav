"""The lower-48 context grid's bundles under some boxes, from the Worker (R2), for one graph-us job.

graph-us.yml's band jobs score their edges with the context grid (tools/graph_etl/score_edges.js --ctx DIR reads every
bundle in DIR). The whole country's grid is about 850 MB, so each job fetches only the bundles under its own blocks:

    python -m tools.ctx_etl.fetch --boxes blocks.txt --out DIR [--base URL]

blocks.txt is `us_plan blocks` output (name, box, clip per line); the clip boxes are used. Writes DIR/index.json (the
live index, its bundles cut to the ones fetched) and DIR/8/x/y.vcg. Exit 0 with the bundles there; exit 3 when the live
grid is not the lower 48's (its index says region "us"), so the workflow falls back to the graph-data branch's.
"""
import argparse
import json
import os
import sys
import time
import hashlib
import urllib.request

from . import grid

BASE = "https://apexnav.senftns.workers.dev"
UA = "Vetta-ctx-fetch/1 (+https://vettadrive.com/about)"


def get(url, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"user-agent": UA, "x-apexnav": "1"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - retried, then raised
            if k == tries - 1:
                raise
            print(f"  retry {url}: {e}", file=sys.stderr)
            time.sleep(5 * (k + 1))
    return None


def boxes_of(lines):
    """The clip boxes (west, south, east, north) of `us_plan blocks` lines."""
    out = []
    for line in lines:
        parts = line.split()
        if len(parts) >= 3:
            out.append(tuple(float(v) for v in parts[2].split(",")))
    return out


def wanted(index, boxes):
    """The index's bundle keys ("x/y") whose z8 tile touches any of the boxes."""
    keys = []
    for key in sorted(index.get("bundles") or {}):
        bx, by = (int(v) for v in key.split("/"))
        w, s, e, n = grid.tile_bounds_lonlat(bx, by, grid.BUNDLE_Z)
        if any(w < b[2] and e > b[0] and s < b[3] and n > b[1] for b in boxes):
            keys.append(key)
    return keys


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--boxes", required=True, help="us_plan blocks output")
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default=BASE)
    a = ap.parse_args(argv)
    base = a.base.rstrip("/") + "/api/ctx/v1/"
    try:
        raw = get(base + "index.json")
        index = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        print(f"no live context grid index: {e}")
        return 3
    if index.get("region") != "us":
        print(f"the live context grid is {index.get('region') or 'none'}, not the lower 48's")
        return 3
    keys = wanted(index, boxes_of(open(a.boxes).read().splitlines()))
    total = 0
    for key in keys:
        bx, by = key.split("/")
        data = get(f"{base}{grid.BUNDLE_Z}/{bx}/{by}.vcg")
        p = os.path.join(a.out, str(grid.BUNDLE_Z), bx, f"{by}.vcg")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data)
        total += len(data)
    # the release's own id (its whole index hashed), so every band's build id carries the same grid tag (build.py
    # ctx_tag) however few of its bundles the band took
    cut = dict(index, bundles={k: index["bundles"][k] for k in keys}, bytes=total,
               release=hashlib.sha1(raw if isinstance(raw, bytes) else raw.encode()).hexdigest()[:12])
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "index.json"), "w") as f:
        json.dump(cut, f, indent=1, sort_keys=True)
    print(f"context grid (lower 48, built {index.get('built')}): {len(keys)} bundles, {total / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
