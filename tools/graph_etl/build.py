"""Build Vetta's scored road graph tiles (docs/OWN_ROUTING.md): OSM extract -> drivable graph -> per-edge features ->
scores from web/route_engine.js (tools/graph_etl/score_edges.js, node) -> v1 tiles (tools/graph_etl/tiles.py).

    python -m tools.graph_etl.build --pbf area.osm.pbf --tiles=-85.0,38.75,-84.0,39.75 --out web/data/graph/v1 \
        [--dem-cache DIR] [--work DIR] [--ctx web/data/ctx/v1]

--tiles is the box whose 0.25 degree tiles are written (whole tiles); give the extract a margin of a few km round it so
the per-km windows, land use and density at the edges see the roads beyond. Requirements: requirements.txt here, node.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import subprocess
import sys
import time

import numpy as np
import shapely

from . import dem as Dem
from . import features as F
from . import osm_graph as G
from . import tiles as T

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Valhalla's 0-15 road density from road km per km² within 2 km (every vehicle way, routable or not, as Valhalla's graph
# has them): medians on the calibration fixtures' router edges (tests/fixtures/route_engine: the router's density on
# 2055 edges against this measure, r = 0.94)
DENSITY_KNOTS = ([0.0, 3.07, 4.46, 5.31, 8.63, 9.91, 15.1, 25.0], [0, 1, 2, 3, 5, 7, 9, 15])
SIMPLIFY_M = 2.0
# seconds lost at a point feature inside an edge (end nodes are the router's turn cost, OWN_ROUTING.md §5)
DELAY_S = {"signal": 15.0, "stop": 7.0, "give_way": 2.0, "level_crossing": 4.0, "calming": 3.0, "crossing": 1.0}


def density_scale(v):
    return np.clip(np.round(np.interp(v, *DENSITY_KNOTS)), 0, 15)


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


def nan(v):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else v


def r6(p):
    return [round(p[1], 6), round(p[0], 6)]      # [lon, lat] as the corridor wants


STUB_M = 200.0


def trim_service(chains, coords=None):
    """Unnamed service roads and tracks that meet no public road at either end (the lanes inside car parks, campuses
    and trailer parks) are left out: a route only needs the entrance. They still count as joins (raw.vdeg). Entrances,
    through service roads and named ones stay."""
    minor = ("service", "track")
    if coords is not None:
        for c in chains:
            c.attrs = dict(c.attrs, _len=F.cumulative([coords[r] for r in c.nodes])[-1]) if c.attrs["hw"] in minor else c.attrs
    public = {}
    for c in chains:
        if c.attrs["hw"] not in minor:
            public[c.nodes[0]] = public[c.nodes[-1]] = True
    keep = [c for c in chains if c.attrs["hw"] not in minor or c.attrs["name"] or c.nodes[0] in public or c.nodes[-1] in public]
    # and the short unnamed dead-end stubs left (a car park's entrance, under STUB_M): a destination there snaps to the
    # street in front; longer ones (a farm lane, a park road) stay
    deg = {}
    for c in keep:
        deg[c.nodes[0]] = deg.get(c.nodes[0], 0) + 1
        deg[c.nodes[-1]] = deg.get(c.nodes[-1], 0) + 1
    out = []
    for c in keep:
        if (c.attrs["hw"] in minor and not c.attrs["name"] and (deg[c.nodes[0]] == 1 or deg[c.nodes[-1]] == 1)
                and c.attrs.get("_len", 0) < STUB_M):
            continue
        out.append(c)
    return out, len(chains) - len(out)


def split_long(raw, chains, max_m=T.MAX_EDGE_M):
    """Chains longer than max_m cut at their interior nodes so no edge is longer (len_dm fits the tile's u16)."""
    out = []
    for c in chains:
        cs = [raw.coords[r] for r in c.nodes]
        cum = F.cumulative(cs)
        if cum[-1] <= max_m:
            out.append(c)
            continue
        # a single segment longer than half the limit gets points of its own (synthetic ids) so it can be cut
        nodes = [c.nodes[0]]
        for a, b, la, lb in zip(c.nodes, c.nodes[1:], cs, cs[1:]):
            seg = G.hav(la, lb)
            parts = int(seg // (max_m / 2))
            for q in range(1, parts + 1):
                f = q / (parts + 1)
                syn = -(20_000_000_000 + len(raw.coords))
                raw.coords[syn] = (la[0] + (lb[0] - la[0]) * f, la[1] + (lb[1] - la[1]) * f)
                nodes.append(syn)
            nodes.append(b)
        c = G.Chain(nodes, c.attrs, c.way_first, c.way_last, c.ways)
        cum = F.cumulative([raw.coords[r] for r in c.nodes])
        start, base = 0, 0.0
        for k in range(1, len(c.nodes)):
            last = k == len(c.nodes) - 1
            if last or cum[k + 1] - base > max_m:
                piece = G.Chain(c.nodes[start:k + 1], c.attrs, c.way_first if start == 0 else c.ways[0],
                                c.way_last if last else c.ways[-1], c.ways)
                out.append(piece)
                start, base = k, cum[k]
    return out


def features(raw, chains):
    g = F.Graph(raw, chains)
    log(f"graph: {len(chains)} chains, {round(sum(g.length) / 1000)} km")
    kinds, full, interior, gates = F.point_counts(g)
    per = F.windowed(g, full, F.WINDOW_M)
    biz = F.windowed(g, F.near_counts(g, raw.pois, F.BUSINESS_M)[:, None], F.WINDOW_M)[:, 0]
    bldg = F.windowed(g, F.near_counts(g, raw.buildings, F.BUILDING_M)[:, None], F.BLDG_WINDOW_M)[:, 0]
    addr = F.windowed(g, F.near_counts(g, raw.addresses, F.ADDRESS_M)[:, None], F.BLDG_WINDOW_M)[:, 0] if raw.addresses else None
    civic = F.windowed(g, np.column_stack([F.near_counts(g, raw.schools, F.CIVIC_M), F.near_counts(g, raw.worship, F.CIVIC_M)]), F.WINDOW_M)
    walk = F.sidewalks(g, raw)
    log("per-km counts done")
    S, H, owner = F.probes(g)
    lu, mapped = F.landuse_shares(raw, S, H)
    log(f"land use on {len(S)} samples")
    wnear, wfollow = F.water(raw, S, H)
    _, dens = F.road_density(g, S, density_scale, raw.road_segs)
    log("water and density done")
    starts = np.searchsorted(owner, np.arange(len(chains) + 1))
    return g, dict(kinds=kinds, per=per, interior=interior, gates=gates, biz=biz, bldg=bldg, addr=addr, civic=civic, walk=walk,
                   lu=lu, mapped=mapped,
                   wnear=wnear, wfollow=wfollow, dens=dens, starts=starts)


def chain_record(g, f, k):
    c = g.chains[k]
    a = c.attrs
    s0, s1 = f["starts"][k], f["starts"][k + 1]
    ki = {kd: i for i, kd in enumerate(f["kinds"])}
    per = f["per"][k]
    surface = a["surface"]
    ch = {
        "road_class": a["rc"], "road_use": a["use"], "lanes": a["lanes"], "surface": surface, "sidewalk": a["sidewalk"] if a["sidewalk"] is not None else nan(float(f["walk"][k])),
        "truck_route": a["truck"], "bridge": a["bridge"], "tunnel": a["tunnel"], "toll": a["toll"], "ramp": a["ramp"],
        "roundabout": a["roundabout"], "access_destination": a["destination"], "speed_limit_kph": a["maxspeed"],
        "addr_per_km": f["addr"][k] if f["addr"] is not None else None,
        "signals_per_km": per[ki["signal"]], "stops_per_km": per[ki["stop"]], "crossings_per_km": per[ki["crossing"]],
        "calming_per_km": per[ki["calming"]], "access_per_km": per[-1], "business_per_km": f["biz"][k],
        "bldg_per_km": f["bldg"][k], "lit": a["lit"],
    }
    smp = {f"lu_{c_}": np.round(f["lu"][c_][s0:s1], 3).tolist() for c_ in F.LU_CLASSES}
    smp["lu_mapped"] = np.round(f["mapped"][s0:s1], 3).tolist()
    smp["water_near"] = f["wnear"][s0:s1].tolist()
    smp["creek_follow"] = f["wfollow"][s0:s1].tolist()
    smp["density"] = f["dens"][s0:s1].tolist()
    inner = {kd: int(f["interior"][k][i]) for kd, i in ki.items() if f["interior"][k][i]}
    delay = sum(DELAY_S[kd] * n for kd, n in inner.items())
    ferry_s = None
    if a["ferry"] and a.get("duration"):
        try:
            parts = [float(x) for x in a["duration"].split(":")]
            ferry_s = parts[0] * 3600 + (parts[1] * 60 if len(parts) > 1 else 0) + (parts[2] if len(parts) > 2 else 0) if len(parts) > 1 else parts[0] * 60
        except ValueError:
            ferry_s = None
    return {"k": k, "c": [r6(p) for p in g.coords[k]], "pre": [r6(p) for p in g.ext_coords(k, 0)],
            "post": [r6(p) for p in g.ext_coords(k, 1)], "ch": {x: nan(float(v)) if v is not None else None for x, v in ch.items()},
            "smp": smp, "delay_s": delay,
            "store": {"schools_per_km": float(f["civic"][k][0]), "worship_per_km": float(f["civic"][k][1])}, "name": a["name"], "hw": a["hw"], "ferry_s": ferry_s}


def road_channels(g, f, k, sc):
    """The road-side evidence stored in the tile beside the scores (tiles.CHANNELS), for the router's own ranking."""
    ki = {kd: i for i, kd in enumerate(f["kinds"])}
    per = f["per"][k]
    a = g.chains[k].attrs
    walk = a["sidewalk"] if a["sidewalk"] is not None else f["walk"][k]
    return {"business_per_km": float(f["biz"][k]), "access_per_km": float(per[-1]), "signals_per_km": float(per[ki["signal"]]),
            "stops_per_km": float(per[ki["stop"]]), "crossings_per_km": float(per[ki["crossing"]]),
            "calming_per_km": float(per[ki["calming"]]), "schools_per_km": float(f["civic"][k][0]),
            "worship_per_km": float(f["civic"][k][1]), "sidewalk": None if walk is None or walk != walk else float(walk),
            "built": sc.get("built"), "density": sc.get("dens"), "bldg_per_km": float(f["bldg"][k]),
            "addr_per_km": float(f["addr"][k]) if f["addr"] is not None else None}


def simplify(coords):
    if len(coords) <= 2:
        return coords
    a = np.array(coords)
    x, y = F.xy(a[:, 0], a[:, 1])
    ls = shapely.simplify(shapely.linestrings(np.column_stack([x, y])), SIMPLIFY_M, preserve_topology=False)
    xy = shapely.get_coordinates(ls)
    lat = xy[:, 1] / 110540.0
    lon = xy[:, 0] / (111320.0 * np.cos(np.radians(lat)))
    out = list(zip(lat.tolist(), lon.tolist()))
    out[0], out[-1] = coords[0], coords[-1]
    return out


def micro(p):
    return (int(round(p[0] * 1e6)), int(round(p[1] * 1e6)))


def assemble(raw, g, scores, keep_tiles, build_day, model_hash):
    """Scored chains -> Tile objects for the tiles in keep_tiles."""
    chains = g.chains
    # graph nodes and their tiles
    node_tile, deg = {}, {}
    for c in chains:
        for r in (c.nodes[0], c.nodes[-1]):
            deg[r] = deg.get(r, 0) + 1
            if r not in node_tile:
                la, lo = raw.coords[r]
                node_tile[r] = T.tile_of(la, lo)
    by_tile = {}
    for r, t in node_tile.items():
        by_tile.setdefault(t, []).append(r)
    local = {}
    tiles = {}
    for t, rs in by_tile.items():
        if t not in keep_tiles:
            continue
        rs.sort(key=lambda r: (raw.coords[r][0], raw.coords[r][1], r))
        tl = T.Tile(i=t[0], j=t[1], build_day=build_day, model_hash=model_hash)
        for idx, r in enumerate(rs):
            local[r] = idx
            la, lo = micro(raw.coords[r])
            tl.lat.append(la)
            tl.lon.append(lo)
            f = raw.feats.get(r, set())
            fl = 0
            for kd, bit in (("signal", T.N_SIGNAL), ("stop", T.N_STOP), ("give_way", T.N_GIVE_WAY), ("level_crossing", T.N_LEVEL_CROSSING),
                            ("crossing", T.N_CROSSING), ("calming", T.N_CALMING)):
                if kd in f:
                    fl |= bit
            if "gate" in f or "block" in f:
                fl |= T.N_BARRIER
            if deg.get(r, 0) == 1 or "block" in f:
                fl |= T.N_DEAD_END
            tl.node_flags.append(fl)
        tiles[t] = tl
    # local indices for nodes in tiles we don't write (edges can still point at them)
    for t, rs in by_tile.items():
        if t in keep_tiles:
            continue
        rs.sort(key=lambda r: (raw.coords[r][0], raw.coords[r][1], r))
        for idx, r in enumerate(rs):
            local[r] = idx
    # directed edges, in their final order per tile: by from node, then chain, forward first
    directed = {}
    for k, c in enumerate(chains):
        sc = scores.get(k)
        if sc is None:
            continue
        a, b = c.nodes[0], c.nodes[-1]
        dirs = [(True, a, b)] + ([] if c.attrs["oneway"] else [(False, b, a)])
        for fwd, u, v in dirs:
            if node_tile[u] in keep_tiles:
                directed.setdefault(node_tile[u], []).append((local[u], k, 0 if fwd else 1, u, v, fwd))
    edge_index = {}       # (chain, fwd) -> (tile, index)
    for t, lst in directed.items():
        lst.sort()
        for idx, (_, k, _, _, _, fwd) in enumerate(lst):
            edge_index[(k, fwd)] = (t, idx)
    for t, lst in directed.items():
        tl = tiles[t]
        geom_of = {}
        for _, k, _, u, v, fwd in lst:
            c, sc = chains[k], scores[k]
            a = c.attrs
            if k not in geom_of:
                geom_of[k] = len(tl.geoms)
                tl.geoms.append([micro(p) for p in simplify(g.coords[k])])
                tl.geom_ch.append(sc.get("st") or {})
            cs = g.coords[k] if fwd else list(reversed(g.coords[k]))
            cm = F.cumulative(cs)
            flags = 0
            if a["oneway"]:
                flags |= T.ONEWAY
            for key, bit in (("toll", T.TOLL), ("ferry", T.FERRY), ("tunnel", T.TUNNEL), ("bridge", T.BRIDGE), ("ramp", T.RAMP),
                             ("roundabout", T.ROUNDABOUT), ("destination", T.DESTINATION)):
                if a.get(key):
                    flags |= bit
            if a["surface"] is not None and a["surface"] >= 3:
                flags |= T.UNPAVED
            if a["hw"] == "motorway":
                flags |= T.MOTORWAY
            if not fwd:
                flags |= T.GEOM_REV
            if sc.get("est"):
                flags |= T.SPEED_EST
            if sc.get("gate"):
                flags |= T.BARRIER
            tl.edges.append((local[u], T.Edge(
                to=local[v], to_tile=node_tile[v], len_dm=int(round(g.length[k] * 10)),
                t_ds=int(round(sc["t"] * 10)), quality=sc["q"], scenery=sc["s"], fun=sc["f"], conf=sc["c"] or 0.0,
                flags=flags, cls=a["cls"], speed=int(round(sc["v"])) if sc.get("v") else 0, name=a["name"],
                geom=geom_of[k], h_in=F.head_over(cs, cm, False), h_out=F.head_over(cs, cm, True))))
    # turn restrictions (via node), in the via node's tile
    applied = skipped = 0
    by_end = {}
    for k, c in enumerate(chains):
        by_end.setdefault(c.nodes[-1], []).append((k, True))     # forward edge arrives at its last node
        by_end.setdefault(c.nodes[0], []).append((k, False))
    for frm_way, via, to_way, only in raw.restrictions:
        if via not in node_tile or node_tile[via] not in tiles:
            skipped += 1
            continue
        froms = [(k, fwd) for k, fwd in by_end.get(via, []) if (k, fwd) in edge_index
                 and (chains[k].way_last if fwd else chains[k].way_first) == frm_way]
        tos = [(k, fwd) for k, fwd in by_end.get(via, []) if (k, not fwd) in edge_index
               and (chains[k].way_first if not fwd else chains[k].way_last) == to_way]
        # by_end lists edges ARRIVING at via; an edge leaving via is the other direction of the same chain
        tos = [(k, not fwd) for k, fwd in tos]
        if not froms or not tos:
            skipped += 1
            continue
        for fk in froms:
            for tk in tos:
                ft, fi = edge_index[fk]
                tt, ti = edge_index[tk]
                if tt != node_tile[via]:
                    continue
                tiles[tt].restrictions.append(T.Restriction(from_edge=fi, via=local[via], to_edge=ti, only=only,
                                                            from_tile=None if ft == tt else ft))
                applied += 1
    return tiles, {"restrictions_applied": applied, "restrictions_skipped": skipped,
                   "via_way_restrictions_not_applied": raw.via_way_restrictions}


def run_scorer(records_path, scores_path, dem_cache, ctx_dir):
    cmd = ["node", os.path.join(ROOT, "tools", "graph_etl", "score_edges.js"), "--in", records_path, "--out", scores_path]
    if dem_cache:
        cmd += ["--dem", dem_cache]
    if ctx_dir:
        cmd += ["--ctx", ctx_dir]
    subprocess.run(cmd, check=True)
    scores, meta = {}, {}
    with open(scores_path) as fh:
        for line in fh:
            o = json.loads(line)
            if "meta" in o:
                meta = o["meta"]
            else:
                scores[o["k"]] = o
    return scores, meta


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pbf", required=True)
    ap.add_argument("--tiles", required=True, help="west,south,east,north: write the 0.25 degree tiles this box touches")
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", default=None)
    ap.add_argument("--dem-cache", default=None, help="Terrarium z12 tiles (fetched here if missing); omit for no DEM")
    ap.add_argument("--ctx", default=os.path.join(ROOT, "web", "data", "ctx", "v1"))
    ap.add_argument("--source", default="OpenStreetMap", help="the extract's name for index.json")
    a = ap.parse_args(argv)
    w, s, e, n = (float(x) for x in a.tiles.split(","))
    i0, j0 = T.tile_of(s, w)
    i1, j1 = T.tile_of(n - 1e-9, e - 1e-9)
    keep = {(i, j) for i in range(i0, i1 + 1) for j in range(j0, j1 + 1)}
    work = a.work or os.path.join(a.out, "..", "_work")
    os.makedirs(work, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)
    log(f"reading {a.pbf}")
    raw = G.read(a.pbf)
    log(f"{len(raw.ways)} drivable ways, {len(raw.pois)} businesses, {len(raw.buildings)} buildings, "
        f"{len(raw.landuse)} land-use polygons, {len(raw.restrictions)} restrictions")
    chains, _ = G.build_chains(raw)
    chains, trimmed = trim_service(chains, raw.coords)
    chains = split_long(raw, chains)
    log(f"{trimmed} car-park / campus service chains left out")
    g, f = features(raw, chains)
    if a.dem_cache:
        tw = (i0 * T.TILE_DEG - 180, j0 * T.TILE_DEG - 90, (i1 + 1) * T.TILE_DEG - 180, (j1 + 1) * T.TILE_DEG - 90)
        got, want = Dem.fetch(tw, a.dem_cache)
        log(f"DEM: {got} of {want} z12 tiles")
    # score the chains with an end in a written tile
    rec_path, sc_path = os.path.join(work, "edges.ndjson"), os.path.join(work, "scores.ndjson")
    count = 0
    with open(rec_path, "w") as fh:
        for k, c in enumerate(chains):
            ends = [T.tile_of(*raw.coords[c.nodes[0]]), T.tile_of(*raw.coords[c.nodes[-1]])]
            if not any(t in keep for t in ends):
                continue
            rec = chain_record(g, f, k)
            rec["gate"] = bool(f["gates"][k])
            fh.write(json.dumps(rec, separators=(",", ":")) + "\n")
            count += 1
    log(f"scoring {count} edges with web/route_engine.js")
    scores, meta = run_scorer(rec_path, sc_path, a.dem_cache, a.ctx)
    for k in scores:
        scores[k]["gate"] = bool(f["gates"][k])
        scores[k]["st"] = road_channels(g, f, k, scores[k])
    today = dt.date.today()
    day = (today - dt.date(1970, 1, 1)).days
    mh = int(meta.get("model", "0")[:8] or "0", 16)
    tiles, rstats = assemble(raw, g, scores, keep, day, mh)
    index = {"version": T.VERSION, "format": "VGR1 (tools/graph_etl/tiles.py)", "built": today.isoformat(),
             "osm": raw.timestamp, "source": a.source, "model": meta.get("model"), "model_files": meta.get("files"),
             "tile_deg": T.TILE_DEG, "bbox": [w, s, e, n], "tiles": {}, "stats": rstats,
             "licence": "Road data (c) OpenStreetMap contributors, ODbL 1.0; elevation Mapzen Terrain Tiles; context grid: see web/data/ctx/v1"}
    total = 0
    for t in sorted(tiles):
        tl = tiles[t]
        if not tl.edges and not tl.lat:
            continue
        b = T.write_tile(tl)
        with open(os.path.join(a.out, f"{t[0]}_{t[1]}.vgr"), "wb") as fh:
            fh.write(b)
        index["tiles"][f"{t[0]}_{t[1]}"] = {"bytes": len(b), "nodes": len(tl.lat), "edges": len(tl.edges),
                                             "restrictions": len(tl.restrictions)}
        total += len(b)
    index["bytes"] = total
    with open(os.path.join(a.out, "index.json"), "w") as fh:
        json.dump(index, fh, indent=1, sort_keys=True)
        fh.write("\n")
    log(f"wrote {len(index['tiles'])} tiles, {total / 1e6:.2f} MB, restrictions {rstats}")


if __name__ == "__main__":
    sys.exit(main())
