"""OpenStreetMap route context tiles built from an extract (.github/workflows/osm-ctx.yml), so a plan's road details no
longer hang on the public Overpass servers, which timed out or refused on nearly every service check from 2026-11-12.

What a tile holds is what backend/src/osm_relay.ts asks Overpass for one 0.05 degree tile (query()), in the shape its
compact() answers: the drivable ways crossing the tile with their tags, geometry and node ids; the signals, stops,
crossings, calming and fords on them; hazard and traffic signs within 40 m of them; guard rails within 15 m; viewpoints,
historic places and fuel in the tile; the bicycle and scenic road routes over them, each followed by its member ways
that are in the tile. web/route_ctx/osm_overpass.js parse() reads it unchanged.

Output: one gzip file per 0.25 degree bundle, OUT/osm/v1/<bi>_<bj>.txt.gz, a line per 0.05 degree tile:
"<i>_<j>\\t<compact json>\\n" (i = floor(south / 0.05), j = floor(west / 0.05); bi = floor(i / 5), bj = floor(j / 5)).
Only tiles wholly inside the coverage polygons (the extracts' Geofabrik .poly) are written, an empty one as
{"elements":[]}; a tile across the border is left out, so the Worker asks Overpass for it instead of passing half a
tile off as all of it. The Worker (osm_relay.ts builtTile) finds a tile's line without parsing the rest.

    python -m tools.osm_ctx.build --pbf block.osm.pbf --box=w,s,e,n --poly ohio.poly --poly kentucky.poly --out OUT

Data: (c) OpenStreetMap contributors, ODbL 1.0 (About > Sources).
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import re
from collections import defaultdict

import osmium

TILE = 0.05
BUNDLE = 5                       # tiles per bundle side: 0.25 degrees, the graph tiles' grid
R_SIGN, R_RAIL = 40.0, 15.0      # metres, as the query's around.r:40 and around.r:15
CELL = 0.005                     # the proximity grid (degrees, about 500 m)

# kept in step with backend/src/osm_relay.ts (tests/test_osm_ctx.py compares them)
DRIVABLE = re.compile(r"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)(_link)?$")
KEEP = {"highway", "name", "ref", "maxspeed", "maxspeed:forward", "maxspeed:backward", "lanes", "oneway", "surface", "maxheight", "maxwidth", "maxweight",
        "smoothness", "hgv", "access", "vehicle", "motor_vehicle", "motorcar", "bridge", "covered", "junction", "traffic_calming",
        "crossing", "railway", "hazard", "animal", "traffic_sign", "barrier", "tourism", "historic", "amenity", "opening_hours", "brand",
        "route", "network", "scenic", "service", "stop", "dual_carriageway", "memorial", "bridge:name", "tunnel", "ford"}
ON_HW = re.compile(r"^(traffic_signals|stop|give_way|crossing|mini_roundabout)$")
POI_KEY = re.compile(r"^(tourism|historic)$")
POI_VAL = re.compile(r"^(viewpoint|memorial|marker|monument|milestone|wayside_cross|wayside_shrine|ruins|fort|battlefield|mill|archaeological_site|boundary_stone|bridge|building|church|yes)$")
ROUTE = re.compile(r"^(bicycle|road)$")


def r6(v: float) -> float:
    return round(v, 6)


def keep(tags) -> dict:
    return {k: v for k, v in tags.items() if k in KEEP}


def tile_of(lat: float, lon: float) -> tuple[int, int]:
    return math.floor(lat / TILE), math.floor(lon / TILE)


def tile_name(i: int, j: int) -> str:
    return f"{i}_{j}"


def bundle_of(i: int, j: int) -> tuple[int, int]:
    return i // BUNDLE, j // BUNDLE


def is_on(t: dict) -> bool:
    return bool(ON_HW.match(t.get("highway", ""))) or "traffic_calming" in t or t.get("railway") == "level_crossing" or "crossing" in t or "ford" in t


def is_sign(t: dict) -> bool:
    return "hazard" in t or "traffic_sign" in t


def is_poi(t: dict) -> bool:
    return any(POI_KEY.match(k) and POI_VAL.match(v) for k, v in t.items()) or t.get("amenity") == "fuel"


def tiles_of_line(pts) -> set:
    """The tiles a line's vertices and segments touch (each segment sampled at a tenth of a tile)."""
    out = set()
    for (a, b), (c, d) in zip(pts, pts[1:]):
        n = max(1, int(max(abs(c - a), abs(d - b)) / (TILE / 10)) + 1)
        for k in range(n + 1):
            out.add(tile_of(a + (c - a) * k / n, b + (d - b) * k / n))
    if len(pts) == 1:
        out.add(tile_of(*pts[0]))
    return out


def seg_dist_m(p, a, b) -> float:
    """Metres from point p to segment a-b (lat, lon), on a local flat projection."""
    k = math.cos(math.radians(p[0]))
    ax, ay = (a[1] - p[1]) * 111320 * k, (a[0] - p[0]) * 110540
    bx, by = (b[1] - p[1]) * 111320 * k, (b[0] - p[0]) * 110540
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
    return math.hypot(ax + t * dx, ay + t * dy)


def read_poly(path: str):
    """A Geofabrik .poly file as shapely polygons (outer rings minus the holes that follow them)."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    rings, cur, hole, name = [], None, False, None
    with open(path) as f:
        lines = [x.strip() for x in f if x.strip()]
    for x in lines[1:]:
        if x == "END":
            if cur is not None:
                rings.append((hole, cur))
                cur = None
            continue
        if cur is None:
            hole, cur = x.startswith("!"), []
            continue
        lo, la = map(float, x.split()[:2])
        cur.append((lo, la))
    polys = []
    for hole, ring in rings:
        if len(ring) < 3:
            continue
        if not hole:
            polys.append(Polygon(ring))
        elif polys:
            polys[-1] = polys[-1].difference(Polygon(ring))
    return unary_union(polys)


class Raw:
    def __init__(self):
        self.ways = {}       # id -> (tags, [(lat, lon)], [node ids])
        self.rails = {}      # id -> (tags, [(lat, lon)])
        self.on = {}         # node id -> (lat, lon, tags)
        self.signs = {}      # node id -> (lat, lon, tags)
        self.pois = []       # ("node"|"way", id, tags, (lat, lon) | [(lat, lon)])
        self.rels = {}       # id -> (tags, [way ids])


def read(path: str) -> Raw:
    raw = Raw()
    for o in osmium.FileProcessor(path).with_locations():
        if o.is_node():
            if not o.tags or not o.location.valid():
                continue
            t = dict(o.tags)
            p = (r6(o.location.lat), r6(o.location.lon))
            if is_on(t):
                raw.on[o.id] = (p[0], p[1], t)
            if is_sign(t):
                raw.signs[o.id] = (p[0], p[1], t)
            if is_poi(t):
                raw.pois.append(("node", o.id, t, p))
        elif o.is_way():
            t = dict(o.tags)
            hw, rail, poi = DRIVABLE.match(t.get("highway", "")), t.get("barrier") == "guard_rail", is_poi(t)
            if not (hw or rail or poi):
                continue
            nd = [n for n in o.nodes if n.location.valid()]
            if not nd:
                continue
            pts = [(r6(n.lat), r6(n.lon)) for n in nd]
            if hw and len(pts) >= 2:
                raw.ways[o.id] = (t, pts, [n.ref for n in nd])
            if rail and len(pts) >= 2:
                raw.rails[o.id] = (t, pts)
            if poi:
                raw.pois.append(("way", o.id, t, pts))
        elif o.is_relation():
            t = dict(o.tags)
            if ROUTE.match(t.get("route", "")):
                raw.rels[o.id] = (t, [m.ref for m in o.members if m.type == "w"])
    return raw


def tiles(raw: Raw, want) -> dict:
    """{(i, j): {"elements": [...]}} for every tile in `want` (a set of (i, j)), as the relay's compact() answers."""
    way_tiles = {wid: tiles_of_line(pts) & want for wid, (_, pts, _) in raw.ways.items()}
    per = defaultdict(lambda: {"r": [], "on": set(), "signs": set(), "rails": set(), "poi": [], "rels": defaultdict(list)})
    for wid, ts in way_tiles.items():
        for tk in ts:
            per[tk]["r"].append(wid)
    # segments on a 500 m grid, for what lies within 40 m / 15 m of a road
    grid = defaultdict(list)
    for wid, (_, pts, _) in raw.ways.items():
        if not way_tiles[wid]:
            continue
        for a, b in zip(pts, pts[1:]):
            for ci in range(math.floor(min(a[0], b[0]) / CELL), math.floor(max(a[0], b[0]) / CELL) + 1):
                for cj in range(math.floor(min(a[1], b[1]) / CELL), math.floor(max(a[1], b[1]) / CELL) + 1):
                    grid[(ci, cj)].append((wid, a, b))

    def near_ways(p, r):
        ci, cj, out = math.floor(p[0] / CELL), math.floor(p[1] / CELL), set()
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for wid, a, b in grid.get((ci + di, cj + dj), ()):
                    if wid not in out and seg_dist_m(p, a, b) <= r:
                        out.add(wid)
        return out

    node_ways = defaultdict(set)
    for wid, (_, _, refs) in raw.ways.items():
        if way_tiles[wid]:
            for r in refs:
                if r in raw.on:
                    node_ways[r].add(wid)
    for nid, wids in node_ways.items():
        for wid in wids:
            for tk in way_tiles[wid]:
                per[tk]["on"].add(nid)
    for nid, (la, lo, _) in raw.signs.items():
        for wid in near_ways((la, lo), R_SIGN):
            for tk in way_tiles[wid]:
                per[tk]["signs"].add(nid)
    for rid, (_, pts) in raw.rails.items():
        hit = set()
        for a, b in zip(pts, pts[1:]):
            m = max(1, int(seg_dist_m(a, a, b) / 10))
            for k in range(m + 1):
                hit |= near_ways((a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m), R_RAIL)
        for wid in hit:
            for tk in way_tiles[wid]:
                per[tk]["rails"].add(rid)
    for kind, oid, t, geo in raw.pois:
        for tk in ({tile_of(*geo)} if kind == "node" else tiles_of_line(geo)) & want:
            per[tk]["poi"].append((kind, oid, t, geo))
    for rid, (_, members) in raw.rels.items():
        for wid in members:
            for tk in way_tiles.get(wid, ()):
                per[tk]["rels"][rid].append(wid)

    out = {}
    for tk in want:
        p = per.get(tk)
        els = []
        if p:
            for wid in sorted(p["r"]):
                t, pts, refs = raw.ways[wid]
                els.append({"type": "way", "id": wid, "tags": keep(t), "geometry": [{"lat": a, "lon": b} for a, b in pts], "nodes": refs})
            for nid in sorted(p["on"]):
                la, lo, t = raw.on[nid]
                els.append({"type": "node", "id": nid, "tags": keep(t), "lat": la, "lon": lo})
            for nid in sorted(p["signs"]):
                la, lo, t = raw.signs[nid]
                els.append({"type": "node", "id": nid, "tags": keep(t), "lat": la, "lon": lo})
            for rid in sorted(p["rails"]):
                t, pts = raw.rails[rid]
                els.append({"type": "way", "id": rid, "tags": keep(t), "geometry": [{"lat": a, "lon": b} for a, b in pts]})
            for kind, oid, t, geo in sorted(p["poi"], key=lambda x: (x[0], x[1])):
                if kind == "node":
                    els.append({"type": "node", "id": oid, "tags": keep(t), "lat": geo[0], "lon": geo[1]})
                else:
                    las, los = [a for a, _ in geo], [b for _, b in geo]
                    els.append({"type": "way", "id": oid, "tags": keep(t), "center": {"lat": r6((min(las) + max(las)) / 2), "lon": r6((min(los) + max(los)) / 2)}})
            for rid in sorted(p["rels"]):
                els.append({"type": "relation", "id": rid, "tags": keep(raw.rels[rid][0])})
                els.extend({"type": "way", "id": wid} for wid in sorted(set(p["rels"][rid])))
        out[tk] = {"elements": els}
    return out


def wanted(box, cover) -> set:
    """The tiles of `box` (w, s, e, n, on the 0.05 degree grid) wholly inside `cover` (a shapely geometry, or None for all)."""
    from shapely.geometry import box as sbox
    w, s, e, n = box
    out = set()
    for i in range(round(s / TILE), round(n / TILE)):
        for j in range(round(w / TILE), round(e / TILE)):
            if cover is None or cover.contains(sbox(j * TILE + 1e-7, i * TILE + 1e-7, (j + 1) * TILE - 1e-7, (i + 1) * TILE - 1e-7)):
                out.add((i, j))
    return out


def write(out_dir: str, built: dict) -> list[str]:
    """One .txt.gz per bundle, its tiles' lines sorted; returns the files written."""
    by = defaultdict(list)
    for (i, j), v in built.items():
        by[bundle_of(i, j)].append(((i, j), v))
    os.makedirs(os.path.join(out_dir, "osm", "v1"), exist_ok=True)
    files = []
    for (bi, bj), items in sorted(by.items()):
        path = os.path.join(out_dir, "osm", "v1", f"{bi}_{bj}.txt.gz")
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
            for (i, j), v in sorted(items):
                f.write(f"{tile_name(i, j)}\t{json.dumps(v, separators=(',', ':'), ensure_ascii=False)}\n")
        files.append(path)
    return files


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", required=True)
    ap.add_argument("--box", required=True, help="w,s,e,n of the tiles to write (on the 0.05 degree grid)")
    ap.add_argument("--poly", action="append", default=[], help="a Geofabrik .poly the tiles must lie inside (repeat)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    box = tuple(map(float, a.box.split(",")))
    cover = None
    if a.poly:
        from shapely.ops import unary_union
        cover = unary_union([read_poly(p) for p in a.poly])
    want = wanted(box, cover)
    if not want:
        print(f"{a.box}: no tile inside the coverage")
        return
    raw = read(a.pbf)
    built = tiles(raw, want)
    files = write(a.out, built)
    full = sum(1 for v in built.values() if v["elements"])
    print(f"{a.box}: {len(built)} tiles ({full} with roads) in {len(files)} bundles; {len(raw.ways)} ways read")


if __name__ == "__main__":
    main()
