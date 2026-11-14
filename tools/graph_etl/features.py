"""Per-edge features for the scorer (docs/OWN_ROUTING.md §3), in the route engine's channel names and units
(docs/ROUTE_ENGINE.md "The channels"): what OSM says along each chain, the per-km counts over the same ±500 m window the
router's edges use (followed through the road's own continuation across junctions, so a 60 m edge between two side
streets reads like the road it is part of), land use by the 7 probes osm_tiles.js uses, water, and road density.

The model itself is not here: tools/graph_etl/score_edges.js feeds these to web/route_engine.js.
"""
from __future__ import annotations

import math

import numpy as np
import shapely
from shapely import STRtree

from .osm_graph import Chain, Raw, bearing, hav

STEP_M = 25.0                      # the corridor's sample step (web/route_ctx/registry.js STEP_M)
WINDOW_M = 500.0                   # per-km counts: ±500 m (router_edges.js perKm)
BLDG_WINDOW_M = 250.0              # buildings: a 500 m window (osm_tiles.js)
MIN_WINDOW_M = 250.0               # at least 250 m (perKm): one signal at a dead end isn't "40 a km"
# businesses within 80 m: what the live engine's business_per_km counts (ROUTE_ENGINE.md; a strip mall's shops sit
# behind their car park, so 40 m missed half of Colerain Avenue's), buildings and addresses within 60 m (osm_tiles.js),
# schools and churches within 150 m (osm_tiles.js points)
BUSINESS_M, BUILDING_M, ADDRESS_M, CIVIC_M = 80.0, 60.0, 60.0, 150.0
SIDEWALK_M, SIDEWALK_SHARE = 15.0, 0.4
PROBES = (0, -50, 50, -100, 100, -150, 150)
LU_CLASSES = ("residential", "commercial", "retail", "industrial", "forest", "farmland", "open", "park")
EXT_M = 100.0                      # geometry either side of an edge for its corners (corners split across a join)
HEAD_M = 60.0                      # the heading kept at each end (§3)
DENSITY_RADIUS_M = 2000.0          # Valhalla's road density: road length within 2 km
DENSITY_CELL_M = 250.0


def xy(lat, lon):
    """Local metres: x east, y north. Scale by each point's own latitude (fine over the distances compared here)."""
    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float)
    return lon * 111320.0 * np.cos(np.radians(lat)), lat * 110540.0


def cumulative(coords):
    out = [0.0]
    for a, b in zip(coords, coords[1:]):
        out.append(out[-1] + hav(a, b))
    return out


def sample_count(total):
    """The corridor's sample count for a line of `total` metres (registry.js corridor())."""
    return max(2, int(math.floor(total / STEP_M)) + 1 + (1 if total % STEP_M > 1 else 0))


def along(coords, cum, m):
    """Point (lat, lon) and segment index at m metres along."""
    j = 0
    while j < len(cum) - 2 and cum[j + 1] < m:
        j += 1
    seg = cum[j + 1] - cum[j]
    f = (m - cum[j]) / seg if seg > 0 else 0.0
    f = min(1.0, max(0.0, f))
    a, b = coords[j], coords[j + 1]
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), j


def samples(coords, cum):
    total = cum[-1]
    n = sample_count(total)
    pts, heads = [], []
    for k in range(n):
        p, j = along(coords, cum, min(total, k * STEP_M))
        pts.append(p)
        heads.append(bearing(coords[j], coords[j + 1]))
    return pts, heads


def head_over(coords, cum, from_end, m=HEAD_M):
    """Bearing over the first (or last) m metres, in 256ths of a turn."""
    total = cum[-1]
    if total <= 0:
        return 0
    if not from_end:
        p, _ = along(coords, cum, min(m, total))
        b = bearing(coords[0], p)
    else:
        p, _ = along(coords, cum, max(0.0, total - m))
        b = bearing(p, coords[-1])
    return int(round(b / (2 * math.pi) * 256)) % 256


class Graph:
    """Chains with their geometry and the node -> chains incidence."""

    def __init__(self, raw: Raw, chains: list[Chain]):
        self.raw, self.chains = raw, chains
        self.coords = [[raw.coords[r] for r in c.nodes] for c in chains]
        self.cum = [cumulative(cs) for cs in self.coords]
        self.length = [cm[-1] for cm in self.cum]
        self.at = {}
        for k, c in enumerate(chains):
            self.at.setdefault(c.nodes[0], []).append((k, 0))
            self.at.setdefault(c.nodes[-1], []).append((k, 1))
        self.next = [[None, None] for _ in chains]     # [continuation before start, after end]: (chain, its end at v)
        for k in range(len(chains)):
            for end in (0, 1):
                self.next[k][end] = self._continuation(k, end)

    def heading_out(self, k, end):
        """Bearing leaving the node at `end` of chain k, into the chain (end 0: forward from start; 1: backward)."""
        cs, cm = self.coords[k], self.cum[k]
        if end == 0:
            p, _ = along(cs, cm, min(30.0, cm[-1]))
            return bearing(cs[0], p)
        p, _ = along(cs, cm, max(0.0, cm[-1] - 30.0))
        return bearing(cs[-1], p)

    def _continuation(self, k, end):
        v = self.chains[k].nodes[-1 if end else 0]
        others = [(q, e) for q, e in self.at.get(v, []) if (q, e) != (k, end)]
        if not others:
            return None
        arrive = (self.heading_out(k, end) + math.pi) % (2 * math.pi)      # travelling into v along k
        name = self.chains[k].attrs.get("name")
        best, best_turn = None, 1e9
        for q, e in others:
            if q == k:
                continue
            leave = self.heading_out(q, e)
            turn = abs((leave - arrive + math.pi) % (2 * math.pi) - math.pi)
            same = name and self.chains[q].attrs.get("name") == name
            score = turn - (1.0 if same and turn < math.radians(90) else 0.0)
            if score < best_turn:
                best, best_turn = (q, e), score
        if best is None:
            return None
        q, e = best
        turn = abs((self.heading_out(q, e) - arrive + math.pi) % (2 * math.pi) - math.pi)
        same = name and self.chains[q].attrs.get("name") == name
        return best if (same and turn < math.radians(90)) or turn < math.radians(50) else None

    def walk(self, k, end, limit):
        """Chains continuing from chain k's `end`, up to `limit` metres: [(chain, metres of it inside)]."""
        out, left, cur = [], limit, self.next[k][end]
        seen = {k}
        while cur and left > 0:
            q, e = cur
            if q in seen:
                break
            seen.add(q)
            use = min(left, self.length[q])
            out.append((q, use))
            left -= use
            cur = self.next[q][1 - e]
        return out

    def ext_coords(self, k, end, m=EXT_M):
        """Up to m metres of the continuation's geometry beyond chain k's `end`, outward from the node."""
        pts, left, cur, seen = [], m, self.next[k][end], {k}
        while cur and left > 0:
            q, e = cur
            if q in seen:
                break
            seen.add(q)
            cs = self.coords[q] if e == 0 else list(reversed(self.coords[q]))
            cm = cumulative(cs)
            for p, d in zip(cs[1:], cm[1:]):
                pts.append(p)
                if d >= left:
                    break
            left -= cm[-1]
            cur = self.next[q][1 - e]
        return pts


def point_counts(g: Graph):
    """Per chain: signals, stops, give ways, crossings, calming, level crossings, joins (interior counted in full, the
    end nodes half: they are shared with the road's continuation), plus the interior ones on their own (the time model)
    and gates."""
    raw = g.raw
    kinds = ("signal", "stop", "give_way", "crossing", "calming", "level_crossing")
    full = np.zeros((len(g.chains), len(kinds) + 1))
    interior = np.zeros((len(g.chains), len(kinds)))
    gates = np.zeros(len(g.chains), dtype=bool)
    for k, c in enumerate(g.chains):
        for pos, r in enumerate(c.nodes):
            w = 1.0 if 0 < pos < len(c.nodes) - 1 else 0.5
            f = raw.feats.get(r, ())
            for a, kind in enumerate(kinds):
                if kind in f:
                    full[k, a] += w
                    if w == 1.0:
                        interior[k, a] += 1
            if "gate" in f:
                gates[k] = True
            joins = max(0, raw.vdeg.get(r, 0) - 2) if r >= 0 else 0
            full[k, -1] += w * joins
    return kinds, full, interior, gates


def near_counts(g: Graph, pts: list, dist_m: float):
    """Per chain: how many of the points lie within dist_m of its line (each point once per chain)."""
    out = np.zeros(len(g.chains))
    if not pts or not len(g.chains):   # no chains: an empty query array is float, which shapely refuses (48N 89W)
        return out
    pa = np.array(pts)
    px, py = xy(pa[:, 0], pa[:, 1])
    tree = STRtree(shapely.points(px, py))
    lines = []
    for cs in g.coords:
        a = np.array(cs)
        x, y = xy(a[:, 0], a[:, 1])
        lines.append(shapely.linestrings(np.column_stack([x, y])) if len(cs) >= 2 else shapely.points(x[0], y[0]))
    pairs = tree.query(np.array(lines), predicate="dwithin", distance=dist_m)
    if pairs.size:
        np.add.at(out, pairs[0], 1)
    return out


def windowed(g: Graph, counts: np.ndarray, half: float) -> np.ndarray:
    """counts per chain (rows; columns = kinds) -> per km over the chain plus its continuation `half` metres each way."""
    res = np.zeros_like(counts, dtype=float)
    for k in range(len(g.chains)):
        tot = counts[k].astype(float).copy()
        L = g.length[k]
        for end in (0, 1):
            for q, use in g.walk(k, end, half):
                if g.length[q] > 0:
                    tot += counts[q] * (use / g.length[q])
                L += use
        res[k] = tot / (max(L, MIN_WINDOW_M) / 1000.0)
    return res


def probes(g: Graph):
    """Every chain's 25 m samples (as the corridor will lay them) and their headings."""
    S, H, owner = [], [], []
    for k in range(len(g.chains)):
        pts, heads = samples(g.coords[k], g.cum[k])
        S.extend(pts)
        H.extend(heads)
        owner.extend([k] * len(pts))
    return np.array(S), np.array(H), np.array(owner)


def landuse_shares(raw: Raw, S: np.ndarray, H: np.ndarray):
    """Per sample: share of the 7 probes (0, ±50, ±100, ±150 m across the road) inside each land-use class, and inside
    any mapped land use (lu_mapped)."""
    n = len(S)
    shares = {c: np.zeros(n) for c in LU_CLASSES}
    mapped = np.zeros(n)
    if n == 0 or not raw.landuse:
        return shares, mapped
    polys, cls = [], []
    for c, ring, inners in raw.landuse:
        if len(ring) < 4:
            continue
        r = np.array(ring)
        x, y = xy(r[:, 0], r[:, 1])
        holes = []
        for h in inners:
            if len(h) >= 4:
                hh = np.array(h)
                hx, hy = xy(hh[:, 0], hh[:, 1])
                holes.append(np.column_stack([hx, hy]))
        p = shapely.Polygon(np.column_stack([x, y]), holes)
        if not p.is_valid:
            p = shapely.make_valid(p)
        polys.append(p)
        cls.append(c)
    tree = STRtree(polys)
    cls = np.array(cls)
    sx, sy = xy(S[:, 0], S[:, 1])
    nx, ny = np.cos(H), -np.sin(H)            # across the road (bearing H: east = sin, north = cos): left normal
    for off in PROBES:
        px, py = sx + off * nx, sy + off * ny
        pr, pp = tree.query(shapely.points(px, py), predicate="within")
        hit_any = np.zeros(n, dtype=bool)
        hit_any[pr] = True
        mapped += hit_any
        for c in LU_CLASSES:
            m = cls[pp] == c
            h = np.zeros(n, dtype=bool)
            h[pr[m]] = True
            shares[c] += h
    for c in LU_CLASSES:
        shares[c] /= len(PROBES)
    mapped /= len(PROBES)
    return shares, mapped


def water(raw: Raw, S: np.ndarray, H: np.ndarray):
    """water_near (a water area or a river/stream/canal within 150 m) and creek_follow (a stream within 100 m within
    30 degrees of the road's direction) per sample, as osm_tiles.js."""
    n = len(S)
    near, follow = np.zeros(n), np.zeros(n)
    if n == 0:
        return near, follow
    sx, sy = xy(S[:, 0], S[:, 1])
    pts = shapely.points(sx, sy)
    geoms = []
    for ring in raw.water_areas:
        if len(ring) >= 4:
            r = np.array(ring)
            x, y = xy(r[:, 0], r[:, 1])
            p = shapely.Polygon(np.column_stack([x, y]))
            geoms.append(p if p.is_valid else shapely.make_valid(p))
    lines = []
    for wl in raw.waterways:
        if len(wl) >= 2:
            r = np.array(wl)
            x, y = xy(r[:, 0], r[:, 1])
            lines.append(shapely.linestrings(np.column_stack([x, y])))
    allg = geoms + lines
    if allg:
        pr, _ = STRtree(allg).query(pts, predicate="dwithin", distance=150.0)
        near[pr] = 1
    if lines:
        larr = np.array(lines)
        pr, pl = STRtree(lines).query(pts, predicate="dwithin", distance=100.0)
        if pr.size:
            L = larr[pl]
            d = shapely.line_locate_point(L, pts[pr])
            a = shapely.line_interpolate_point(L, np.maximum(0, d - 15))
            b = shapely.line_interpolate_point(L, d + 15)
            wx, wy = shapely.get_x(b) - shapely.get_x(a), shapely.get_y(b) - shapely.get_y(a)
            wdir = np.arctan2(wx, wy)
            diff = np.abs((wdir - H[pr] + np.pi) % (2 * np.pi) - np.pi)
            diff = np.minimum(diff, np.pi - diff)          # a stream has no direction for this
            ok = diff <= np.radians(30)
            follow[pr[ok]] = 1
    return near, follow


def sidewalks(g: Graph, raw: Raw) -> np.ndarray:
    """Per chain: 1 where mapped footway=sidewalk lines run within 15 m of it along at least 40 % of its length (either
    side), else NaN (no separate sidewalk mapped: unknown, the way's own sidewalk tag decides)."""
    out = np.full(len(g.chains), np.nan)
    if not raw.sidewalks:
        return out
    sw = []
    for line in raw.sidewalks:
        if len(line) >= 2:
            a = np.array(line)
            x, y = xy(a[:, 0], a[:, 1])
            sw.append(shapely.linestrings(np.column_stack([x, y])))
    if not sw:
        return out
    sw = np.array(sw)
    roads = []
    for cs in g.coords:
        a = np.array(cs)
        x, y = xy(a[:, 0], a[:, 1])
        roads.append(shapely.linestrings(np.column_stack([x, y])))
    roads = np.array(roads)
    ri, si = STRtree(sw).query(roads, predicate="dwithin", distance=SIDEWALK_M)
    if not ri.size:
        return out
    inside = shapely.length(shapely.intersection(sw[si], shapely.buffer(roads[ri], SIDEWALK_M, cap_style="flat")))
    cover = np.zeros(len(g.chains))
    np.add.at(cover, ri, inside)
    L = np.maximum(1.0, np.array(g.length))
    # a sidewalk along one side for the whole length covers it once; both sides cap at 1
    out[np.minimum(1.0, cover / L) >= SIDEWALK_SHARE] = 1.0
    return out


def road_density(g: Graph, S: np.ndarray, scale_fn, segs=None):
    """Valhalla-style road density at each sample: road km within 2 km per km² (scale_fn maps it to 0..15). `segs`:
    (mid lat, mid lon, metres) of every vehicle way, routable or not (Valhalla's graph has driveways and car-park lanes);
    without it, the chains."""
    if len(S) == 0:
        return np.zeros(0), np.zeros(0)
    mids, lens = [], []
    if segs:
        mids = [(a, b) for a, b, _ in segs]
        lens = [m for _, _, m in segs]
    else:
        for cs in g.coords:
            for a, b in zip(cs, cs[1:]):
                mids.append(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
                lens.append(hav(a, b))
    mids = np.array(mids)
    mx, my = xy(mids[:, 0], mids[:, 1])
    sx, sy = xy(S[:, 0], S[:, 1])
    x0, y0 = min(mx.min(), sx.min()) - 3000, min(my.min(), sy.min()) - 3000
    W = int((max(mx.max(), sx.max()) + 3000 - x0) // DENSITY_CELL_M) + 1
    Hh = int((max(my.max(), sy.max()) + 3000 - y0) // DENSITY_CELL_M) + 1
    grid = np.zeros((Hh, W))
    np.add.at(grid, (((my - y0) // DENSITY_CELL_M).astype(int), ((mx - x0) // DENSITY_CELL_M).astype(int)), np.array(lens))
    r = int(DENSITY_RADIUS_M // DENSITY_CELL_M)
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    kern = ((xx * DENSITY_CELL_M) ** 2 + (yy * DENSITY_CELL_M) ** 2 <= DENSITY_RADIUS_M ** 2).astype(float)
    from scipy.signal import fftconvolve
    tot = fftconvolve(grid, kern, mode="same")
    area_km2 = kern.sum() * (DENSITY_CELL_M / 1000) ** 2
    dens = np.maximum(0, tot) / 1000.0 / area_km2
    v = dens[((sy - y0) // DENSITY_CELL_M).astype(int), ((sx - x0) // DENSITY_CELL_M).astype(int)]
    return v, scale_fn(v)
