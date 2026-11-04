"""Terrarium DEM tiles (z12, the ones the app's hillshade and web/route_ctx/dem.js read) for the graph build: fetched
from AWS Open Data (s3.amazonaws.com/elevation-tiles-prod, Mapzen terrain tiles: SRTM, NED and others; "Elevation:
Mapzen Terrain Tiles" in About > Sources) into a cache as raw RGBA (256 x 256 x 4 bytes), the form dem.js's sampler
reads, so tools/graph_etl/score_edges.js runs the app's own terrain code on them."""
from __future__ import annotations

import concurrent.futures as cf
import io
import math
import os
import time
import urllib.error
import urllib.request

Z = 12
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
PAD_M = 900.0     # dem.js probes 800 m round each sample


def tile_xy(lat, lon, z=Z):
    n = 2 ** z
    r = math.radians(lat)
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)


def tiles_for(bbox, z=Z):
    w, s, e, n = bbox
    dlat = PAD_M / 110540
    dlon = PAD_M / (111320 * math.cos(math.radians((s + n) / 2)))
    x0, y0 = tile_xy(n + dlat, w - dlon, z)
    x1, y1 = tile_xy(s - dlat, e + dlon, z)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def fetch_one(x, y, cache, z=Z):
    path = os.path.join(cache, f"{z}_{x}_{y}.rgba")
    if os.path.exists(path):
        return path
    from PIL import Image
    for attempt in range(4):
        try:
            with urllib.request.urlopen(URL.format(z=z, x=x, y=y), timeout=60) as r:
                data = r.read()
            img = Image.open(io.BytesIO(data)).convert("RGBA")
            if img.size != (256, 256):
                img = img.resize((256, 256))
            with open(path + ".part", "wb") as f:
                f.write(img.tobytes())
            os.replace(path + ".part", path)
            return path
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return None
            time.sleep(2 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            time.sleep(2 * (attempt + 1))
    return None


def fetch(bbox, cache, threads=16):
    """Every z12 tile the box (plus the probes' reach) needs, into `cache`. Returns how many are there."""
    os.makedirs(cache, exist_ok=True)
    want = tiles_for(bbox)
    with cf.ThreadPoolExecutor(threads) as ex:
        got = list(ex.map(lambda t: fetch_one(t[0], t[1], cache), want))
    return sum(1 for g in got if g), len(want)
