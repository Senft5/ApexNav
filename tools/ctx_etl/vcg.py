"""The bundle file (".vcg", Vetta context grid), version 1. Pure Python + numpy; read by web/route_ctx/context_grid.js.

    gzip(  b"VCG1" | uint32 LE header length | header JSON (UTF-8) | zero padding to 4 bytes | body  )

The body is a run of little-endian typed arrays, each starting on a 4-byte boundary; the header's "arrays" maps a name to
[dtype, byte offset into the body, element count]. The header's "channels" say how to read the raster arrays:

    channels[name] = { n, scale, offset, nodata, unit, meaning, source, tiles: [[i, j], ...], array }

`tiles` lists the z12 tiles present, as offsets 0..15 inside the bundle (i east, j south); the array holds n*n values per
tile in that order, row-major from the tile's north-west corner. A tile not listed is unknown for that channel.
"lines" (road spans, HPMS) and "points" (crash locations, FARS) are described in build.py.
"""
import gzip
import json
import struct

import numpy as np

MAGIC = b"VCG1"
NP = {"u8": np.uint8, "u16": np.uint16, "u32": np.uint32, "i32": np.int32, "f32": np.float32}


class Writer:
    def __init__(self, header):
        self.header = header                     # the caller's dict: keys it adds later are written too
        self.header.setdefault("arrays", {})
        self.parts = []
        self.size = 0

    def add(self, name, arr, dtype):
        a = np.ascontiguousarray(np.asarray(arr).astype(NP[dtype]).ravel())
        self.header["arrays"][name] = [dtype, self.size, int(a.size)]
        b = a.astype(a.dtype.newbyteorder("<"), copy=False).tobytes()
        pad = (-len(b)) % 4
        self.parts.append(b + b"\0" * pad)
        self.size += len(b) + pad
        return name

    def tobytes(self):
        head = json.dumps(self.header, separators=(",", ":"), sort_keys=True).encode()
        pad = (-(8 + len(head))) % 4
        raw = MAGIC + struct.pack("<I", len(head)) + head + b"\0" * pad + b"".join(self.parts)
        return gzip.compress(raw, compresslevel=9, mtime=0)   # mtime 0: the same input gives the same bytes


def read(data):
    """bytes (gzipped or not) -> (header, {array name: numpy array})."""
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    if data[:4] != MAGIC:
        raise ValueError("not a VCG1 bundle")
    (hl,) = struct.unpack("<I", data[4:8])
    header = json.loads(data[8:8 + hl].decode())
    body = 8 + hl + ((-(8 + hl)) % 4)
    arrays = {}
    for name, (dt, off, count) in header["arrays"].items():
        arrays[name] = np.frombuffer(data, dtype=np.dtype(NP[dt]).newbyteorder("<"), count=count, offset=body + off)
    return header, arrays


def channel_tile(header, arrays, name, i, j):
    """One z12 tile's decoded values (float, NaN unknown), or None when the tile isn't in the bundle."""
    ch = header["channels"].get(name)
    if not ch:
        return None
    try:
        k = [tuple(t) for t in ch["tiles"]].index((i, j))
    except ValueError:
        return None
    n = ch["n"]
    raw = arrays[ch["array"]][k * n * n:(k + 1) * n * n].reshape(n, n)
    if ch["offset"] == "log1p":
        out = np.expm1(raw.astype(np.float64) * ch["scale"])
    else:
        out = raw.astype(np.float64) * ch["scale"] + ch["offset"]
    out[raw == ch["nodata"]] = np.nan
    return out
