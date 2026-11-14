"""Region-wide lists the phone used to ask public Overpass for by the route's box, built once from the Geofabrik extracts
by the weekly OSM build (.github/workflows/osm-ctx.yml): Overpass timed out or refused on nearly every service check from
2026-11-12, so these showed nothing.

    OUT/osm/v2/falls.json = {"built": "YYYY-MM-DD", "bundle": 0.25, "cells": [[bi, bj], ...], "falls": [[lat, lon, name], ...]}
        waterfalls, web/scenic.js fallsInRegion (IDEAS R-24)
    OUT/osm/v2/closures.json = {"built", "bundle", "cells", "ways": [[lat, lon, {tags}], ...]}
        roads with conditional access (seasonal and time-of-day closures), web/conditional_closures.js inRegion (IDEAS
        R-22): a highway way with one of CKEYS, at the mean of its nodes, with those tags and its name and ref only
    OUT/osm/v2/places/<bi>_<bj>.json = [[lat, lon, name, {tags}], ...], one file per covered cell (an empty list too)
        named places with hours or contact tags (PKEYS), for a place card's open now, Call and Website (web/place_info.js,
        backend/src/osm_relay.ts placeTags): a cell at a time, so the server reads only the cells a lookup touches
    OUT/osm/v2/points/<bi>_<bj>.json = {"fuel": [[lat, lon], ...], "schools": [...], "worship": [...]}, one per covered cell
        fuel stations (web/route_ctx/car.js, the fuel-stop spacing) and schools and places of worship (route_ctx/events.js,
        school-run and church traffic), 5 decimal places, positions only (backend/src/osm_relay.ts pointCells)
    OUT/osm/v2/lines/<bi>_<bj>.json = {"t": {"<i>_<j>": {"lit": [[value, [lat, lon, ...]]], "tunnel": [[...]], "cycle": [[...]]}}}
        lit roads, road tunnels and the roads of bicycle routes for route_ctx/driver.js, by its 0.1 degree tiles (i, j =
        floor(lat / 0.1), floor(lon / 0.1)) in bundles of 5 x 5 tiles (bi, bj = floor(i / 5), floor(j / 5)); every tile
        wholly inside the .poly is listed, an empty one too, so the server can tell "none" from "not built". A line is
        in every tile one of its points falls in (as driver.js caches Overpass's), simplified to LINE_TOL degrees

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
PKEYS = ("opening_hours", "phone", "contact:phone", "website", "contact:website")   # place_info.js contact() and read()
POINTS = {"fuel": "fuel", "school": "schools", "place_of_worship": "worship"}   # amenity -> the file's list (car.js, events.js)
LINE_TILE, LINE_BUNDLE, LINE_TOL = 0.1, 5, 0.00002                                  # driver.js TILE; ~2 m (it paints 30 m cells)
LINE_ROAD = ("motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential")  # driver.js query's road
LIT = ("yes", "24/7", "automatic", "sunset-sunrise", "interval", "limited", "no", "disused")           # driver.js LIT's keys
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


def read_places(paths) -> list:
    """[(lat, lon, name, tags)] for every named node or way with one of PKEYS (a way at the mean of its nodes), sorted."""
    out, seen = [], set()
    for path in paths:
        for o in osmium.FileProcessor(path).with_locations():
            if not (o.is_node() or o.is_way()) or not (o.tags.get("name") or "").strip() or not any(k in o.tags for k in PKEYS):
                continue
            key = ("n" if o.is_node() else "w", o.id)
            if key in seen:
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
            seen.add(key)
            tags = {k: o.tags[k] for k in PKEYS if k in o.tags}
            out.append((round(la, 6), round(lo, 6), o.tags["name"], tags))
    return sorted(out, key=lambda x: (x[0], x[1], x[2]))


def places_by_cell(places, cs) -> dict:
    """{(bi, bj): [[lat, lon, name, tags], ...]} for every covered cell, empty ones included."""
    by = {tuple(c): [] for c in cs}
    for la, lo, nm, t in places:
        k = (math.floor(la / STEP), math.floor(lo / STEP))
        if k in by:
            by[k].append([la, lo, nm, t])
    return by


def read_points(paths) -> list:
    """[(kind, lat, lon)] for every node or way with amenity in POINTS (a way at the mean of its nodes), sorted."""
    out, seen = [], set()
    for path in paths:
        for o in osmium.FileProcessor(path).with_locations():
            kind = POINTS.get(o.tags.get("amenity", "")) if (o.is_node() or o.is_way()) else None
            key = ("n" if o.is_node() else "w", o.id)
            if not kind or key in seen:
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
            seen.add(key)
            out.append((kind, round(la, 5), round(lo, 5)))
    return sorted(out)


def points_by_cell(points, cs) -> dict:
    """{(bi, bj): {"fuel": [[lat, lon]], "schools": [...], "worship": [...]}} for every covered cell, empty ones included."""
    by = {tuple(c): {k: [] for k in POINTS.values()} for c in cs}
    for kind, la, lo in points:
        k = (math.floor(la / STEP), math.floor(lo / STEP))
        if k in by:
            by[k][kind].append([la, lo])
    return by


def _line_road(hw: str) -> bool:
    return hw in LINE_ROAD or (hw.endswith("_link") and hw[:-5] in LINE_ROAD)


def read_lines(paths) -> list:
    """[(kind, value, [(lat, lon), ...])]: driven roads with a lit tag (value its tag), road tunnels, and the ways of
    bicycle route relations that are roads of any kind (value 1), as driver.js query() and parseOsm() read Overpass."""
    from shapely.geometry import LineString
    cyc = set()
    for path in paths:
        for o in osmium.FileProcessor(path, osmium.osm.RELATION):
            if o.tags.get("route") == "bicycle":
                cyc.update(m.ref for m in o.members if m.type == "w")
    out = []
    for path in paths:
        for o in osmium.FileProcessor(path).with_locations():
            if not o.is_way() or "highway" not in o.tags:
                continue
            hw, road = o.tags["highway"], _line_road(o.tags["highway"])
            lit = o.tags.get("lit") if road and o.tags.get("lit") in LIT else None
            tun = road and o.tags.get("tunnel") == "yes"
            if lit is None and not tun and o.id not in cyc:
                continue
            pts = [(n.location.lat, n.location.lon) for n in o.nodes if n.location.valid()]
            if len(pts) < 1:
                continue
            if len(pts) > 2:
                pts = list(LineString([(b, a) for a, b in pts]).simplify(LINE_TOL).coords)
                pts = [(b, a) for a, b in pts]
            g = [(round(a, 5), round(b, 5)) for a, b in pts]
            if lit is not None:
                out.append(("lit", lit, g))
            if tun:
                out.append(("tunnel", 1, g))
            if o.id in cyc:
                out.append(("cycle", 1, g))
    return out


def line_tiles(cover) -> list:
    """The 0.1 degree tiles (i, j) wholly inside `cover`."""
    from shapely.geometry import box as sbox
    w, s, e, n = cover.bounds
    out = []
    for i in range(math.floor(s / LINE_TILE), math.ceil(n / LINE_TILE)):
        for j in range(math.floor(w / LINE_TILE), math.ceil(e / LINE_TILE)):
            if cover.contains(sbox(j * LINE_TILE + 1e-7, i * LINE_TILE + 1e-7, (j + 1) * LINE_TILE - 1e-7, (i + 1) * LINE_TILE - 1e-7)):
                out.append((i, j))
    return out


def lines_by_bundle(lines, tiles) -> dict:
    """{(bi, bj): {"t": {"i_j": {"lit": [[value, flat]], "tunnel": [[flat]], "cycle": [[flat]]}}}} over the covered tiles."""
    by, at = {}, {}
    for i, j in tiles:
        t = {"lit": [], "tunnel": [], "cycle": []}
        by.setdefault((math.floor(i / LINE_BUNDLE), math.floor(j / LINE_BUNDLE)), {"t": {}})["t"][f"{i}_{j}"] = t
        at[(i, j)] = t
    for kind, value, g in lines:
        flat = [v for p in g for v in p]
        for k in {(math.floor(a / LINE_TILE), math.floor(b / LINE_TILE)) for a, b in g}:
            if k in at:
                at[k][kind].append([value, flat] if kind == "lit" else flat)
    return by


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
    by = places_by_cell(read_places(a.pbf), cs)
    os.makedirs(os.path.join(a.out, "osm", "v2", "places"), exist_ok=True)
    for (bi, bj), rows in by.items():
        with open(os.path.join(a.out, "osm", "v2", "places", f"{bi}_{bj}.json"), "w") as f:
            json.dump(rows, f, separators=(",", ":"), ensure_ascii=False)
    n = sum(len(v) for v in by.values())
    pts = points_by_cell(read_points(a.pbf), cs)
    os.makedirs(os.path.join(a.out, "osm", "v2", "points"), exist_ok=True)
    for (bi, bj), body in pts.items():
        with open(os.path.join(a.out, "osm", "v2", "points", f"{bi}_{bj}.json"), "w") as f:
            json.dump(body, f, separators=(",", ":"))
    m = {k: sum(len(v[k]) for v in pts.values()) for k in POINTS.values()}
    lb = lines_by_bundle(read_lines(a.pbf), line_tiles(cover))
    os.makedirs(os.path.join(a.out, "osm", "v2", "lines"), exist_ok=True)
    for (bi, bj), body in lb.items():
        with open(os.path.join(a.out, "osm", "v2", "lines", f"{bi}_{bj}.json"), "w") as f:
            json.dump(body, f, separators=(",", ":"))
    nl = {k: sum(len(t[k]) for b in lb.values() for t in b["t"].values()) for k in ("lit", "tunnel", "cycle")}
    big = max((os.path.getsize(os.path.join(a.out, "osm", "v2", "lines", f"{bi}_{bj}.json")) for bi, bj in lb), default=0)
    print(f"lines: lit {nl['lit']}, tunnel {nl['tunnel']}, cycle {nl['cycle']} (per tile) in {len(lb)} bundles, largest {big} bytes")
    print(f"falls: {len(d['falls'])}, roads with conditional access: {len(c['ways'])}, places with hours or contact: {n}, "
          f"fuel {m['fuel']}, schools {m['schools']}, worship {m['worship']}, in {len(cs)} cells")


if __name__ == "__main__":
    main()
