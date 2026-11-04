"""Vetta graph tiles, format v1 (docs/OWN_ROUTING.md §4): the writer, plus a reader for checks and tests.

The phone's reader is web/graph_tiles.js (ApexGraphTiles.decode); tests/test_graph_tiles.py round-trips through both.

Grid: fixed 0.25 degree tiles, i = floor((lon + 180) / 0.25), j = floor((lat + 90) / 0.25) (Cincinnati is about
i 382, j 516). One file per tile, web/data/graph/v1/<i>_<j>.vgr. A node lives in the tile its position falls in; an edge
lives in the tile of its first node; an edge to a node in another tile names that tile (`to_tile`) and the node's index
there. Restrictions live in the tile of their via node.

Layout (little-endian; every section starts on a 4-byte boundary; counts from the header):

    header, 64 bytes
      0  'VGR1'                      4  u16 version (1)          6  u16 header bytes (64)
      8  i32 tile i                 12  i32 tile j
     16  u32 nodes                  20  u32 edges               24  u32 restrictions
     28  u32 names                  32  u32 name bytes          36  u32 geometry bytes
     40  u32 tile refs              44  u32 build day (days since 1970-01-01, UTC)
     48  u32 model hash (first 8 hex digits of the route_engine.js weights hash, as a number)
     52  12 bytes reserved (0)
    tile refs     tile_refs x (u16 i, u16 j): the other tiles edges lead to; edge to_tile k >= 1 is ref k - 1
    nodes         i32 lat[n], i32 lon[n] (microdegrees), u32 first_edge[n + 1] (CSR: node v's edges are
                  first_edge[v] .. first_edge[v + 1] - 1), u8 node_flags[n]
    edges         u32 to[e], u32 len_dm[e], u32 t_ds[e], u32 geom_off[e],
                  u16 fun[e], u16 flags[e], u16 name[e],
                  u8 quality[e], u8 scenery[e], u8 conf[e], u8 cls[e], u8 speed[e], u8 to_tile[e], u8 h_in[e], u8 h_out[e]
    restrictions  r x 16 bytes: u32 from_edge, u32 via (node, this tile), u32 to_edge (this tile), u8 from_tile (0 this,
                  k ref k - 1), u8 kind (0 no_*, 1 only_*), u16 reserved
    names         u32 offsets[names + 1] into the UTF-8 bytes that follow (name 0xFFFF on an edge = none)
    geometry      per polyline: varint count, then count x (zigzag varint dlat, zigzag varint dlon) in microdegrees; the
                  first point is relative to the tile's south-west corner, the rest to the point before. An edge with flag
                  GEOM_REV reads its polyline backwards (both directions of a two-way road share one).

Values: quality, scenery 0..254 = 0..1 (255 unknown); conf 0..255 = 0..1 (the share of the model's weight known; 0 is
"nothing known", never a guess); fun u16 = gated corner points x 100 (65535 unknown); len_dm decimetres; t_ds
deciseconds; speed km/h (0 unknown; flag SPEED_EST = a class estimate, not posted); cls 0 motorway, 1 trunk, 2 primary,
3 secondary, 4 tertiary, 5 unclassified, 6 residential, 7 service, 8 track, 9 ferry (the router's codes, 8 and 9 added);
h_in, h_out the bearing over the edge's first and last 60 m in 256ths of a turn (0 north, clockwise) so the router can
score a corner split across a join.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

MAGIC = b"VGR1"
VERSION = 1
HEADER_BYTES = 64
TILE_DEG = 0.25

UNKNOWN_U8 = 255
UNKNOWN_FUN = 0xFFFF
NO_NAME = 0xFFFF

# edge flags
ONEWAY, TOLL, FERRY, UNPAVED, TUNNEL, BRIDGE, MOTORWAY, RAMP, ROUNDABOUT, PRIVATE, GEOM_REV, SPEED_EST, BARRIER, DESTINATION = (
    1 << k for k in range(14))
EDGE_FLAGS = {"oneway": ONEWAY, "toll": TOLL, "ferry": FERRY, "unpaved": UNPAVED, "tunnel": TUNNEL, "bridge": BRIDGE,
              "motorway": MOTORWAY, "ramp": RAMP, "roundabout": ROUNDABOUT, "private": PRIVATE, "geom_rev": GEOM_REV,
              "speed_est": SPEED_EST, "barrier": BARRIER, "destination": DESTINATION}
# node flags
N_SIGNAL, N_STOP, N_GIVE_WAY, N_BARRIER, N_LEVEL_CROSSING, N_DEAD_END, N_CROSSING, N_CALMING = (1 << k for k in range(8))
NODE_FLAGS = {"signal": N_SIGNAL, "stop": N_STOP, "give_way": N_GIVE_WAY, "barrier": N_BARRIER,
              "level_crossing": N_LEVEL_CROSSING, "dead_end": N_DEAD_END, "crossing": N_CROSSING, "calming": N_CALMING}

CLASS_CODES = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "unclassified": 5,
               "residential": 6, "service": 7, "track": 8, "ferry": 9}


def tile_of(lat: float, lon: float) -> tuple[int, int]:
    """(i, j) of the 0.25 degree tile holding a point."""
    import math
    return int(math.floor((lon + 180.0) / TILE_DEG)), int(math.floor((lat + 90.0) / TILE_DEG))


def tile_origin(i: int, j: int) -> tuple[int, int]:
    """South-west corner of tile (i, j) in microdegrees (lat, lon)."""
    return round((j * TILE_DEG - 90.0) * 1e6), round((i * TILE_DEG - 180.0) * 1e6)


def q8(v: float | None) -> int:
    """0..1 -> 0..254, None/NaN -> 255 (unknown)."""
    if v is None or v != v:
        return UNKNOWN_U8
    return max(0, min(254, round(v * 254)))


def unq8(b: int) -> float | None:
    return None if b == UNKNOWN_U8 else b / 254


@dataclass
class Edge:
    to: int                   # node index in to_tile
    to_tile: tuple[int, int] | None = None   # None: this tile
    len_dm: int = 0
    t_ds: int = 0
    quality: float | None = None
    scenery: float | None = None
    fun: float | None = None  # gated corner points
    conf: float = 0.0
    flags: int = 0
    cls: int = 5
    speed: int = 0
    name: str | None = None
    geom: int = 0             # index into Tile.geoms
    h_in: int = 0
    h_out: int = 0


@dataclass
class Restriction:
    from_edge: int
    via: int
    to_edge: int
    only: bool = False
    from_tile: tuple[int, int] | None = None


@dataclass
class Tile:
    i: int
    j: int
    lat: list[int] = field(default_factory=list)      # microdegrees
    lon: list[int] = field(default_factory=list)
    node_flags: list[int] = field(default_factory=list)
    edges: list[tuple[int, Edge]] = field(default_factory=list)   # (from node, edge)
    restrictions: list[Restriction] = field(default_factory=list)
    geoms: list[list[tuple[int, int]]] = field(default_factory=list)   # polylines, microdegrees (lat, lon)
    build_day: int = 0
    model_hash: int = 0


def _zz(v: int) -> int:
    return (v << 1) ^ (v >> 63)


def _varint(out: bytearray, v: int) -> None:
    while v >= 0x80:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    out.append(v)


def _pad4(b: bytearray) -> None:
    while len(b) % 4:
        b.append(0)


def write_tile(t: Tile) -> bytes:
    """A Tile -> v1 bytes. Edges are sorted by from node (stable, so the caller's order within a node is kept); the
    restriction edge indices refer to the caller's edge order and are remapped here."""
    n = len(t.lat)
    order = sorted(range(len(t.edges)), key=lambda k: t.edges[k][0])
    remap = {old: new for new, old in enumerate(order)}
    edges = [t.edges[k] for k in order]
    first = [0] * (n + 1)
    for frm, _ in edges:
        if not 0 <= frm < n:
            raise ValueError(f"edge from node {frm} not in tile")
        first[frm + 1] += 1
    for v in range(n):
        first[v + 1] += first[v]
    refs: list[tuple[int, int]] = []
    ref_of: dict[tuple[int, int], int] = {}

    def ref(tt):
        if tt is None or tuple(tt) == (t.i, t.j):
            return 0
        tt = tuple(tt)
        if tt not in ref_of:
            refs.append(tt)
            ref_of[tt] = len(refs)
            if len(refs) > 254:
                raise ValueError("too many neighbour tiles")
        return ref_of[tt]

    names: list[str] = []
    name_of: dict[str, int] = {}
    for _, e in edges:
        if e.name and e.name not in name_of:
            name_of[e.name] = len(names)
            names.append(e.name)
    if len(names) >= NO_NAME:
        raise ValueError("too many names in one tile")
    # geometry blob
    olat, olon = tile_origin(t.i, t.j)
    geo = bytearray()
    goff = []
    for poly in t.geoms:
        goff.append(len(geo))
        _varint(geo, len(poly))
        plat, plon = olat, olon
        for la, lo in poly:
            _varint(geo, _zz(la - plat))
            _varint(geo, _zz(lo - plon))
            plat, plon = la, lo
    e_count = len(edges)
    to_tile = [ref(e.to_tile) for _, e in edges]
    rest = []
    for r in t.restrictions:
        rest.append((r.from_edge if r.from_tile not in (None, (t.i, t.j)) else remap[r.from_edge], r.via, remap[r.to_edge],
                     ref(r.from_tile), 1 if r.only else 0))
    name_bytes = bytearray()
    name_offs = [0]
    for s in names:
        name_bytes += s.encode("utf-8")
        name_offs.append(len(name_bytes))

    out = bytearray()
    out += MAGIC
    out += struct.pack("<HHiiIIIIIIIII", VERSION, HEADER_BYTES, t.i, t.j, n, e_count, len(rest), len(names),
                       len(name_bytes), len(geo), len(refs), t.build_day, t.model_hash & 0xFFFFFFFF)
    out += b"\0" * (HEADER_BYTES - len(out))
    for ri, rj in refs:
        out += struct.pack("<HH", ri, rj)
    out += struct.pack(f"<{n}i", *t.lat)
    out += struct.pack(f"<{n}i", *t.lon)
    out += struct.pack(f"<{n + 1}I", *first)
    out += bytes(t.node_flags) if t.node_flags else bytes(n)
    _pad4(out)

    def col(fmt, vals):
        nonlocal out
        out += struct.pack(f"<{len(vals)}{fmt}", *vals)

    col("I", [e.to for _, e in edges])
    col("I", [e.len_dm for _, e in edges])
    col("I", [e.t_ds for _, e in edges])
    col("I", [goff[e.geom] for _, e in edges])
    col("H", [UNKNOWN_FUN if e.fun is None or e.fun != e.fun else max(0, min(65534, round(e.fun * 100))) for _, e in edges])
    col("H", [e.flags & 0xFFFF for _, e in edges])
    col("H", [name_of[e.name] if e.name else NO_NAME for _, e in edges])
    _pad4(out)
    col("B", [q8(e.quality) for _, e in edges])
    col("B", [q8(e.scenery) for _, e in edges])
    col("B", [max(0, min(255, round((e.conf or 0) * 255))) for _, e in edges])
    col("B", [e.cls for _, e in edges])
    col("B", [max(0, min(255, int(e.speed or 0))) for _, e in edges])
    col("B", to_tile)
    col("B", [e.h_in & 0xFF for _, e in edges])
    col("B", [e.h_out & 0xFF for _, e in edges])
    _pad4(out)
    for fe, via, te, ft, kind in rest:
        out += struct.pack("<IIIBBH", fe, via, te, ft, kind, 0)
    col("I", name_offs)
    out += name_bytes
    _pad4(out)
    out += geo
    return bytes(out)


def _unvarint(b: bytes, p: int) -> tuple[int, int]:
    v = s = 0
    while True:
        c = b[p]
        p += 1
        v |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return v, p


def read_tile(b: bytes) -> dict:
    """v1 bytes -> plain dict (columns as lists): the checks' and tests' reader. The phone uses web/graph_tiles.js."""
    if b[:4] != MAGIC:
        raise ValueError("not a VGR1 tile")
    (ver, hb, ti, tj, n, e, r, nn, nb, gb, nref, day, mh) = struct.unpack_from("<HHiiIIIIIIIII", b, 4)
    if ver != VERSION:
        raise ValueError(f"tile version {ver}")
    p = hb
    refs = [struct.unpack_from("<HH", b, p + 4 * k) for k in range(nref)]
    p += 4 * nref

    def take(fmt, count):
        nonlocal p
        size = struct.calcsize(f"<{count}{fmt}")
        vals = list(struct.unpack_from(f"<{count}{fmt}", b, p))
        p += size
        return vals

    def align():
        nonlocal p
        p += (-p) % 4

    lat, lon, first, nflags = take("i", n), take("i", n), take("I", n + 1), take("B", n)
    align()
    to, len_dm, t_ds, goff = take("I", e), take("I", e), take("I", e), take("I", e)
    fun, flags, name = take("H", e), take("H", e), take("H", e)
    align()
    quality, scenery, conf, cls, speed, to_tile, h_in, h_out = (take("B", e) for _ in range(8))
    align()
    rest = []
    for _ in range(r):
        fe, via, te, ft, kind, _z = struct.unpack_from("<IIIBBH", b, p)
        p += 16
        rest.append({"from_edge": fe, "via": via, "to_edge": te, "from_tile": None if ft == 0 else tuple(refs[ft - 1]),
                     "only": bool(kind)})
    offs = take("I", nn + 1)
    raw = b[p:p + nb]
    names = [raw[offs[k]:offs[k + 1]].decode("utf-8") for k in range(nn)]
    p += nb
    align()
    geo = b[p:p + gb]
    olat, olon = tile_origin(ti, tj)

    def geom(k):
        q = goff[k]
        cnt, q = _unvarint(geo, q)
        pts, la, lo = [], olat, olon
        for _ in range(cnt):
            d, q = _unvarint(geo, q)
            la += (d >> 1) ^ -(d & 1)
            d, q = _unvarint(geo, q)
            lo += (d >> 1) ^ -(d & 1)
            pts.append((la, lo))
        return pts[::-1] if flags[k] & GEOM_REV else pts

    return {"i": ti, "j": tj, "build_day": day, "model_hash": mh, "refs": refs,
            "nodes": {"lat": lat, "lon": lon, "first_edge": first, "flags": nflags},
            "edges": {"to": to, "to_tile": [None if x == 0 else tuple(refs[x - 1]) for x in to_tile], "len_dm": len_dm,
                      "t_ds": t_ds, "quality": quality, "scenery": scenery, "fun": fun, "conf": conf, "flags": flags,
                      "cls": cls, "speed": speed, "name": name, "geom_off": goff, "h_in": h_in, "h_out": h_out},
            "restrictions": rest, "names": names, "geom": geom}
