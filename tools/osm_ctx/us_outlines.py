"""The lower-48 states' outlines as Geofabrik .poly files, from Geofabrik's index (index-v1.json, one GeoJSON feature
per extract with its outline), for the lower-48 OSM route context build (.github/workflows/osm-ctx-us.yml): build.py and
region.py write only the tiles wholly inside the outlines a job is given, so a tile across the Canadian or Mexican border
(or the sea's edge of an extract) is left to Overpass rather than passed off as all of it. One index read gives all 48,
instead of 48 more requests to a server that refuses runners at times.

    python -m tools.osm_ctx.us_outlines --index index-v1.json --out polys     polys/<state>.poly, one per lower-48 state
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from tools.graph_etl.us_plan import is_state, short, states


def poly_text(name: str, geometry: dict) -> str:
    """A GeoJSON Polygon or MultiPolygon as .poly text: each outer ring, then its holes marked with "!"."""
    t = geometry.get("type")
    polys = [geometry["coordinates"]] if t == "Polygon" else geometry["coordinates"] if t == "MultiPolygon" else []
    out, k = [name], 0
    for rings in polys:
        for h, ring in enumerate(rings):
            k += 1
            out.append(("!" if h else "") + str(k))
            out.extend(f"   {lon:.7E}   {lat:.7E}" for lon, lat, *_ in ring)
            out.append("END")
    out.append("END")
    return "\n".join(out) + "\n"


def write(index: dict, out_dir: str) -> list[str]:
    """polys/<state>.poly for every lower-48 state in the index; returns the ids written."""
    want = set(states(index))
    os.makedirs(out_dir, exist_ok=True)
    done = []
    for f in index.get("features", []):
        p = f.get("properties") or {}
        sid = short(p.get("id"))
        if sid in want and is_state(p) and f.get("geometry"):
            with open(os.path.join(out_dir, f"{sid}.poly"), "w") as fh:
                fh.write(poly_text(sid, f["geometry"]))
            done.append(sid)
    return sorted(done)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    done = write(json.load(open(a.index)), a.out)
    print(f"{len(done)} outlines")
    return 0 if done else 1


if __name__ == "__main__":
    sys.exit(main())
