"""The context grid's geometry and channel specs (mirrored in web/route_ctx/context_grid.js; tests check they agree).

Web mercator (EPSG:3857). A bundle is one z8 tile (about 156 x 122 km at 38 N), holding the z12 tiles (16 x 16 of them,
about 9.8 x 7.6 km each) that have data. Each raster channel has `n` cells along a z12 tile's edge, so its cells are the
pixels of zoom 12 + log2(n):

    n = 16  -> ~475 m cells at 39 N   (night lights: the source's own ~460 m pixels)
    n = 32  -> ~238 m cells           (land cover, people, addresses, crops, signal)
    n = 64  -> ~119 m cells           (sparse, road-hugging layers: noise, flood zones, park units)

Values are stored quantised: value = raw * scale + offset; raw == nodata means unknown (NaN on the phone, never 0).
Densities (people, homes, addresses per km2) span 0 to 20,000, so they are stored on a log scale instead: offset is the
string "log1p" and value = expm1(raw * scale), steps of about 4% (0 stays exactly 0).
"""
import math

R = 6378137.0
WORLD = 2 * math.pi * R          # metres along the equator in web mercator
ORIGIN = math.pi * R
BUNDLE_Z = 8
TILE_Z = 12
TILES_PER_BUNDLE = 1 << (TILE_Z - BUNDLE_Z)   # 16

LOG = "log1p"
LOG_SCALE = math.log1p(20000) / 254            # raw 254 = 20,000 per km2 (denser cells are clipped there)

# name: (n, dtype, scale, offset, nodata, unit, reduce, meaning)
CHANNELS = {
    "night_lights": (16, "u8", 1 / 254, 0.0, 255, "0-1",
                     "copy", "Relative night-time brightness, 0 dark to 1 brightest: NASA Black Marble VNP46A4 annual "
                     "radiance r (nW/cm2/sr) as min(1, (r / 20) ** 0.7) when built with an Earthdata token, else the Black "
                     "Marble 2016 tone-mapped image (VIIRS DNB); either way it saturates in the suburbs; the bundle's "
                     "sources say which"),
    "impervious_pct": (32, "u8", 1.0, 0.0, 255, "%", "mean", "Impervious surface share of the cell (NLCD 2021)"),
    "canopy_pct": (32, "u8", 1.0, 0.0, 255, "%", "mean", "Tree canopy cover of the cell (NLCD / USFS Tree Canopy Cover 2021)"),
    "noise_db": (64, "u8", 1.0, 0.0, 255, "dB LAeq(24h)", "max",
                 "Loudest modelled road-noise class within the cell, as the class floor in dB (BTS National Transportation "
                 "Noise Map 2020, roads); 40 means below the map's 45 dB floor"),
    "housing_density": (32, "u8", LOG_SCALE, LOG, 255, "units/km2", "mean", "Housing units per km2 (2020 Census blocks)"),
    "population_density": (32, "u8", LOG_SCALE, LOG, 255, "people/km2", "mean", "Residents per km2 (2020 Census blocks)"),
    "address_density": (32, "u8", LOG_SCALE, LOG, 255, "addresses/km2", "count",
                        "Address points per km2 (OpenAddresses county/state sources), 3x3-cell smoothed; unknown where no "
                        "source covers the county"),
    "median_year_built": (32, "u16", 1.0, 0.0, 65535, "year", "mean",
                          "Median year the homes were built (ACS 5-year B25035, block group); 1939 means 1939 or earlier"),
    "flood_zone": (64, "u8", 1.0, 0.0, 255, "class", "max",
                   "Highest FEMA flood class in the cell: 0 minimal (zone X), 1 0.2% annual chance, 2 1% annual chance "
                   "(A, AE, AH, AO), 3 regulatory floodway, 4 coastal high hazard (V, VE); unknown where unmapped or zone D"),
    "cropland_class": (32, "u8", 1.0, 0.0, 255, "CDL code", "mode",
                       "Most common USDA Cropland Data Layer class in the cell (1 corn, 5 soybeans, 24 winter wheat, 36 "
                       "alfalfa, 37 other hay, 61 fallow, 111 water, 121-124 developed, 141-143 forest, 176 grass/pasture)"),
    "park_unit": (64, "u8", 1.0, 0.0, 255, "index", "max",
                  "National Park Service unit the cell is in: 0 none, else an index into the bundle's park table"),
    "mobile_coverage": (32, "u8", 1.0, 0.0, 255, "providers", "max",
                        "Mobile providers with coverage in the cell; no source (the FCC download was dropped, "
                        "2026-11-08), so never built and absent from every bundle"),
}

DTYPE_BYTES = {"u8": 1, "u16": 2, "u32": 4}


def lonlat_to_merc(lon, lat):
    """Degrees -> web mercator metres."""
    lat = max(-85.05112878, min(85.05112878, lat))
    return math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R


def merc_to_lonlat(x, y):
    return math.degrees(x / R), math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)


def lonlat_to_tile(lon, lat, z):
    """The tile (x, y) holding a point at zoom z (y grows southwards, the slippy-map scheme)."""
    x, y = lonlat_to_merc(lon, lat)
    n = 1 << z
    return int((x + ORIGIN) / WORLD * n), int((ORIGIN - y) / WORLD * n)


def tile_bounds_merc(x, y, z):
    """A tile's mercator bounds (west, south, east, north) in metres."""
    s = WORLD / (1 << z)
    w, n = -ORIGIN + x * s, ORIGIN - y * s
    return w, n - s, w + s, n


def tile_bounds_lonlat(x, y, z):
    w, s, e, n = tile_bounds_merc(x, y, z)
    (lw, ls), (le, ln) = merc_to_lonlat(w, s), merc_to_lonlat(e, n)
    return lw, ls, le, ln


def tiles_in_bbox(w, s, e, n, z):
    """Every tile (x, y) at zoom z touching the lon/lat box."""
    x0, y0 = lonlat_to_tile(w, n, z)
    x1, y1 = lonlat_to_tile(e, s, z)
    return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]


def cell_zoom(n):
    """The zoom whose tiles are this channel's cells."""
    return TILE_Z + int(round(math.log2(n)))


def cell_size_m(n, lat):
    """A cell's ground size in metres at this latitude."""
    return WORLD / (1 << cell_zoom(n)) * math.cos(math.radians(lat))
