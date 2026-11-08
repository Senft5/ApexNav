"""The ETL's pure transforms (numpy only, unit-tested in tests/test_ctx_etl.py). No network, no GDAL."""
import math

import numpy as np

from . import grid

# The BTS noise map's legend (Hosted/NTAD_Noise_2020_CONUS_Road MapServer, layer 3), RGB -> class floor in dB.
NOISE_PALETTE = {
    (255, 193, 7): 45, (255, 128, 0): 50, (255, 0, 0): 55, (255, 51, 153): 60,
    (163, 0, 204): 70, (82, 0, 204): 80, (0, 0, 255): 90,
}
NOISE_BELOW = 40          # a transparent pixel inside the map: modelled road noise below the 45 dB floor


def decode_noise(rgba):
    """An (h, w, 4) uint8 tile of the noise map -> dB class floors (float). Unknown colours (none expected: the tiles are
    drawn without antialiasing) are NaN."""
    rgba = np.asarray(rgba)
    out = np.full(rgba.shape[:2], np.nan)
    out[rgba[..., 3] == 0] = NOISE_BELOW
    opaque = rgba[..., 3] > 0
    for (r, g, b), db in NOISE_PALETTE.items():
        out[opaque & (rgba[..., 0] == r) & (rgba[..., 1] == g) & (rgba[..., 2] == b)] = db
    return out


def flood_class(zone, subtype=None):
    """A FEMA NFHL flood hazard area (S_FLD_HAZ_AR FLD_ZONE, ZONE_SUBTY) -> class 0..4, or None when undetermined."""
    z = (zone or "").strip().upper()
    st = (subtype or "").upper()
    if z in ("V", "VE"):
        return 4
    if z in ("A", "AE", "AH", "AO", "AR", "A99") or z.startswith("AR/"):
        return 3 if "FLOODWAY" in st else 2
    if z == "X":
        return 1 if "0.2" in st else 0         # "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" (shaded X); else minimal
    if z == "OPEN WATER":
        return 2
    return None                               # D (possible but undetermined), AREA NOT INCLUDED, blank


def block_reduce(a, k, how):
    """Reduce an (H*k, W*k) float array (NaN unknown) to (H, W) by k x k blocks: 'mean' (of the known pixels), 'max', or
    'mode' (most common known value). A block with no known pixel is NaN."""
    a = np.asarray(a, dtype=np.float64)
    if k == 1:
        return a.copy()
    h, w = a.shape[0] // k, a.shape[1] // k
    b = a[:h * k, :w * k].reshape(h, k, w, k).transpose(0, 2, 1, 3).reshape(h, w, k * k)
    known = ~np.isnan(b)
    any_known = known.any(axis=2)
    out = np.full((h, w), np.nan)
    if how == "mean":
        s = np.where(known, b, 0).sum(axis=2)
        c = known.sum(axis=2)
        out[any_known] = s[any_known] / c[any_known]
    elif how == "max":
        m = np.where(known, b, -np.inf).max(axis=2)
        out[any_known] = m[any_known]
    elif how == "mode":
        for idx in zip(*np.nonzero(any_known)):
            vals = b[idx][known[idx]]
            u, c = np.unique(vals, return_counts=True)
            out[idx] = u[np.argmax(c)]
    else:
        raise ValueError(how)
    return out


def quantise(values, scale, offset, nodata, dtype):
    """Float values (NaN unknown) -> raw integers: round((v - offset) / scale), clipped below the nodata code; with
    offset "log1p", round(log1p(v) / scale)."""
    v = np.asarray(values, dtype=np.float64)
    raw = np.round(np.log1p(np.maximum(v, 0)) / scale) if offset == grid.LOG else np.round((v - offset) / scale)
    raw = np.clip(raw, 0, nodata - 1)
    raw[np.isnan(v)] = nodata
    return raw.astype({"u8": np.uint8, "u16": np.uint16, "u32": np.uint32}[dtype])


def dequantise(raw, scale, offset, nodata):
    raw = np.asarray(raw)
    out = np.expm1(raw.astype(np.float64) * scale) if offset == grid.LOG else raw.astype(np.float64) * scale + offset
    out[raw == nodata] = np.nan
    return out


def cell_area_km2(n, rows_lat):
    """The ground area (km2) of one cell of an n-per-z12 channel at each latitude given."""
    return np.array([grid.cell_size_m(n, la) ** 2 / 1e6 for la in rows_lat])


def count_density(px, py, shape, row_area_km2, smooth=1):
    """Points at integer cell indices (px column, py row) -> points per km2 on a (rows, cols) grid, box-smoothed over
    (2*smooth+1)^2 cells (an address near a cell edge counts for its neighbours too)."""
    h, w = shape
    s = smooth
    counts = np.zeros((h + 2 * s, w + 2 * s), dtype=np.float64)   # points up to `smooth` cells outside count too
    ok = (px >= -s) & (px < w + s) & (py >= -s) & (py < h + s)
    np.add.at(counts, (py[ok] + s, px[ok] + s), 1)
    k = 2 * s + 1
    acc = np.zeros(shape)
    for dy in range(k):
        for dx in range(k):
            acc += counts[dy:dy + h, dx:dx + w]
    return acc / (k * k) / np.asarray(row_area_km2)[:, None]


def to_bundle_units(lon, lat, bx, by):
    """Degrees -> bundle-local coordinates 0..65535 (about 2.4 m steps), as floats (callers round)."""
    w, s, e, n = grid.tile_bounds_merc(bx, by, grid.BUNDLE_Z)
    x, y = grid.lonlat_to_merc(lon, lat)
    return (x - w) / (e - w) * 65535.0, (n - y) / (n - s) * 65535.0


def simplify(coords, tol):
    """Douglas-Peucker on a list of (x, y) in any planar unit."""
    if len(coords) < 3:
        return list(coords)
    pts = np.asarray(coords, dtype=np.float64)
    keep = np.zeros(len(pts), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        d = b - a
        L = math.hypot(*d)
        seg = pts[i + 1:j] - a
        dist = np.abs(seg[:, 0] * d[1] - seg[:, 1] * d[0]) / L if L > 0 else np.hypot(seg[:, 0], seg[:, 1])
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return [tuple(p) for p in pts[keep]]


def clip_segment_to_box(coords, box):
    """Keep a polyline only where it is near the box (x0, y0, x1, y1): the vertices inside, plus one either side so the
    span crosses the edge. Returns a list of runs (each >= 2 vertices)."""
    x0, y0, x1, y1 = box
    inside = [x0 <= x <= x1 and y0 <= y <= y1 for x, y in coords]
    runs, cur = [], []
    for k, p in enumerate(coords):
        near = inside[k] or (k > 0 and inside[k - 1]) or (k + 1 < len(coords) and inside[k + 1])
        if near:
            cur.append(p)
        elif cur:
            if len(cur) >= 2:
                runs.append(cur)
            cur = []
    if len(cur) >= 2:
        runs.append(cur)
    return runs


def acs_value(v):
    """An ACS estimate string -> float, or NaN for the Census's jam values (-666666666 etc.) and blanks."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return math.nan
    return math.nan if f < 0 else f


def merge_hpms(rows):
    """HPMS sections with the same geometry carry different items in different rows: fold them into one, keeping the
    first non-null value of each item. rows: [(key, attrs dict, coords)] -> same shape, deduplicated."""
    out, seen = [], {}
    for key, attrs, coords in rows:
        if key in seen:
            have = out[seen[key]][1]
            for k, v in attrs.items():
                if have.get(k) is None and v is not None:
                    have[k] = v
            continue
        seen[key] = len(out)
        out.append((key, dict(attrs), coords))
    return out


def zigzag(v):
    """Signed ints -> unsigned (0, -1, 1, -2 .. -> 0, 1, 2, 3 ..): small deltas stay small."""
    v = np.asarray(v, dtype=np.int64)
    return ((v << 1) ^ (v >> 63)).astype(np.int64)


def unzigzag(u):
    u = np.asarray(u, dtype=np.int64)
    return (u >> 1) ^ -(u & 1)


def delta_lines(counts, xy):
    """Vertex counts per line + absolute (x, y) -> (x0, y0: each line's first vertex; dx, dy: zigzag steps for the rest).
    Steps within a line are small (a few hundred units), so they fit u16 and compress far better than coordinates."""
    xy = np.asarray(xy, dtype=np.int64).reshape(-1, 2)
    first = np.concatenate([[0], np.cumsum(counts)[:-1]]).astype(np.int64)
    d = np.diff(xy, axis=0, prepend=xy[:1])
    rest = np.ones(len(xy), dtype=bool)
    rest[first] = False
    return xy[first, 0], xy[first, 1], zigzag(d[rest, 0]), zigzag(d[rest, 1])


def undelta_lines(counts, x0, y0, dx, dy):
    """The inverse of delta_lines: (verts, 2) absolute coordinates."""
    counts = np.asarray(counts, dtype=np.int64)
    out = np.zeros((int(counts.sum()), 2), dtype=np.int64)
    dx, dy = unzigzag(dx), unzigzag(dy)
    a = k = 0
    for s, c in enumerate(counts):
        out[a] = (x0[s], y0[s])
        out[a + 1:a + c, 0] = x0[s] + np.cumsum(dx[k:k + c - 1])
        out[a + 1:a + c, 1] = y0[s] + np.cumsum(dy[k:k + c - 1])
        a += c
        k += c - 1
    return out


# ------------------------------------------------------------------------------------- NASA Black Marble VNP46A4 (annual)
# VNP46A4 (Collection 2, LAADS DAAC archive 5200): one HDF5 file per 10 x 10 degree tile hHHvVV of a linear lat/lon grid,
# 2400 x 2400 pixels of 15 arc-seconds (~460 m), h00 starting at 180 W and v00 at 90 N (Black Marble User Guide v2).
BM_TILE_DEG = 10.0
BM_PIXELS = 2400
BM_FIELDS = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields/"
BM_LAYER = "AllAngle_Composite_Snow_Free"           # the annual snow-free composite over all view angles: the one the
                                                    # guide recommends for year-on-year use
BM_QUALITY_OK = (0, 1)                              # 0 good, 1 poor (few nights); 2 gap-filled (another year), 255 none
# Radiance (nW cm-2 sr-1) -> the grid's 0..1 night_lights: v = min(1, (r / NIGHT_SAT) ** NIGHT_GAMMA). Chosen to keep the
# scale of the Black Marble 2016 image the channel held before (a tone-mapped picture that saturates in the suburbs, read
# as dark below 0.15 by route_engine.js): 20 nW (a lit suburb) and brighter is 1, 10 nW about 0.62, a village's 3 nW about
# 0.27, farmland's ~1 nW about 0.12 and dark forest's 0.3 nW about 0.05. The build logs its agreement with the 2016 image
# over the same cells (sources.NIGHT_CHECK), so the two numbers can be tuned from a real run.
NIGHT_SAT = 20.0
NIGHT_GAMMA = 0.7


def bm_tiles_for_box(w, s, e, n):
    """The Black Marble tiles (h, v) a lon/lat box touches."""
    h0, h1 = int(math.floor((w + 180) / BM_TILE_DEG)), int(math.floor((e + 180 - 1e-9) / BM_TILE_DEG))
    v0, v1 = int(math.floor((90 - n) / BM_TILE_DEG)), int(math.floor((90 - s - 1e-9) / BM_TILE_DEG))
    return [(h, v) for v in range(max(0, v0), min(17, v1) + 1) for h in range(max(0, h0), min(35, h1) + 1)]


def bm_tile_origin(h, v):
    """A tile's north-west corner (lon, lat) and its pixel size in degrees."""
    return -180.0 + h * BM_TILE_DEG, 90.0 - v * BM_TILE_DEG, BM_TILE_DEG / BM_PIXELS


def bm_tile_name(h, v):
    return f"h{h:02d}v{v:02d}"


def vnp46_radiance(dn, quality=None, fill=65535, scale=0.1, offset=0.0):
    """VNP46A4 stored integers -> radiance in nW cm-2 sr-1; NaN for fill, and for pixels whose quality isn't good or poor
    (gap-filled from another year, or no retrieval): unknown, never a guess."""
    dn = np.asarray(dn)
    r = dn.astype(np.float64) * float(scale) + float(offset)
    bad = dn == fill
    if quality is not None:
        bad = bad | ~np.isin(np.asarray(quality), BM_QUALITY_OK)
    r[bad] = np.nan
    return r


def night_from_radiance(r):
    """Radiance (nW cm-2 sr-1, NaN unknown) -> the night_lights channel's 0..1 (see NIGHT_SAT)."""
    r = np.asarray(r, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        out = np.power(np.clip(r, 0, None) / NIGHT_SAT, NIGHT_GAMMA)
    return np.where(np.isnan(r), np.nan, np.minimum(out, 1.0))


def bm_file_for(names, h, v):
    """The file in a day directory for tile hHHvVV (the newest production if several), or None."""
    tag = "." + bm_tile_name(h, v) + "."
    hits = sorted(n for n in names if tag in n and n.endswith(".h5"))
    return hits[-1] if hits else None
