"""The datasets: one function each, every download cached under the cache directory (the workflow keeps it between runs).

Every source here is free. What each gives, its licence and its URL are in SOURCES (written into every bundle's header
and shown in About > Sources). Two use the owner's free accounts, read from the environment (GitHub Actions secrets,
never in the repo or the logs), and are skipped without them:
- EARTHDATA_TOKEN (urs.earthdata.nasa.gov -> Generate Token): night lights from NASA Black Marble VNP46A4, the newest
  annual radiance composite on LAADS DAAC; without it, the Black Marble 2016 image through GIBS, as before.
- FCC_USERNAME + FCC_API_TOKEN (broadbandmap.fcc.gov -> Manage API access): mobile_coverage, the 4G/5G providers per
  cell from the FCC National Broadband Map; without them the channel isn't built (unknown on the phone).
GDAL-backed libraries (rasterio, pyproj, shapely, pyshp) are imported inside the functions that need them, so the pure
parts of the pipeline (transforms.py, vcg.py) import without them.
"""
import csv
import gzip
import hashlib
import io
import json
import math
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import warnings
import zipfile

import numpy as np

from . import grid, transforms

UA = "Vetta-context-grid/1 (+https://apexnav.senftns.workers.dev)"
_locks = {}
_locks_guard = threading.Lock()
# rasterio.features.rasterize builds its in-memory raster before applying the transform it is given, and says so; the
# output is georeferenced by that transform (tests/test_ctx_etl.py checks places), so the warning is noise.
warnings.filterwarnings("ignore", message="Dataset has no geotransform")
STATE_FIPS = {"OH": "39", "KY": "21", "IN": "18", "WV": "54", "TN": "47", "NC": "37", "VA": "51", "GA": "13", "SC": "45",
              "PA": "42", "MD": "24", "AL": "01", "MI": "26", "IL": "17"}

SOURCES = {
    "nlcd": {"name": "NLCD 2021 Impervious Surface; NLCD/USFS Tree Canopy Cover 2021 (v2021-4)", "by": "USGS / MRLC; USDA Forest Service",
             "licence": "Public domain (US Government)", "url": "https://www.mrlc.gov/"},
    "noise": {"name": "National Transportation Noise Map 2020 (road)", "by": "US DOT Bureau of Transportation Statistics",
              "licence": "Public domain (US Government)", "url": "https://www.bts.gov/geospatial/national-transportation-noise-map"},
    "night": {"name": "Black Marble 2016 (VIIRS Day/Night Band) via GIBS", "by": "NASA Earth Observatory / NASA GIBS",
              "licence": "Public domain (NASA); acknowledge NASA GIBS", "url": "https://earthdata.nasa.gov/gibs"},
    "night_viirs": {"name": "NASA Black Marble VNP46A4 annual night-time lights (VIIRS DNB, Collection 2, AllAngle snow-free)",
                    "by": "NASA Black Marble (Roman et al. 2018) via the Level-1 and Atmosphere Archive & Distribution System "
                          "(LAADS) DAAC",
                    "licence": "Public domain (NASA); cite: Roman, M.O. et al. (2018), NASA's Black Marble nighttime lights "
                               "product suite, Remote Sensing of Environment 210, 113-143; doi:10.5067/VIIRS/VNP46A4.002",
                    "url": "https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP46A4/",
                    "mapping": "min(1, (radiance / 20 nW cm-2 sr-1) ** 0.7)"},
    "fcc": {"name": "FCC National Broadband Map, mobile broadband coverage (4G LTE and 5G-NR), Broadband Data Collection",
            "by": "Federal Communications Commission (providers' filings)",
            "licence": "Public domain (US Government); the FCC does not endorse Vetta",
            "url": "https://broadbandmap.fcc.gov/data-download"},
    "census": {"name": "2020 Census blocks (TIGER/Line, POP20, HOUSING20); ACS 5-year B25035 median year built", "by": "US Census Bureau",
               "licence": "Public domain (US Government)", "url": "https://www.census.gov/"},
    "addresses": {"name": "OpenAddresses (county and state address points)", "by": "OpenAddresses contributors and the source counties/states",
                  "licence": "Per source (mostly public domain or CC-BY/CC0); counts only are kept", "url": "https://openaddresses.io/"},
    "hpms": {"name": "Highway Performance Monitoring System (HPMS), full extent", "by": "US DOT Federal Highway Administration and the state DOTs",
             "licence": "Public domain (US Government)", "url": "https://www.fhwa.dot.gov/policyinformation/hpms.cfm"},
    "fars": {"name": "Fatality Analysis Reporting System (FARS)", "by": "US DOT National Highway Traffic Safety Administration",
             "licence": "Public domain (US Government)", "url": "https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars"},
    "flood": {"name": "National Flood Hazard Layer (NFHL), flood hazard zones", "by": "FEMA",
              "licence": "Public domain (US Government)", "url": "https://www.fema.gov/flood-maps/national-flood-hazard-layer"},
    "cdl": {"name": "Cropland Data Layer", "by": "USDA National Agricultural Statistics Service (via Microsoft Planetary Computer)",
            "licence": "Public domain (US Government)", "url": "https://www.nass.usda.gov/Research_and_Science/Cropland/"},
    "parks": {"name": "NPS unit boundaries; NPS visitor use statistics", "by": "US National Park Service",
              "licence": "Public domain (US Government)", "url": "https://irma.nps.gov/Stats/"},
}

NLCD_WCS = "https://www.mrlc.gov/geoserver/mrlc_download/wcs"
NLCD_LAYERS = {"impervious_pct": ("mrlc_download__NLCD_2021_Impervious_L48", 100),
               "canopy_pct": ("mrlc_download__nlcd_tcc_conus_2021_v2021-4", 100)}
NOISE_TILE = "https://geo.dot.gov/server/rest/services/Hosted/NTAD_Noise_2020_CONUS_Road/MapServer/tile/12/{y}/{x}"
NIGHT_TILE = ("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/"
              "GoogleMapsCompatible_Level8/8/{y}/{x}.png")
NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
NPS_BOUNDARY = ("https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/"
                "NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query")
NPS_VISITS = "https://irmaservices.nps.gov/v3/rest/stats/visitation?unitCodes={codes}&startYear={y}&endYear={y}"
HPMS = "https://geo.dot.gov/server/rest/services/Hosted/HPMS_FULL_{st}_{year}/FeatureServer/0/query"
HPMS_FIELDS = ["objectid", "route_id", "begin_point", "end_point", "f_system", "through_lanes", "aadt", "iri", "speed_limit"]
FARS = "https://static.nhtsa.gov/nhtsa/downloads/FARS/{y}/National/FARS{y}NationalCSV.zip"
TIGER_BLOCKS = "https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_{fips}_tabblock20.zip"
TIGER_BG = "https://www2.census.gov/geo/tiger/TIGER2020/BG/tl_2020_{fips}_bg.zip"
TIGER_COUNTY = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip"
TIGER_STATE = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip"
ACS_B25035 = "https://www2.census.gov/programs-surveys/acs/summary_file/{y}/table-based-SF/data/5YRData/acsdt5y{y}-b25035.dat"
OA_LIST = "https://batch.openaddresses.io/api/data"
OA_JOB = "https://v2.openaddresses.io/batch-prod/job/{job}/source.geojson.gz"
PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
PC_TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/usda-cdl"
LAADS_VNP46A4 = "https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VNP46A4"
FCC_API = "https://broadbandmap.fcc.gov/api/public/map"


def earthdata_token():
    """The owner's Earthdata bearer token (GitHub secret EARTHDATA_TOKEN), or None."""
    return (os.environ.get("EARTHDATA_TOKEN") or "").strip() or None


def fcc_creds():
    """(username, token) for the FCC's public data API (secrets FCC_USERNAME, FCC_API_TOKEN), or None unless both are set."""
    u, t = (os.environ.get("FCC_USERNAME") or "").strip(), (os.environ.get("FCC_API_TOKEN") or "").strip()
    return (u, t) if u and t else None


class Ctx:
    def __init__(self, cache, log=print):
        self.cache = cache
        self.log = log
        os.makedirs(cache, exist_ok=True)

    def path(self, *parts):
        p = os.path.join(self.cache, *parts)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return p


def http(url, data=None, timeout=120, tries=4, headers=None):
    """GET (or POST data) with retries and backoff; returns bytes. Raises after the last try. `headers` (credentials) are
    sent but never logged: errors name the URL only."""
    last = None
    for k in range(tries):
        try:
            h = {"User-Agent": UA, **(headers or {})}
            if data is not None:
                h["Content-Type"] = "application/json"
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - network: retry anything
            last = e
            code = getattr(e, "code", None)
            if code in (400, 401, 403, 404):
                break
            time.sleep(2 * (k + 1))
    raise RuntimeError(f"{url}: {last}")


def _lock(key):
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def cached(ctx, key, url, **kw):
    """The bytes at url, kept under cache/key (one download per key across threads)."""
    with _lock(key):
        return _cached(ctx, key, url, **kw)


def _cached(ctx, key, url, **kw):
    p = ctx.path(key)
    if os.path.exists(p) and os.path.getsize(p) > 0:
        with open(p, "rb") as f:
            return f.read()
    b = http(url, **kw)
    with open(p + ".part", "wb") as f:
        f.write(b)
    os.replace(p + ".part", p)
    return b


def cached_file(ctx, key, url, timeout=1800, headers=None):
    """Download a large file to cache/key (streamed) and return its path. One download per file across threads."""
    with _lock(key):
        return _cached_file(ctx, key, url, timeout, headers)


def _cached_file(ctx, key, url, timeout, headers=None):
    p = ctx.path(key)
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return p
    for k in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r, open(p + ".part", "wb") as f:
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
            os.replace(p + ".part", p)
            return p
        except Exception as e:  # noqa: BLE001
            ctx.log(f"  retry {url}: {e}")
            time.sleep(5 * (k + 1))
    raise RuntimeError(f"download failed: {url}")


def qhash(s):
    return hashlib.sha1(s.encode()).hexdigest()[:16]


def arcgis_features(ctx, key, url, params, page=1000):
    """Every GeoJSON feature an ArcGIS REST query returns, paged with resultOffset, cached as one JSON list."""
    p = ctx.path(key)
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    feats, off = [], 0
    while True:
        q = dict(params, f="geojson", resultOffset=off, resultRecordCount=page)
        b = http(url + "?" + urllib.parse.urlencode(q), timeout=180)
        d = json.loads(b)
        if "error" in d:
            raise RuntimeError(f"{url}: {d['error']}")
        got = d.get("features", [])
        feats += got
        more = d.get("exceededTransferLimit") or (d.get("properties") or {}).get("exceededTransferLimit")
        if not got or (not more and len(got) < page):
            break
        off += len(got)
    with open(p + ".part", "w") as f:
        json.dump(feats, f)
    os.replace(p + ".part", p)
    return feats


# ---------------------------------------------------------------------------------------------------------- the target grid
class Window:
    """A rectangle of whole z12 tiles inside one bundle, at one channel's cell size: the unit the rasters are made in."""

    def __init__(self, bx, by, i0, j0, i1, j1, n):
        self.bx, self.by, self.i0, self.j0, self.i1, self.j1, self.n = bx, by, i0, j0, i1, j1, n
        t0 = grid.tile_bounds_merc(bx * 16 + i0, by * 16 + j0, grid.TILE_Z)
        t1 = grid.tile_bounds_merc(bx * 16 + i1, by * 16 + j1, grid.TILE_Z)
        self.west, self.north, self.east, self.south = t0[0], t0[3], t1[2], t1[1]
        self.width, self.height = (i1 - i0 + 1) * n, (j1 - j0 + 1) * n
        self.want = None                           # the tiles actually needed (None: all); per-tile sources skip the rest

    def transform(self, k=1):
        from affine import Affine
        return Affine((self.east - self.west) / (self.width * k), 0, self.west, 0, -(self.north - self.south) / (self.height * k), self.north)

    def lonlat_box(self, pad=0.0):
        (w, s), (e, n) = grid.merc_to_lonlat(self.west, self.south), grid.merc_to_lonlat(self.east, self.north)
        return w - pad, s - pad, e + pad, n + pad

    def row_lats(self):
        ys = self.north - (np.arange(self.height) + 0.5) * (self.north - self.south) / self.height
        return np.degrees(2 * np.arctan(np.exp(ys / grid.R)) - np.pi / 2)

    def split(self, arr):
        """{(i, j): n x n} for every tile of the window."""
        out = {}
        for j in range(self.j0, self.j1 + 1):
            for i in range(self.i0, self.i1 + 1):
                r, c = (j - self.j0) * self.n, (i - self.i0) * self.n
                out[(i, j)] = arr[r:r + self.n, c:c + self.n]
        return out

    def key(self):
        return f"{self.bx}_{self.by}_{self.i0}_{self.j0}_{self.i1}_{self.j1}_{self.n}"


def warp_array(src, src_transform, src_crs, win, resampling, k=1):
    """Reproject a float array (NaN nodata) onto the window's grid (k times finer)."""
    from rasterio.warp import reproject, Resampling
    dst = np.full((win.height * k, win.width * k), np.nan, dtype=np.float32)
    reproject(source=src.astype(np.float32), destination=dst, src_transform=src_transform, src_crs=src_crs, src_nodata=np.nan,
              dst_transform=win.transform(k), dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=getattr(Resampling, resampling))
    return dst.astype(np.float64)


# -------------------------------------------------------------------------------------------------------------- NLCD (WCS)
def nlcd(ctx, channel, win):
    """Impervious or canopy % on the window: the 30 m pixels averaged into each cell (nodata codes > 100 dropped)."""
    import rasterio
    from pyproj import Transformer
    cov, vmax = NLCD_LAYERS[channel]
    t = Transformer.from_crs(3857, 5070, always_xy=True)
    xs, ys = t.transform([win.west, win.east, win.west, win.east], [win.south, win.south, win.north, win.north])
    x0, x1, y0, y1 = min(xs) - 120, max(xs) + 120, min(ys) - 120, max(ys) + 120
    url = (f"{NLCD_WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId={cov}"
           f"&subset=X({x0:.0f},{x1:.0f})&subset=Y({y0:.0f},{y1:.0f})&format=image/geotiff")
    b = cached(ctx, f"nlcd/{cov}/{win.key()}.tif", url, timeout=300)
    with rasterio.MemoryFile(b) as mf, mf.open() as d:
        a = d.read(1).astype(np.float64)
        a[a > vmax] = np.nan                       # 127 (impervious) / 254, 255 (canopy): no data
        return warp_array(a, d.transform, d.crs, win, "average")


# ------------------------------------------------------------------------------------------------------------- noise (BTS)
def noise(ctx, win):
    """The noise map's z12 tiles (38 m pixels, exact palette) -> loudest class floor per cell (n = 64: 4 x 4 pixels)."""
    from PIL import Image
    k = 256 // win.n
    out = np.full((win.height, win.width), np.nan)
    for j in range(win.j0, win.j1 + 1):
        for i in range(win.i0, win.i1 + 1):
            if win.want is not None and (i, j) not in win.want:
                continue
            x, y = win.bx * 16 + i, win.by * 16 + j
            try:
                b = cached(ctx, f"noise/12/{x}/{y}.png", NOISE_TILE.format(x=x, y=y), timeout=60)
            except RuntimeError as e:
                if "404" in str(e):               # outside the map's extent: unknown
                    continue
                raise
            rgba = np.asarray(Image.open(io.BytesIO(b)).convert("RGBA"))
            db = transforms.block_reduce(transforms.decode_noise(rgba), k, "max")
            r, c = (j - win.j0) * win.n, (i - win.i0) * win.n
            out[r:r + win.n, c:c + win.n] = db
    return out


# ------------------------------------------------------------------------------------------------------- night lights
NIGHT_MODE = {"viirs": None}       # set once per run by night_prepare: True VNP46A4, False the 2016 image


def night_prepare(ctx, bbox):
    """Decide the run's night-lights source before any bundle is made, so every bundle says the same: VNP46A4 when there
    is a token and the region's tiles download and read (an expired or refused token must not cost the channel), else the
    2016 image as before. Returns True for VNP46A4."""
    ok = False
    if earthdata_token():
        try:
            for h, v in transforms.bm_tiles_for_box(*bbox):
                bm_tile(ctx, h, v)
            ok = True
        except Exception as e:  # noqa: BLE001
            ctx.log(f"::warning::night lights: VNP46A4 unavailable ({e}); using the Black Marble 2016 image. A refused "
                    f"download usually means EARTHDATA_TOKEN expired (docs/OWNER_TODO.md)")
    NIGHT_MODE["viirs"] = ok
    return ok


def night_lights(ctx, win):
    """The night_lights channel (0..1): Black Marble VNP46A4 annual radiance with an Earthdata token, else the 2016 image."""
    viirs = NIGHT_MODE["viirs"] if NIGHT_MODE["viirs"] is not None else bool(earthdata_token())
    if viirs:
        return night_lights_viirs(ctx, win)
    return night_lights_2016(ctx, win)


def night_lights_2016(ctx, win):
    """NASA Black Marble 2016 at GIBS's level 8 (one 256 px tile per bundle, ~470 m pixels = the n = 16 cells): the red
    channel (city light is warm white; the unlit ground is dark blue) as 0..254."""
    from PIL import Image
    assert win.n == 16
    b = cached(ctx, f"night/8/{win.bx}/{win.by}.png", NIGHT_TILE.format(x=win.bx, y=win.by), timeout=60)
    red = np.asarray(Image.open(io.BytesIO(b)).convert("RGB"))[..., 0].astype(np.float64)
    red = np.minimum(red, 254) / 254.0
    return red[win.j0 * 16:(win.j1 + 1) * 16, win.i0 * 16:(win.i1 + 1) * 16]


# VNP46A4 against the 2016 image over the same cells, summed across the run (build.py logs it), so NIGHT_SAT and
# NIGHT_GAMMA (transforms.py) can be tuned from a real build.
NIGHT_CHECK = {"n": 0, "x": 0.0, "y": 0.0, "xx": 0.0, "yy": 0.0, "xy": 0.0, "dark_both": 0, "dark_2016": 0, "dark_new": 0}
_night_lock = threading.Lock()
_bm_listing = {}
_bm_tiles = {}


def _bearer():
    return {"Authorization": "Bearer " + earthdata_token()}


def _laads_json(ctx, path, key):
    return json.loads(cached(ctx, key, f"{LAADS_VNP46A4}{path}.json", timeout=120, headers=_bearer()))


def bm_year(ctx):
    """(year, file names in its day-001 directory) for the newest VNP46A4 year LAADS lists with files; once per run."""
    with _night_lock:
        if "year" not in _bm_listing:
            years = [c["name"] for c in _laads_json(ctx, "", "night_viirs/years.json").get("content", [])]
            for y in sorted((v for v in years if str(v).isdigit()), key=int, reverse=True):
                try:
                    names = [c["name"] for c in _laads_json(ctx, f"/{y}/001", f"night_viirs/{y}_001.json").get("content", [])]
                except RuntimeError:
                    names = []
                if any(n.endswith(".h5") for n in names):
                    _bm_listing.update(year=int(y), names=names)
                    break
            else:
                raise RuntimeError("LAADS lists no VNP46A4 year with files")
            SOURCES["night_viirs"]["year"] = _bm_listing["year"]
            ctx.log(f"  night lights: VNP46A4 {_bm_listing['year']} (LAADS)")
        return _bm_listing["year"], _bm_listing["names"]


def read_vnp46a4(path):
    """A VNP46A4 HDF5 tile -> radiance (float64, 2400 x 2400, NaN unknown). Needs h5py (tools/ctx_etl/requirements.txt)."""
    import h5py

    def attr(d, k, default):
        v = d.attrs.get(k, default)
        return np.asarray(v).ravel()[0] if np.size(v) else default

    with h5py.File(path, "r") as f:
        d = f[transforms.BM_FIELDS + transforms.BM_LAYER]
        q = f.get(transforms.BM_FIELDS + transforms.BM_LAYER + "_Quality")
        return transforms.vnp46_radiance(d[()], q[()] if q is not None else None, fill=attr(d, "_FillValue", 65535),
                                         scale=attr(d, "scale_factor", 0.1), offset=attr(d, "add_offset", 0.0))


def bm_tile(ctx, h, v):
    """One tile's radiance, kept in memory (a bundle's chunks share it), or None where LAADS has no file (open ocean)."""
    key = (h, v)
    with _lock(("bm", h, v)):
        if key not in _bm_tiles:
            year, names = bm_year(ctx)
            name = transforms.bm_file_for(names, h, v)
            if name is None:
                rad = None
            else:
                p = cached_file(ctx, f"night_viirs/{year}/{name}", f"{LAADS_VNP46A4}/{year}/001/{name}", timeout=1800,
                                headers=_bearer())
                with open(p, "rb") as f:
                    sig = f.read(8)
                if sig != b"\x89HDF\r\n\x1a\n":   # a login page after a refused token: not kept in the cache
                    os.remove(p)
                    raise RuntimeError(f"{name}: not an HDF5 file (download refused?)")
                rad = read_vnp46a4(p).astype(np.float32)
            with _night_lock:
                if len(_bm_tiles) >= 4:                # 2400 x 2400 float32 is 23 MB: keep the few a region needs
                    _bm_tiles.pop(next(iter(_bm_tiles)))
                _bm_tiles[key] = rad
        return _bm_tiles[key]


def night_lights_viirs(ctx, win):
    """VNP46A4 annual radiance averaged into the window's ~470 m cells and mapped to 0..1 (transforms.night_from_radiance);
    cells with no good pixel stay unknown. Each chunk is compared with the 2016 image (NIGHT_CHECK) when that loads."""
    from affine import Affine
    w, s, e, n = win.lonlat_box(0.01)
    out = np.full((win.height, win.width), np.nan)
    for h, v in transforms.bm_tiles_for_box(w, s, e, n):
        rad = bm_tile(ctx, h, v)
        if rad is None:
            continue
        x0, y0, px = transforms.bm_tile_origin(h, v)
        c0, c1 = max(0, int((w - x0) / px) - 2), min(rad.shape[1], int((e - x0) / px) + 3)
        r0, r1 = max(0, int((y0 - n) / px) - 2), min(rad.shape[0], int((y0 - s) / px) + 3)
        if c0 >= c1 or r0 >= r1:
            continue
        part = warp_array(rad[r0:r1, c0:c1], Affine(px, 0, x0 + c0 * px, 0, -px, y0 - r0 * px), "EPSG:4326", win, "average")
        out = np.where(np.isnan(out), part, out)
    new = transforms.night_from_radiance(out)
    try:
        old = night_lights_2016(ctx, win)
        ok = np.isfinite(old) & np.isfinite(new)
        a, b = old[ok], new[ok]
        with _night_lock:
            c = NIGHT_CHECK
            c["n"] += int(a.size)
            c["x"] += float(a.sum())
            c["y"] += float(b.sum())
            c["xx"] += float((a * a).sum())
            c["yy"] += float((b * b).sum())
            c["xy"] += float((a * b).sum())
            c["dark_both"] += int(((a < 0.15) & (b < 0.15)).sum())
            c["dark_2016"] += int((a < 0.15).sum())
            c["dark_new"] += int((b < 0.15).sum())
    except Exception:  # noqa: BLE001 - the comparison is a log line, never a reason to lose the channel
        pass
    return new


def night_check_summary(c=None):
    """One line comparing the run's VNP46A4 night lights with the 2016 image, or None when nothing was compared."""
    c = c or NIGHT_CHECK
    if not c["n"]:
        return None
    n = c["n"]
    mx, my = c["x"] / n, c["y"] / n
    vx, vy = c["xx"] / n - mx * mx, c["yy"] / n - my * my
    r = (c["xy"] / n - mx * my) / math.sqrt(vx * vy) if vx > 0 and vy > 0 else float("nan")
    return (f"night lights vs 2016 over {n} cells: mean {mx:.3f} (2016) / {my:.3f} (VNP46A4), r = {r:.2f}; dark (< 0.15) "
            f"{c['dark_2016']} / {c['dark_new']} cells, both {c['dark_both']}")


# ------------------------------------------------------------------------------------------------------------ flood (FEMA)
def flood(ctx, win):
    """NFHL flood hazard areas on the window, rasterised at 4x and the highest class kept per cell; NaN where unmapped."""
    from rasterio.features import rasterize
    w, s, e, n = win.lonlat_box(0.002)
    feats = arcgis_features(ctx, f"flood/{win.key()}.json", NFHL, {
        "where": "1=1", "geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects", "outFields": "FLD_ZONE,ZONE_SUBTY", "outSR": 3857,
        "maxAllowableOffset": 5, "geometryPrecision": 0}, page=500)
    shapes = []
    for f in feats:
        p = f.get("properties") or {}
        c = transforms.flood_class(p.get("FLD_ZONE"), p.get("ZONE_SUBTY"))
        if c is not None and f.get("geometry"):
            shapes.append((f["geometry"], c))
    shapes.sort(key=lambda t: t[1])                # higher classes drawn last win
    k = 4
    if not shapes:
        return np.full((win.height, win.width), np.nan)
    fine = rasterize(shapes, out_shape=(win.height * k, win.width * k), transform=win.transform(k), fill=255, dtype="uint8")
    fine = fine.astype(np.float64)
    fine[fine == 255] = np.nan
    return transforms.block_reduce(fine, k, "max")


# ---------------------------------------------------------------------------------------------------------- crops (USDA CDL)
def cdl(ctx, win):
    """The Cropland Data Layer's most common class per cell (the newest year Planetary Computer holds)."""
    import rasterio
    w, s, e, n = win.lonlat_box(0.01)
    body = json.dumps({"collections": ["usda-cdl"], "bbox": [w, s, e, n], "limit": 200,
                       "query": {"usda_cdl:type": {"eq": "cropland"}}}).encode()
    items = json.loads(cached(ctx, f"cdl/stac_{win.key()}.json", PC_STAC, data=body))["features"]
    if not items:
        return np.full((win.height, win.width), np.nan)
    newest = max(i["properties"]["start_datetime"][:4] for i in items)
    items = [i for i in items if i["properties"]["start_datetime"][:4] == newest]
    token = json.loads(http(PC_TOKEN))["token"]
    out = np.full((win.height, win.width), np.nan)
    for it in items:
        href = it["assets"]["cropland"]["href"]
        tif = cached_file(ctx, "cdl/" + href.split("/usda-cdl/")[-1], href + "?" + token)
        with rasterio.open(tif) as d:
            a = d.read(1).astype(np.float64)
            a[a == 0] = np.nan                     # background / no data
            part = warp_array(a, d.transform, d.crs, win, "mode")
        out = np.where(np.isnan(out), part, out)
    SOURCES["cdl"]["year"] = int(newest)
    return out


# ------------------------------------------------------------------------------------------------------------- vector helpers
def _merc_xy(lon, lat):
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.clip(np.asarray(lat, dtype=np.float64), -85.05, 85.05)
    return np.radians(lon) * grid.R, np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * grid.R


def _shape_polys(shape):
    """A pyshp polygon (lon/lat) -> [[ring (float64 mercator x, y array), holes...], ...]. pyshp gives outer rings clockwise
    and holes counter-clockwise; each hole goes with the outer ring before it."""
    pts = np.asarray(shape.points, dtype=np.float64)
    if not len(pts):
        return []
    x, y = _merc_xy(pts[:, 0], pts[:, 1])
    parts = list(shape.parts) + [len(pts)]
    polys = []
    for a, b in zip(parts[:-1], parts[1:]):
        if b - a < 4:
            continue
        r = np.column_stack([x[a:b], y[a:b]])
        area = 0.5 * np.sum(r[:-1, 0] * r[1:, 1] - r[1:, 0] * r[:-1, 1])
        if area <= 0 or not polys:                 # clockwise in a y-up frame: an outer ring
            polys.append([r])
        else:
            polys[-1].append(r)
    return polys


def geojson(polys):
    return {"type": "MultiPolygon", "coordinates": [[r.tolist() for r in poly] for poly in polys]}


class ShapeStore:
    """A state-wide shapefile read once and split by bundle (pickled under cache/split/), so a seven-state run never holds
    every block in memory and each bundle reads only its own. get(bx, by) -> [(polys, box, attrs)] in mercator."""

    def __init__(self, ctx, name, zip_path, fields, bbox, bundles):
        import pickle
        import shapefile
        self.dir = os.path.join(ctx.cache, "split", name)
        self.count = 0
        done = os.path.join(self.dir, f"done_{qhash(str((fields, bbox, sorted(bundles))))}")
        if os.path.exists(done):
            with open(done) as f:
                self.count = int(f.read() or 0)
            return
        os.makedirs(self.dir, exist_ok=True)
        w, s, e, n = bbox
        buckets = {}
        with shapefile.Reader(zip_path) as r:
            names = [f[0] for f in r.fields[1:]]
            idx = [names.index(f) for f in fields]
            for k in range(len(r)):
                sh = r.shape(k)
                if not getattr(sh, "points", None):
                    continue
                x0, y0, x1, y1 = sh.bbox
                if x1 < w or x0 > e or y1 < s or y0 > n:
                    continue
                polys = _shape_polys(sh)
                if not polys:
                    continue
                rec = r.record(k)
                allp = np.concatenate([ring for poly in polys for ring in poly])
                box = (allp[:, 0].min(), allp[:, 1].min(), allp[:, 0].max(), allp[:, 1].max())
                item = ([[ring.astype(np.float32) for ring in poly] for poly in polys], box, {f: rec[i] for f, i in zip(fields, idx)})
                tx0, ty0 = grid.lonlat_to_tile(x0, y1, grid.BUNDLE_Z)
                tx1, ty1 = grid.lonlat_to_tile(x1, y0, grid.BUNDLE_Z)
                for bx in range(tx0, tx1 + 1):
                    for by in range(ty0, ty1 + 1):
                        if (bx, by) in bundles:
                            buckets.setdefault((bx, by), []).append(item)
                self.count += 1
        for (bx, by), items in buckets.items():
            with open(os.path.join(self.dir, f"{bx}_{by}.pkl"), "wb") as f:
                pickle.dump(items, f, protocol=4)
        with open(done, "w") as f:
            f.write(str(self.count))

    def get(self, bx, by):
        import pickle
        p = os.path.join(self.dir, f"{bx}_{by}.pkl")
        if not os.path.exists(p):
            return []
        with open(p, "rb") as f:
            return pickle.load(f)


def in_window(win, items):
    """The items [(polys, box, ...)] whose box touches the window."""
    return [t for t in items if t[1][2] >= win.west and t[1][0] <= win.east and t[1][3] >= win.south and t[1][1] <= win.north]


def rasterize_mean(win, shapes, k=4):
    """Shapes [(polys, value)] -> the mean value over each cell (rasterised k times finer); NaN where none."""
    from rasterio.features import rasterize
    if not shapes:
        return np.full((win.height, win.width), np.nan)
    fine = rasterize([(geojson(g), float(v)) for g, v in shapes], out_shape=(win.height * k, win.width * k),
                     transform=win.transform(k), fill=np.nan, dtype="float32")
    return transforms.block_reduce(fine.astype(np.float64), k, "mean")


# ------------------------------------------------------------------------------------------------------------- census
def state_boundaries(ctx, states):
    """{state abbreviation: shapely geometry (lon/lat)}."""
    import shapefile
    from shapely.geometry import shape as shp
    p = cached_file(ctx, "census/cb_2023_us_state_500k.zip", TIGER_STATE)
    out = {}
    with shapefile.Reader(p) as r:
        names = [f[0] for f in r.fields[1:]]
        for sr in r.iterShapeRecords():
            st = sr.record[names.index("STUSPS")]
            if st in states:
                out[st] = shp(sr.shape.__geo_interface__)
    return out


def county_boundaries(ctx, states):
    """{(state fips, county name lower): shapely geometry (lon/lat)}."""
    import shapefile
    from shapely.geometry import shape as shp
    fips = {STATE_FIPS[s] for s in states}
    p = cached_file(ctx, "census/cb_2023_us_county_500k.zip", TIGER_COUNTY)
    out = {}
    with shapefile.Reader(p) as r:
        names = [f[0] for f in r.fields[1:]]
        for sr in r.iterShapeRecords():
            sf = sr.record[names.index("STATEFP")]
            if sf in fips:
                out[(sf, sr.record[names.index("NAME")].lower())] = shp(sr.shape.__geo_interface__)
    return out


class Blocks:
    """2020 Census blocks of the region's states (split by bundle once): housing units and residents per km2."""

    def __init__(self, ctx, states, bbox, bundles):
        self.stores = []
        for st in states:
            p = cached_file(ctx, f"census/tl_2020_{STATE_FIPS[st]}_tabblock20.zip", TIGER_BLOCKS.format(fips=STATE_FIPS[st]))
            self.stores.append(ShapeStore(ctx, f"blocks_{st}", p, ["HOUSING20", "POP20", "ALAND20", "AWATER20"], bbox, bundles))
        ctx.log(f"  census blocks: {sum(s.count for s in self.stores)}")
        self._cache = (None, None)

    def _items(self, win):
        if self._cache[0] != (win.bx, win.by):
            items = [it for s in self.stores for it in s.get(win.bx, win.by)]
            self._cache = ((win.bx, win.by), items)
        return self._cache[1]

    def density(self, win, which):
        out = []
        for polys, _box, a in in_window(win, self._items(win)):
            area = (float(a["ALAND20"] or 0) + float(a["AWATER20"] or 0)) / 1e6
            if area > 0:
                out.append((polys, float(a["HOUSING20" if which == "housing" else "POP20"] or 0) / area))
        return rasterize_mean(win, out)


class YearBuilt:
    """ACS 5-year B25035 median year structure built, per 2020 block group."""

    def __init__(self, ctx, states, bbox, bundles):
        self.table = {}
        for y in (2024, 2023):
            try:
                raw = cached(ctx, f"census/acsdt5y{y}-b25035.dat", ACS_B25035.format(y=y), timeout=600)
                self.year = y
                break
            except RuntimeError:
                continue
        for line in raw.decode("latin1").splitlines()[1:]:
            parts = line.split("|")
            if parts[0].startswith("1500000US"):
                self.table[parts[0][9:]] = transforms.acs_value(parts[1])
        self.stores = []
        for st in states:
            p = cached_file(ctx, f"census/tl_2020_{STATE_FIPS[st]}_bg.zip", TIGER_BG.format(fips=STATE_FIPS[st]))
            self.stores.append(ShapeStore(ctx, f"bg_{st}", p, ["GEOID"], bbox, bundles))
        SOURCES["census"]["acs_year"] = self.year
        ctx.log(f"  block groups: {sum(s.count for s in self.stores)} (ACS {self.year})")

    def raster(self, win):
        shapes = []
        for st in self.stores:
            for polys, _box, a in in_window(win, st.get(win.bx, win.by)):
                v = self.table.get(a["GEOID"], math.nan)
                if not math.isnan(v):
                    shapes.append((polys, v))
        return rasterize_mean(win, shapes)


# ----------------------------------------------------------------------------------------------------------- addresses
class Addresses:
    """OpenAddresses points for the region, deduplicated, with the counties they cover (unknown elsewhere). A state's
    statewide source is used when OpenAddresses has one (its coverage is then the whole state); otherwise its county
    sources. City-only sources are skipped (their coverage can't be told from the county's)."""

    def __init__(self, ctx, states, bbox, counties):
        from shapely.geometry import box
        from shapely.ops import unary_union
        listing = json.loads(cached(ctx, "addresses/oa_data.json", OA_LIST, timeout=300))
        region = box(*bbox)
        cover, lon, lat, used = [], [], [], []
        for st in states:
            pre = f"us/{st.lower()}/"
            srcs = [x for x in listing if x.get("layer") == "addresses" and x.get("source", "").startswith(pre) and x.get("job")]
            statewide = [x for x in srcs if x["source"] == pre + "statewide" and x.get("name") == "state"]
            if statewide:
                picks = [(statewide[0], self._state_geom(ctx, st))]
            else:
                picks = []
                for x in srcs:
                    if x.get("name") != "county":
                        continue
                    cname = x["source"][len(pre):].replace("_", " ").replace(" county", "").strip()
                    g = counties.get((STATE_FIPS[st], cname))
                    if g is not None:
                        picks.append((x, g))
            for x, g in picks:
                if g is None or not g.intersects(region):
                    continue
                pts = self._points(ctx, x["job"], x["source"])
                cover.append(g)
                lon.append(pts[:, 0])
                lat.append(pts[:, 1])
                used.append(x["source"])
        self.cover = unary_union(cover) if cover else None
        if lon:
            a = np.column_stack([np.concatenate(lon), np.concatenate(lat)])
            a = np.unique(np.round(a, 5), axis=0)          # the same point in two sources (about 1 m); sorted by lon
            self.lon, self.lat = a[:, 0], a[:, 1]
        else:
            self.lon = self.lat = np.zeros(0)
        self.x, self.y = _merc_xy(self.lon, self.lat)
        if self.cover is not None:
            from shapely.ops import transform as stransform
            self.cover_merc = stransform(lambda X, Y, Z=None: _merc_xy(X, Y), self.cover)
        SOURCES["addresses"]["sources"] = used
        ctx.log(f"  addresses: {len(self.lon)} from {len(used)} sources")

    def _state_geom(self, ctx, st):
        return state_boundaries(ctx, [st]).get(st)

    @staticmethod
    def _points(ctx, job, source):
        p = ctx.path("addresses", source.replace("/", "_") + ".npy")
        if os.path.exists(p):
            return np.load(p)
        gz = cached_file(ctx, "addresses/" + source.replace("/", "_") + ".geojson.gz", OA_JOB.format(job=job))
        rx = re.compile(rb'"coordinates":\s*\[\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)')
        out = []
        with gzip.open(gz, "rb") as f:
            for line in f:
                m = rx.search(line)
                if m:
                    out.append((float(m.group(1)), float(m.group(2))))
        a = np.asarray(out, dtype=np.float64).reshape(-1, 2)
        np.save(p, a)
        return a

    def density(self, win):
        from rasterio.features import rasterize
        from shapely.geometry import box
        pad = (win.east - win.west) / win.width            # one cell: the smoothing reaches that far
        a, b = np.searchsorted(self.x, [win.west - pad, win.east + pad])
        x, y = self.x[a:b], self.y[a:b]
        px = np.floor((x - win.west) / (win.east - win.west) * win.width).astype(int)
        py = np.floor((win.north - y) / (win.north - win.south) * win.height).astype(int)
        d = transforms.count_density(px, py, (win.height, win.width), transforms.cell_area_km2(win.n, win.row_lats()))
        if self.cover is None:
            return np.full(d.shape, np.nan)
        cov = self.cover_merc.intersection(box(win.west, win.south, win.east, win.north))
        if cov.is_empty:
            return np.full(d.shape, np.nan)
        mask = rasterize([(cov, 1)], out_shape=d.shape, transform=win.transform(), fill=0, dtype="uint8")
        d[mask == 0] = np.nan
        return d


# ---------------------------------------------------------------------------------------------------------------- parks
class Parks:
    """NPS units in the region with their latest full year of recreation visits (and the month by month split)."""

    def __init__(self, ctx, bbox):
        w, s, e, n = bbox
        feats = arcgis_features(ctx, f"parks/boundary_{qhash(str(bbox))}.json", NPS_BOUNDARY, {
            "where": "1=1", "geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "outFields": "UNIT_CODE,UNIT_NAME,UNIT_TYPE", "outSR": 3857, "maxAllowableOffset": 10}, page=200)
        units = {}
        for f in feats:
            p = f.get("properties") or {}
            if f.get("geometry") and p.get("UNIT_CODE"):
                units.setdefault(p["UNIT_CODE"], {"code": p["UNIT_CODE"], "name": p.get("UNIT_NAME"), "type": p.get("UNIT_TYPE"), "geoms": []})["geoms"].append(f["geometry"])
        self.units = sorted(units.values(), key=lambda u: u["code"])[:254]
        self.year = None
        codes = [u["code"] for u in self.units]
        this_year = time.gmtime().tm_year
        for y in range(this_year - 1, this_year - 4, -1):
            visits = self._visits(ctx, codes, y)
            if visits:
                self.year = y
                for u in self.units:
                    m = visits.get(u["code"])
                    u["monthly"] = m if m and len(m) == 12 else None
                    u["visits"] = sum(m) if u["monthly"] else None
                break
        ctx.log(f"  park units: {len(self.units)} (visits {self.year})")

    @staticmethod
    def _visits(ctx, codes, y):
        if not codes:
            return {}
        out = {}
        for k in range(0, len(codes), 20):
            chunk = ",".join(codes[k:k + 20])
            b = cached(ctx, f"parks/visits_{y}_{qhash(chunk)}.xml", NPS_VISITS.format(codes=chunk, y=y), timeout=120)
            for m in re.finditer(rb"<VisitationData>(.*?)</VisitationData>", b, re.S):
                rec = m.group(1)
                g = lambda t: (re.search(rb"<" + t + rb">([^<]*)</" + t + rb">", rec) or [None, b""])[1].decode()
                code, month, rv = g(b"UnitCode"), g(b"Month"), g(b"RecreationVisitors")
                if code and month and rv:
                    out.setdefault(code, [0] * 12)[int(month) - 1] = int(rv)
        months = {c: v for c, v in out.items() if any(v)}
        # a year is complete only when December is in for most units
        if not months or sum(1 for v in months.values() if v[11] > 0) < max(1, len(months) // 2):
            return {}
        return months

    def raster(self, win):
        from rasterio.features import rasterize
        shapes = [(g, k + 1) for k, u in enumerate(self.units) for g in u["geoms"]]
        out = np.zeros((win.height, win.width))
        if shapes:
            out = rasterize(shapes, out_shape=(win.height, win.width), transform=win.transform(), fill=0, all_touched=True,
                            dtype="uint8").astype(np.float64)
        return out

    def table(self):
        return [{"code": u["code"], "name": u["name"], "type": u["type"], "visits": u.get("visits"), "monthly": u.get("monthly"),
                 "year": self.year} for u in self.units]


# ------------------------------------------------------------------------------------------------------------------ HPMS
def hpms_rows(ctx, st, bbox, years=(2025, 2024)):
    """HPMS sections for one state in the bbox: [(key, attrs, [(lon, lat), ...])], items merged across duplicate rows."""
    w, s, e, n = bbox
    for year in years:
        url = HPMS.format(st=st, year=year)
        try:
            feats = arcgis_features(ctx, f"hpms/{st}_{year}_{qhash(str(bbox))}.json", url, {
                "where": "1=1", "geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                "outFields": ",".join(HPMS_FIELDS), "outSR": 4326, "geometryPrecision": 6}, page=2000)
        except RuntimeError as err:
            ctx.log(f"  HPMS {st} {year}: {err}")
            continue
        rows = []
        for f in feats:
            g, p = f.get("geometry"), f.get("properties") or {}
            if not g:
                continue
            lines = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
            attrs = {"aadt": p.get("aadt"), "iri": p.get("iri"), "speed_limit": p.get("speed_limit"),
                     "lanes": p.get("through_lanes"), "fclass": p.get("f_system")}
            for k, line in enumerate(lines):
                if len(line) >= 2:
                    key = (p.get("route_id"), p.get("begin_point"), p.get("end_point"), k)
                    rows.append((key, attrs, [tuple(c[:2]) for c in line]))
        SOURCES["hpms"].setdefault("years", {})[st] = year
        return transforms.merge_hpms(rows)
    return []


# ------------------------------------------------------------------------------------------------------------------ FARS
def fars_points(ctx, states, years):
    """Fatal crashes in these states: array of (lon, lat, year, fatalities, hour)."""
    fips = {int(STATE_FIPS[s]) for s in states}
    out = []
    for y in years:
        p = cached_file(ctx, f"fars/FARS{y}NationalCSV.zip", FARS.format(y=y))
        with zipfile.ZipFile(p) as z:
            name = next(x for x in z.namelist() if x.lower().endswith("accident.csv"))
            with z.open(name) as f:
                rd = csv.DictReader(io.TextIOWrapper(f, encoding="latin1"))
                rd.fieldnames = [h.lstrip("\ufeff").replace("\xef\xbb\xbf", "").strip().upper() for h in rd.fieldnames]
                for row in rd:
                    if int(row["STATE"]) not in fips:
                        continue
                    try:
                        la, lo = float(row["LATITUDE"]), float(row["LONGITUD"])
                    except ValueError:
                        continue
                    if not (17 < la < 72 and -180 < lo < -60):   # 77.7777 / 88.8888 / 99.9999 and 7xx-9xx: not reported
                        continue
                    hour = int(row.get("HOUR") or 99)
                    out.append((lo, la, int(row.get("YEAR") or y), int(row.get("FATALS") or 1), hour if hour < 24 else 255))
    SOURCES["fars"]["years"] = [min(years), max(years)]
    return np.asarray(out, dtype=np.float64).reshape(-1, 5)


# ----------------------------------------------------------------------------------------------- mobile coverage (FCC BDC)
def _fcc_headers():
    u, t = fcc_creds()
    return {"username": u, "hash_value": t, "user_agent": UA}


def fcc_json(ctx, path, key, params=None):
    """The FCC public data API's JSON answer for path (cached under key). Credentials go in headers, never the URL."""
    url = FCC_API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    d = json.loads(cached(ctx, key, url, timeout=180, headers=_fcc_headers()))
    if str(d.get("status_code", 200)) not in ("200", "") and d.get("status") not in (None, "success", "successful"):
        raise RuntimeError(f"FCC {path}: {d.get('status_code')} {d.get('message')}")
    return d


class MobileCoverage:
    """Providers reporting 4G LTE or 5G-NR mobile coverage per cell, from the FCC National Broadband Map (Broadband Data
    Collection, the newest as-of date). For each region state: the state's availability listing, its mobile-broadband
    coverage files (transforms.fcc_pick_files: one environment for the state, in-vehicle where listed), each provider's
    shapefiles split by bundle (ShapeStore). A cell counts a provider when the provider's 4G or 5G coverage reaches any of
    its four quarter-cell points; cells outside a state whose listing was read, or where a provider's file couldn't be
    read, are unknown (NaN), never 0."""

    def __init__(self, ctx, states, bbox, bundles):
        from shapely.ops import transform as stransform
        self.as_of = transforms.latest_as_of(fcc_json(ctx, "/listAsOfDates", "fcc/as_of_dates.json"))
        if not self.as_of:
            raise RuntimeError("FCC lists no availability as-of date")
        self.providers = {}          # provider id -> {"name", "stores": [ShapeStore]}
        self.failed = set()          # provider ids with a file that couldn't be read
        self.known = []              # mercator state geometries whose listing was read
        envs = {}
        shapes = state_boundaries(ctx, states)
        for st in states:
            fips = STATE_FIPS[st]
            try:
                listing = fcc_json(ctx, f"/downloads/listAvailabilityData/{self.as_of}", f"fcc/{self.as_of}/list_{fips}.json",
                                   {"category": "State", "technology_type": "Mobile Broadband", "state_fips": fips})
            except RuntimeError as e:
                ctx.log(f"  ! FCC listing {st}: {e}")
                continue
            picked, env = transforms.fcc_pick_files(listing.get("data") or [], fips)
            if not picked:
                ctx.log(f"  ! FCC {st}: no 4G/5G mobile coverage files listed")
                continue
            envs[st] = env
            for pid, p in picked.items():
                prov = self.providers.setdefault(pid, {"name": p["name"], "stores": []})
                for e in p["files"]:
                    try:
                        shp = self._shapefile(ctx, e)
                        prov["stores"].append(ShapeStore(ctx, f"fcc_{self.as_of}_{e['file_id']}", shp, [], bbox, bundles))
                    except Exception as err:  # noqa: BLE001 - this provider is unknown here, the rest still count
                        ctx.log(f"  ! FCC {st} {p['name']} file {e['file_id']}: {err}")
                        self.failed.add(pid)
            if st in shapes:
                self.known.append(stransform(lambda X, Y, Z=None: _merc_xy(X, Y), shapes[st]))
        SOURCES["fcc"].update(as_of=self.as_of, environment=envs, providers=len(self.providers))
        ctx.log(f"  FCC mobile coverage {self.as_of}: {len(self.providers)} providers in {sorted(envs)} ({envs})")

    @staticmethod
    def _shapefile(ctx, e):
        """A listed GIS file -> the path of its .shp (downloaded as a shapefile zip, extracted once)."""
        d = os.path.join(ctx.cache, "fcc", "files", str(e["file_id"]))
        os.makedirs(d, exist_ok=True)
        done = os.path.join(d, ".done")
        if not os.path.exists(done):
            z = cached_file(ctx, f"fcc/files/{e['file_id']}.zip", f"{FCC_API}/downloads/downloadFile/availability/{e['file_id']}/1",
                            timeout=1800, headers=_fcc_headers())
            with zipfile.ZipFile(z) as zf:
                for m in zf.namelist():
                    if m.endswith("/") or ".." in m or m.startswith("/"):
                        continue
                    zf.extract(m, d)
            open(done, "w").close()
        shps = sorted(os.path.join(r, f) for r, _ds, fs in os.walk(d) for f in fs if f.lower().endswith(".shp"))
        if not shps:
            raise RuntimeError("no shapefile in the download")
        prj = shps[0][:-4] + ".prj"
        if os.path.exists(prj) and "PROJCS" in open(prj).read().upper():
            raise RuntimeError("projected shapefile (lon/lat expected)")
        return shps[0]

    def raster(self, win):
        from rasterio.features import rasterize
        from shapely.geometry import box
        k = 2
        known = np.zeros((win.height, win.width), dtype=bool)
        wbox = box(win.west, win.south, win.east, win.north)
        for g in self.known:
            part = g.intersection(wbox)
            if not part.is_empty:
                known |= rasterize([(part, 1)], out_shape=known.shape, transform=win.transform(), fill=0, dtype="uint8") > 0
        if not known.any():
            return np.full(known.shape, np.nan)
        covered = []
        for pid, p in self.providers.items():
            items = [t for st in p["stores"] for t in in_window(win, st.get(win.bx, win.by))]
            if items:
                fine = rasterize([(geojson(polys), 1) for polys, _b, _a in items], out_shape=(win.height * k, win.width * k),
                                 transform=win.transform(k), fill=0, dtype="uint8").astype(np.float64)
                c = transforms.block_reduce(fine, k, "max")
            else:
                c = np.zeros(known.shape)
            if pid in self.failed:
                c = np.where(c >= 0.5, 1.0, np.nan)    # what it does report counts; where it doesn't, unknown
            covered.append(c)
        return transforms.provider_count(covered, known)
