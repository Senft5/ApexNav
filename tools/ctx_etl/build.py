"""Build context-grid bundles for a region.

    python -m tools.ctx_etl.build --preset cincinnati                       # -> web/data/ctx/v1 (committed)
    python -m tools.ctx_etl.build --preset launch --out ctx_out             # the seven launch states (GitHub workflow)
    python -m tools.ctx_etl.build --states OH,KY --bbox -85,38,-83,40 --out x --only noise_db,hpms

The region is the given states clipped to the box. Every z12 tile it touches is "covered": rasters are filled there and
road spans and crashes are complete there (a covered tile with no crash really had none in FARS's years). Outside the
covered tiles everything is unknown.

Bundle contents besides the raster channels (see vcg.py and grid.CHANNELS):
- lines (HPMS road sections): line_n (u16 vertices per line), line_x0, line_y0 (u16 first vertex), line_dx, line_dy (u16
  zigzag steps to each next vertex; transforms.delta_lines). Coordinates are bundle units 0..65535 across the z8 tile
  (about 2.4 m). Per line line_aadt (u32 vehicles/day), line_iri (u16 in/mi), line_speed (u8 mph),
  line_lanes (u8 through lanes), line_fclass (u8 FHWA functional system 1 interstate .. 7 local); the top value of each
  type is "not reported".
- points (FARS fatal crashes): pt_x, pt_y (u16 bundle units), pt_year (u16), pt_fatals (u8), pt_hour (u8, 255 unknown).
- parks: the NPS units table the park_unit channel indexes (1-based), with annual and monthly recreation visits.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import sys
import time

import numpy as np

from . import grid, sources, transforms, vcg

VERSION = 1
PRESETS = {
    # Hamilton and Clermont (OH), Boone, Kenton and Campbell (KY), and the Indiana corner (Dearborn) inside the same box.
    "cincinnati": {"states": ["OH", "KY", "IN"], "bbox": [-84.90, 38.70, -83.95, 39.33], "out": "web/data/ctx/v1"},
    # The launch region: the owner's Cincinnati plus the Southern Appalachians.
    "launch": {"states": ["OH", "KY", "IN", "WV", "TN", "NC", "VA"], "bbox": None, "out": "ctx_out/v1"},
    # Ohio, Kentucky and Indiana: the region Vetta's own routing covers (served from the graph-data branch)
    "region": {"states": ["OH", "KY", "IN"], "bbox": None, "out": "ctx_out/v1"},
}
RASTERS = ["night_lights", "impervious_pct", "canopy_pct", "noise_db", "housing_density", "population_density",
           "address_density", "median_year_built", "flood_zone", "cropland_class", "park_unit"]
FARS_YEARS = list(range(2020, 2025))


def covered_tiles(ctx, states, bbox):
    """The z12 tiles of the region (the states, clipped to the box)."""
    from shapely.geometry import box
    from shapely.ops import unary_union
    from shapely.prepared import prep
    shapes = sources.state_boundaries(ctx, states)
    region = unary_union(list(shapes.values()))
    if bbox:
        region = region.intersection(box(*bbox))
    w, s, e, n = region.bounds
    pr = prep(region)
    out = []
    for x, y in grid.tiles_in_bbox(w, s, e, n, grid.TILE_Z):
        if pr.intersects(box(*grid.tile_bounds_lonlat(x, y, grid.TILE_Z))):
            out.append((x, y))
    return out, (w, s, e, n)


def channel_tiles(ctx, name, bx, by, tiles, producer, threads):
    """{(i, j): n x n float} for the covered tiles of one bundle, made in 4 x 4-tile chunks."""
    n = grid.CHANNELS[name][0]
    chunks = sorted({(i // 4, j // 4) for i, j in tiles})
    want = set(tiles)

    def one(c):
        ci, cj = c
        win = sources.Window(bx, by, ci * 4, cj * 4, ci * 4 + 3, cj * 4 + 3, n)
        win.want = want
        return win.split(producer(win))

    out = {}
    with cf.ThreadPoolExecutor(threads) as ex:
        for part in ex.map(one, chunks):
            out.update({t: v for t, v in part.items() if t in want})
    return out


def encode_lines(rows, bx, by):
    """HPMS rows -> the bundle's line arrays (only the parts inside the bundle, simplified to ~2 m)."""
    starts, xy = [0], []
    attrs = {k: [] for k in ("aadt", "iri", "speed_limit", "lanes", "fclass")}
    box = (-200, -200, 65735, 65735)
    for _key, a, coords in rows:
        u = [transforms.to_bundle_units(lo, la, bx, by) for lo, la in coords]
        # local roads carry nothing but their class here (they keep matches honest), so they are kept coarser (~4 m)
        info = any(a.get(k) is not None for k in ("aadt", "iri", "speed_limit"))
        tol = 0.8 if info or (a.get("fclass") or 7) < 7 else 2.0
        for run in transforms.clip_segment_to_box(u, box):
            run = transforms.simplify(run, tol)
            q = [(min(65535, max(0, round(x))), min(65535, max(0, round(y)))) for x, y in run]
            q = [p for k, p in enumerate(q) if k == 0 or p != q[k - 1]]
            if len(q) < 2 or len(q) > 65535:
                continue
            xy += q
            starts.append(len(xy))
            for k in attrs:
                attrs[k].append(a.get(k))
    return starts, xy, attrs


def int_or(v, nodata, top):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return nodata
    if not np.isfinite(f) or f < 0:
        return nodata
    return int(min(round(f), top))


# A posted limit HPMS can hold: 5 to 85 mph (the highest posted in the US). Anything else is a state's "not reported"
# code (999 and the like), which the u8 used to clamp to 254 mph and the phone read as a measured limit (281 spans of
# the Cincinnati bundles, 2026-11-09). web/route_ctx/context_grid.js LIMIT_MPH refuses the same range in bundles built
# before this.
LIMIT_MPH = (5, 85)


def limit_or(v, nodata=255):
    """A posted limit in mph as stored (u8), or nodata when it isn't one."""
    x = int_or(v, nodata, 254)
    return x if x != nodata and LIMIT_MPH[0] <= x <= LIMIT_MPH[1] else nodata


def build(args):
    t0 = time.time()
    ctx = sources.Ctx(args.cache)
    preset = PRESETS.get(args.preset, {})
    states = args.states.split(",") if args.states else preset["states"]
    bbox = [float(v) for v in args.bbox.split(",")] if args.bbox else preset.get("bbox")
    out_dir = args.out or preset["out"]
    only = set(args.only.split(",")) if args.only else None
    want = lambda k: only is None or k in only   # noqa: E731

    tiles, rbox = covered_tiles(ctx, states, bbox)
    bundles = {}
    for x, y in tiles:
        bundles.setdefault((x // 16, y // 16), []).append((x % 16, y % 16))
    ctx.log(f"region {states} {['%.3f' % v for v in rbox]}: {len(tiles)} z12 tiles in {len(bundles)} bundles")
    if args.shard:
        # one of n parallel jobs (.github/workflows/ctx-region.yml): every n-th bundle, the coverage still the whole region's
        k, n = (int(v) for v in args.shard.split("/"))
        mine = sorted(bundles)[k::n]
        bundles = {b: bundles[b] for b in mine}
        ctx.log(f"shard {k}/{n}: {len(bundles)} bundles {sorted(bundles)}")

    # region-wide sources, loaded once
    counties = sources.county_boundaries(ctx, states)
    bset = set(bundles)
    blocks = sources.Blocks(ctx, states, rbox, bset) if want("housing_density") or want("population_density") else None
    yb = sources.YearBuilt(ctx, states, rbox, bset) if want("median_year_built") else None
    addr = sources.Addresses(ctx, states, rbox, counties) if want("address_density") else None
    parks = sources.Parks(ctx, rbox) if want("park_unit") else None
    # the owner's Earthdata account (GitHub secret; sources.py): without it night lights are the 2016 image, as before
    night_src = "night_viirs" if want("night_lights") and sources.night_prepare(ctx, rbox) else "night"
    ctx.log(f"  night lights: {'NASA Black Marble VNP46A4 (Earthdata token)' if night_src == 'night_viirs' else 'Black Marble 2016 (GIBS)'}")
    state_shapes = sources.state_boundaries(ctx, states)

    def hpms_for(bx, by):
        """The HPMS sections of every region state inside this bundle (asked per bundle, so memory stays small)."""
        from shapely.geometry import box
        W, S, E, N = grid.tile_bounds_lonlat(bx, by, grid.BUNDLE_Z)
        area = box(W - 0.01, S - 0.01, E + 0.01, N + 0.01).intersection(box(*rbox))
        rows = []
        for st in states:
            part = state_shapes[st].intersection(area)
            if not part.is_empty:
                rows += sources.hpms_rows(ctx, st, part.bounds)
        return rows

    fars = sources.fars_points(ctx, states, FARS_YEARS) if want("fars") else np.zeros((0, 5))
    if want("fars"):
        ctx.log(f"  FARS {FARS_YEARS[0]}-{FARS_YEARS[-1]}: {len(fars)} fatal crashes in {states}")

    producers = {
        "night_lights": lambda w: sources.night_lights(ctx, w),
        "impervious_pct": lambda w: sources.nlcd(ctx, "impervious_pct", w),
        "canopy_pct": lambda w: sources.nlcd(ctx, "canopy_pct", w),
        "noise_db": lambda w: sources.noise(ctx, w),
        "housing_density": lambda w: blocks.density(w, "housing"),
        "population_density": lambda w: blocks.density(w, "people"),
        "address_density": lambda w: addr.density(w),
        "median_year_built": lambda w: yb.raster(w),
        "flood_zone": lambda w: sources.flood(ctx, w),
        "cropland_class": lambda w: sources.cdl(ctx, w),
        "park_unit": lambda w: parks.raster(w),
    }
    src_of = {"night_lights": night_src, "impervious_pct": "nlcd", "canopy_pct": "nlcd", "noise_db": "noise",
              "housing_density": "census", "population_density": "census", "address_density": "addresses",
              "median_year_built": "census", "flood_zone": "flood", "cropland_class": "cdl", "park_unit": "parks"}

    os.makedirs(out_dir, exist_ok=True)
    index = {"v": VERSION, "built": dt.date.today().isoformat(), "region": args.preset or "custom", "states": states,
             "bbox": [round(v, 4) for v in rbox], "bundles": {}, "channels": {}, "sources": {}}
    total = 0
    for (bx, by), btiles in sorted(bundles.items()):
        tb = time.time()
        btiles = sorted(btiles, key=lambda t: (t[1], t[0]))
        header = {"v": VERSION, "z": grid.BUNDLE_Z, "x": bx, "y": by, "tile_z": grid.TILE_Z, "built": index["built"],
                  "coverage": [list(t) for t in btiles], "states": states, "channels": {}, "sources": {}}
        w = vcg.Writer(header)
        for name in RASTERS:
            if not want(name):
                continue
            n, dtype, scale, offset, nodata, unit, _how, meaning = grid.CHANNELS[name]
            try:
                per = channel_tiles(ctx, name, bx, by, btiles, producers[name], args.threads)
            except Exception as e:  # noqa: BLE001 - one dataset down must not sink the rest
                ctx.log(f"  ! {name} failed in bundle {bx}/{by}: {e}")
                continue
            keep = [t for t in btiles if t in per and np.isfinite(per[t]).any()]
            if not keep:
                continue
            raw = np.concatenate([transforms.quantise(per[t], scale, offset, nodata, dtype).ravel() for t in keep])
            header["channels"][name] = {"n": n, "scale": scale, "offset": offset, "nodata": nodata, "unit": unit,
                                        "meaning": meaning, "source": src_of[name], "tiles": [list(t) for t in keep],
                                        "array": w.add("ch_" + name, raw, dtype)}
            header["sources"][src_of[name]] = sources.SOURCES[src_of[name]]
        if parks is not None and "park_unit" in header["channels"]:
            header["parks"] = parks.table()
        if want("hpms"):
            starts, xy, attrs = encode_lines(hpms_for(bx, by), bx, by)
            if len(starts) > 1:
                counts = np.diff(starts)
                x0, y0, dx, dy = transforms.delta_lines(counts, xy)
                if max(dx.max(initial=0), dy.max(initial=0)) > 65535:
                    raise ValueError("a line step too long for u16")
                header["lines"] = {"count": len(starts) - 1, "n": w.add("line_n", counts, "u16"),
                                   "x0": w.add("line_x0", x0, "u16"), "y0": w.add("line_y0", y0, "u16"),
                                   "dx": w.add("line_dx", dx, "u16"), "dy": w.add("line_dy", dy, "u16"), "attrs": {
                                       "aadt": {"array": w.add("line_aadt", [int_or(v, 0xFFFFFFFF, 0xFFFFFFFE) for v in attrs["aadt"]], "u32"), "nodata": 0xFFFFFFFF, "unit": "vehicles/day"},
                                       "iri": {"array": w.add("line_iri", [int_or(v, 65535, 65534) for v in attrs["iri"]], "u16"), "nodata": 65535, "unit": "in/mi"},
                                       "speed_limit": {"array": w.add("line_speed", [limit_or(v) for v in attrs["speed_limit"]], "u8"), "nodata": 255, "unit": "mph"},
                                       "lanes": {"array": w.add("line_lanes", [int_or(v, 255, 254) for v in attrs["lanes"]], "u8"), "nodata": 255, "unit": "through lanes"},
                                       "fclass": {"array": w.add("line_fclass", [int_or(v, 255, 254) for v in attrs["fclass"]], "u8"), "nodata": 255, "unit": "FHWA F_SYSTEM"}}}
                header["sources"]["hpms"] = sources.SOURCES["hpms"]
        if want("fars"):
            W, S, E, N = grid.tile_bounds_lonlat(bx, by, grid.BUNDLE_Z)
            sel = fars[(fars[:, 0] >= W) & (fars[:, 0] < E) & (fars[:, 1] >= S) & (fars[:, 1] < N)] if len(fars) else fars
            if len(sel):                                   # only the covered tiles' crashes (elsewhere density is unknown)
                cov = {(bx * 16 + i, by * 16 + j) for i, j in btiles}
                sel = sel[[grid.lonlat_to_tile(lo, la, grid.TILE_Z) in cov for lo, la in sel[:, :2]]]
            ux, uy = (np.array(v) for v in zip(*[transforms.to_bundle_units(lo, la, bx, by) for lo, la in sel[:, :2]])) if len(sel) else (np.zeros(0), np.zeros(0))
            header["points"] = {"count": int(len(sel)), "years": [FARS_YEARS[0], FARS_YEARS[-1]], "kind": "fatal_crash",
                                "x": w.add("pt_x", np.clip(np.round(ux), 0, 65535), "u16"), "y": w.add("pt_y", np.clip(np.round(uy), 0, 65535), "u16"),
                                "year": w.add("pt_year", sel[:, 2] if len(sel) else [], "u16"), "fatals": w.add("pt_fatals", np.clip(sel[:, 3], 0, 255) if len(sel) else [], "u8"),
                                "hour": w.add("pt_hour", sel[:, 4] if len(sel) else [], "u8")}
            header["sources"]["fars"] = sources.SOURCES["fars"]
        data = w.tobytes()
        path = os.path.join(out_dir, str(grid.BUNDLE_Z), str(bx), f"{by}.vcg")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        total += len(data)
        index["bundles"][f"{bx}/{by}"] = {"bytes": len(data), "tiles": len(btiles), "channels": sorted(header["channels"]),
                                          "lines": header.get("lines", {}).get("count", 0), "points": header.get("points", {}).get("count", 0)}
        index["sources"].update(header["sources"])
        for k, v in header["channels"].items():
            index["channels"][k] = {kk: v[kk] for kk in ("n", "unit", "meaning", "source")}
        ctx.log(f"bundle 8/{bx}/{by}: {len(btiles)} tiles, {len(header['channels'])} channels, "
                f"{header.get('lines', {}).get('count', 0)} road spans, {header.get('points', {}).get('count', 0)} crashes, "
                f"{len(data) / 1e6:.2f} MB, {time.time() - tb:.0f} s")
    index["bytes"] = total
    if sources.night_check_summary():
        ctx.log("  " + sources.night_check_summary())
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(index, f, indent=1, sort_keys=True)
        f.write("\n")
    ctx.log(f"done: {len(bundles)} bundles, {total / 1e6:.2f} MB, {time.time() - t0:.0f} s")
    return index


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preset", choices=sorted(PRESETS), default=None)
    ap.add_argument("--states", help="comma-separated state abbreviations (overrides the preset)")
    ap.add_argument("--bbox", help="west,south,east,north in degrees (overrides the preset)")
    ap.add_argument("--out", help="output directory (default: the preset's)")
    ap.add_argument("--cache", default=os.environ.get("CTX_CACHE", ".ctx_cache"))
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--shard", help="k/n: build only every n-th bundle starting at k (parallel jobs; merge_index joins them)")
    ap.add_argument("--only", help="comma-separated channels (plus 'hpms', 'fars') to build, for testing")
    args = ap.parse_args(argv)
    if not args.preset and not args.states:
        ap.error("give --preset or --states")
    build(args)


def merge_index(out_dir, shard_dirs):
    """Join parallel shards (--shard) into out_dir: python -m tools.ctx_etl.build --merge OUT SHARD_DIR..."""
    import shutil
    ix = None
    for d in shard_dirs:
        p = os.path.join(d, "index.json")
        if not os.path.exists(p):
            continue
        j = json.load(open(p))
        if ix is None:
            ix = {k: v for k, v in j.items() if k not in ("bundles", "bytes")}
            ix["bundles"], ix["bytes"] = {}, 0
        for key, meta in j["bundles"].items():
            bx, by = key.split("/")
            dst = os.path.join(out_dir, str(grid.BUNDLE_Z), bx, f"{by}.vcg")
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(os.path.join(d, str(grid.BUNDLE_Z), bx, f"{by}.vcg"), dst)
            ix["bundles"][key] = meta
            ix["bytes"] += meta["bytes"]
        ix.setdefault("channels", {}).update(j.get("channels", {}))
        ix.setdefault("sources", {}).update(j.get("sources", {}))
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(ix or {"v": VERSION, "bundles": {}}, f, indent=1, sort_keys=True)
        f.write("\n")
    return ix


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--merge":
        r = merge_index(sys.argv[2], sys.argv[3:])
        print(f"{len(r['bundles'])} bundles, {r['bytes'] / 1e6:.1f} MB")
        sys.exit(0)
    sys.exit(main())
