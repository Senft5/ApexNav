"""Small real OSM extracts from the OSM editing API (/api/0.6/map), for development and test fixtures where Geofabrik is
out of reach (the build container's proxy drops download.geofabrik.de; CI uses Geofabrik).

    python -m tools.graph_etl.osm_api --bbox=-84.82,39.20,-84.52,39.32 --out dev.osm.pbf [--step 0.03] [--cache DIR]

The box is fetched in tiles of `step` degrees (a tile the API refuses for too many nodes is split in four), each kept in
the cache, then merged and filtered to what the graph ETL reads (roads, the point features on them, businesses,
land use, turn restrictions); buildings and the rest are dropped so fixtures stay small. Be gentle with the API: two
requests at a time, a pause between them. Data © OpenStreetMap contributors, ODbL.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import os
import time
import urllib.error
import urllib.request

import osmium

API = "https://api.openstreetmap.org/api/0.6/map?bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}"
KEEP_WAY_KEYS = ("highway", "landuse", "natural", "leisure", "waterway", "boundary", "route", "amenity", "shop", "office",
                 "tourism", "craft", "healthcare", "railway")
KEEP_NODE_KEYS = ("highway", "barrier", "railway", "traffic_calming", "crossing", "amenity", "shop", "office", "tourism",
                  "craft", "healthcare", "leisure")


def fetch(box, cache, depth=0):
    w, s, e, n = box
    path = os.path.join(cache, f"{w:.5f}_{s:.5f}_{e:.5f}_{n:.5f}.osm")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return [path]
    url = API.format(w=w, s=s, e=e, n=n)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Vetta graph ETL fixture builder (github.com/Senft5/ApexNav)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
            with open(path + ".part", "wb") as f:
                f.write(data)
            os.replace(path + ".part", path)
            time.sleep(1.0)
            return [path]
        except urllib.error.HTTPError as err:
            if err.code == 400 and depth < 4:      # too many nodes: split
                mx, my = (w + e) / 2, (s + n) / 2
                out = []
                for b in ((w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)):
                    out += fetch(b, cache, depth + 1)
                return out
            if err.code in (429, 509, 503, 504):
                time.sleep(10 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"could not fetch {url}")


def boxes(bbox, step):
    w, s, e, n = bbox
    out = []
    y = s
    while y < n - 1e-9:
        x = w
        while x < e - 1e-9:
            out.append((round(x, 5), round(y, 5), round(min(e, x + step), 5), round(min(n, y + step), 5)))
            x += step
        y += step
    return out


def keep_tags(tags, keys):
    return any(k in tags for k in keys)


def merge(paths, out, bbox=None):
    """Merge the API's files (duplicates at tile edges dropped), filtered, sorted, into one .osm.pbf."""
    ways, rels, need, bldg = {}, {}, set(), {}
    for p in paths:
        for o in osmium.FileProcessor(p, osmium.osm.WAY | osmium.osm.RELATION):
            if o.is_way():
                t = dict(o.tags)
                if keep_tags(t, KEEP_WAY_KEYS) and o.id not in ways:
                    ways[o.id] = (o.version, [nd.ref for nd in o.nodes], t)
                elif "building" in t and o.id not in bldg:
                    bldg[o.id] = [nd.ref for nd in o.nodes]
            else:
                t = dict(o.tags)
                if t.get("type") in ("restriction", "multipolygon") and (t.get("type") == "restriction" or keep_tags(t, ("landuse", "natural", "leisure", "boundary"))):
                    if o.id not in rels:
                        rels[o.id] = (o.version, [(m.type, m.ref, m.role) for m in o.members], t)
    for _, refs, _ in ways.values():
        need.update(refs)
    for refs in bldg.values():
        need.update(refs)
    nodes = {}
    for p in paths:
        for o in osmium.FileProcessor(p, osmium.osm.NODE):
            if o.id in nodes:
                continue
            t = dict(o.tags)
            if o.id in need or (t and keep_tags(t, KEEP_NODE_KEYS)):
                nodes[o.id] = (o.version, o.location.lat, o.location.lon, t)
    # a building is kept as one node at its centre (building=*), negative id: the ETL counts buildings beside the road
    centres = {}
    for wid, refs in bldg.items():
        pts = [nodes[r] for r in refs if r in nodes]
        if pts:
            centres[-wid] = (1, sum(p[1] for p in pts) / len(pts), sum(p[2] for p in pts) / len(pts), {"building": "yes"})
    keep_ids = set(r for _, refs, _ in ways.values() for r in refs)
    nodes = {k: v for k, v in nodes.items() if k in keep_ids or v[3]}
    nodes.update(centres)
    if os.path.exists(out):
        os.remove(out)
    w = osmium.SimpleWriter(out)
    for nid in sorted(nodes):
        v, la, lo, t = nodes[nid]
        w.add_node(osmium.osm.mutable.Node(id=nid, version=v, location=(lo, la), tags=t))
    for wid in sorted(ways):
        v, refs, t = ways[wid]
        if all(r in nodes for r in refs):
            w.add_way(osmium.osm.mutable.Way(id=wid, version=v, nodes=refs, tags=t))
    for rid in sorted(rels):
        v, mem, t = rels[rid]
        w.add_relation(osmium.osm.mutable.Relation(id=rid, version=v, members=mem, tags=t))
    w.close()
    return len(nodes), len(ways), len(rels)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bbox", required=True, help="west,south,east,north")
    ap.add_argument("--out", required=True)
    ap.add_argument("--step", type=float, default=0.03)
    ap.add_argument("--cache", default=os.path.join(os.path.expanduser("~"), ".cache", "vetta_osm_api"))
    ap.add_argument("--threads", type=int, default=2)
    a = ap.parse_args(argv)
    bbox = tuple(float(x) for x in a.bbox.split(","))
    os.makedirs(a.cache, exist_ok=True)
    paths = []
    with cf.ThreadPoolExecutor(a.threads) as ex:
        for got in ex.map(lambda b: fetch(b, a.cache), boxes(bbox, a.step)):
            paths += got
    n, w, r = merge(paths, a.out)
    print(f"{a.out}: {n} nodes, {w} ways, {r} relations from {len(paths)} API tiles")


if __name__ == "__main__":
    main()
