"""Region-wide lists the phone used to ask public Overpass for by the route's box, built once from the Geofabrik extracts
by the weekly OSM build (.github/workflows/osm-ctx.yml): Overpass timed out or refused on nearly every service check from
2026-11-12, so these showed nothing.

    OUT/osm/v2/falls.json = {"built": "YYYY-MM-DD", "bundle": 0.25, "cells": [[bi, bj], ...], "falls": [[lat, lon, name], ...]}
        waterfalls, web/scenic.js fallsInRegion (IDEAS R-24)
    OUT/osm/v2/closures.json = {"built", "bundle", "cells", "ways": [[lat, lon, {tags}], ...]}
        roads with conditional access (seasonal and time-of-day closures), web/conditional_closures.js inRegion (IDEAS
        R-22): a highway way with one of CKEYS, at the mean of its nodes, with those tags and its name and ref only

Waterfalls:
A node or a way tagged natural=waterfall or waterway=waterfall, a way at the mean of its nodes, one per place (4 decimal
places), name or null. `cells` are the 0.25 degree bundles (bi = floor(lat / 0.25), bj = floor(lon / 0.25)) wholly
inside the extracts' .poly: the phone uses the file only for a route whose box lies in those cells, and asks Overpass
otherwise, so a border route never reads "no waterfalls" where the file simply doesn't reach.

    python -m tools.osm_ctx.region --pbf a.osm.pbf [--pbf b.osm.pbf] --poly a.poly [--poly b.poly] --out OUT
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import os

import osmium

from tools.osm_ctx.build import read_poly

STEP = 0.25
CKEYS = ("motor_vehicle:conditional", "motorcar:conditional", "vehicle:conditional", "access:conditional")   # conditional_closures.js KEYS


def is_falls(tags) -> bool:
    return tags.get("natural") == "waterfall" or tags.get("waterway") == "waterfall"


def read_closures(paths) -> list:
    """[(lat, lon, tags)] for every highway way with a conditional access tag, sorted."""
    out, seen = [], set()
    for path in paths:
        for o in osmium.FileProcessor(path).with_locations():
            if not o.is_way() or "highway" not in o.tags or not any(k in o.tags for k in CKEYS) or o.id in seen:
                continue
            pts = [(n.location.lat, n.location.lon) for n in o.nodes if n.location.valid()]
            if not pts:
                continue
            seen.add(o.id)
            tags = {k: o.tags[k] for k in CKEYS + ("name", "ref") if k in o.tags}
            out.append((round(sum(p[0] for p in pts) / len(pts), 6), round(sum(p[1] for p in pts) / len(pts), 6), tags))
    return sorted(out, key=lambda x: (x[0], x[1]))


def read(paths) -> list:
    """Waterfalls: [(lat, lon, name|None)], one per place, sorted."""
    seen, out = set(), []
    for path in paths:
        for o in osmium.FileProcessor(path).with_locations():
            if not (o.is_node() or o.is_way()) or not is_falls(o.tags):
                continue
            if o.is_node():
                if not o.location.valid():
                    continue
                la, lo = o.location.lat, o.location.lon
            else:
                pts = [(n.location.lat, n.location.lon) for n in o.nodes if n.location.valid()]
                if not pts:
                    continue
                la, lo = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            key = (round(la, 4), round(lo, 4))
            if key in seen:
                continue
            seen.add(key)
            name = (o.tags.get("name") or "").strip() or None
            out.append((round(la, 6), round(lo, 6), name))
    return sorted(out, key=lambda x: (x[0], x[1], x[2] or ""))


def cells(cover) -> list:
    """The 0.25 degree bundles wholly inside `cover` (a shapely geometry)."""
    from shapely.geometry import box as sbox
    w, s, e, n = cover.bounds
    out = []
    for bi in range(math.floor(s / STEP), math.ceil(n / STEP)):
        for bj in range(math.floor(w / STEP), math.ceil(e / STEP)):
            if cover.contains(sbox(bj * STEP + 1e-7, bi * STEP + 1e-7, (bj + 1) * STEP - 1e-7, (bi + 1) * STEP - 1e-7)):
                out.append([bi, bj])
    return out


def doc(falls, cover, built=None, cs=None) -> dict:
    cs = cells(cover) if cs is None else cs
    inside = {tuple(c) for c in cs}
    kept = [[la, lo, nm] for la, lo, nm in falls if (math.floor(la / STEP), math.floor(lo / STEP)) in inside]
    return {"built": built or datetime.date.today().isoformat(), "bundle": STEP, "cells": cs, "falls": kept}


def closures_doc(ways, cover, built=None, cs=None) -> dict:
    cs = cells(cover) if cs is None else cs
    inside = {tuple(c) for c in cs}
    kept = [[la, lo, t] for la, lo, t in ways if (math.floor(la / STEP), math.floor(lo / STEP)) in inside]
    return {"built": built or datetime.date.today().isoformat(), "bundle": STEP, "cells": cs, "ways": kept}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", action="append", required=True)
    ap.add_argument("--poly", action="append", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    from shapely.ops import unary_union
    cover = unary_union([read_poly(p) for p in a.poly])
    cs = cells(cover)
    d, c = doc(read(a.pbf), cover, cs=cs), closures_doc(read_closures(a.pbf), cover, cs=cs)
    os.makedirs(os.path.join(a.out, "osm", "v2"), exist_ok=True)
    for name, body in (("falls.json", d), ("closures.json", c)):
        with open(os.path.join(a.out, "osm", "v2", name), "w") as f:
            json.dump(body, f, separators=(",", ":"), ensure_ascii=False)
    print(f"falls: {len(d['falls'])}, roads with conditional access: {len(c['ways'])}, in {len(cs)} cells")


if __name__ == "__main__":
    main()
