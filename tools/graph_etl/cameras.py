"""Our own camera list for the region (web/cameras.js, Avoid cameras): plate readers (surveillance:type=ALPR, mapped by
DeFlock) and fixed speed cameras (highway=speed_camera) from the same Geofabrik extracts as the road graph. The public
Overpass servers the phone asked timed out or refused it when busy (all four, asked from the Worker, 2026-11-12; Nate:
"the camera server always says it's down"), so inside the region the phone reads this file instead.

    osmium tags-filter ohio.osm.pbf n/surveillance:type=ALPR n/highway=speed_camera -o ohio.cams.pbf
    osmium export ohio.cams.pbf -f geojsonseq --add-unique-id=type_id -o ohio.cams.geojsonseq
    python -m tools.graph_etl.cameras --out DIR/region.json --build 2026-46 \
        --poly ohio.poly kentucky.poly indiana.poly --cams ohio.cams.geojsonseq ...

region.json: {version, build, source, tile, tiles: [the 0.25 degree tiles the extracts cover whole], cams: [[lat, lon,
"a" | "s"], ...]}. A tile listed with no camera in it is known to have none; a tile not listed is not known (the phone asks
Overpass for it). Coverage comes from Geofabrik's .poly outlines, each extract's exact cut.
"""
from __future__ import annotations

import argparse
import json
import math
import os

TILE = 0.25   # web/cameras.js TILE
INSET = 1e-4  # sample points this far inside the tile: a point on an outline's edge is neither in nor out


def parse_poly(text):
    """A Geofabrik .poly file -> [(ring [(lon, lat)], is_hole)]."""
    rings, cur, hole = [], None, False
    lines = [l.strip() for l in text.splitlines()]
    for line in lines[1:]:                       # the first line is the file's name
        if not line:
            continue
        if cur is None:
            if line == "END":
                break                            # the file's END
            hole, cur = line.startswith("!"), []
            continue
        if line == "END":
            rings.append((cur, hole))
            cur = None
            continue
        lon, lat = (float(v) for v in line.split()[:2])
        cur.append((lon, lat))
    return rings


def _in_ring(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_poly(lon, lat, rings):
    """Inside an outer ring and not in a hole."""
    inside = False
    for ring, hole in rings:
        if _in_ring(lon, lat, ring):
            if hole:
                return False
            inside = True
    return inside


def covered_tiles(polys):
    """The 0.25 degree tiles (keys "i_j", web/cameras.js) whose every sample point (a 5 x 5 grid, edges included, INSET inside) lies in
    one of the outlines: the tiles the extracts hold whole."""
    lo_lon = min(p[0] for rings in polys for ring, _ in rings for p in ring)
    hi_lon = max(p[0] for rings in polys for ring, _ in rings for p in ring)
    lo_lat = min(p[1] for rings in polys for ring, _ in rings for p in ring)
    hi_lat = max(p[1] for rings in polys for ring, _ in rings for p in ring)
    out = []
    for i in range(math.floor(lo_lat / TILE), math.floor(hi_lat / TILE) + 1):
        for j in range(math.floor(lo_lon / TILE), math.floor(hi_lon / TILE) + 1):
            pts = [(j * TILE + INSET + (TILE - 2 * INSET) * a / 4, i * TILE + INSET + (TILE - 2 * INSET) * b / 4) for a in range(5) for b in range(5)]
            if all(any(in_poly(lon, lat, rings) for rings in polys) for lon, lat in pts):
                out.append(f"{i}_{j}")
    return out


def cameras(lines):
    """geojsonseq lines (osmium export) -> sorted, de-duplicated [[lat, lon, "a" | "s"]], 6 decimals."""
    seen = {}
    for line in lines:
        line = line.strip().lstrip("\x1e")
        if not line:
            continue
        f = json.loads(line)
        g, t = f.get("geometry") or {}, f.get("properties") or {}
        if g.get("type") != "Point":
            continue
        kind = "a" if t.get("surveillance:type") == "ALPR" else "s" if t.get("highway") == "speed_camera" else None
        lon, lat = g.get("coordinates", [None, None])[:2]
        if kind is None or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (lat, lon)):
            continue
        key = f.get("id") or t.get("@id") or (round(lat, 6), round(lon, 6), kind)
        seen[key] = [round(lat, 6), round(lon, 6), kind]
    return sorted(seen.values())


def region(polys, cam_lines, build, source):
    tiles = covered_tiles(polys)
    keep = set(tiles)
    cams = [c for c in cameras(cam_lines) if f"{math.floor(c[0] / TILE)}_{math.floor(c[1] / TILE)}" in keep]
    return {"version": 1, "build": build, "source": source, "tile": TILE, "tiles": tiles, "cams": cams}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--source", default="Geofabrik ohio, kentucky, indiana")
    ap.add_argument("--poly", nargs="+", required=True)
    ap.add_argument("--cams", nargs="+", required=True)
    a = ap.parse_args(argv)
    polys = [parse_poly(open(p, encoding="utf-8").read()) for p in a.poly]
    lines = []
    for p in a.cams:
        with open(p, encoding="utf-8") as fh:
            lines.extend(fh)
    doc = region(polys, lines, a.build, a.source)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    n_a = sum(1 for c in doc["cams"] if c[2] == "a")
    print(f"cameras: {len(doc['cams'])} ({n_a} plate readers, {len(doc['cams']) - n_a} speed cameras) on {len(doc['tiles'])} tiles")
    if not doc["tiles"]:
        raise SystemExit("no tile covered: wrong .poly files?")


if __name__ == "__main__":
    main()
