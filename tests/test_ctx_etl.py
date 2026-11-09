"""The context-grid ETL (tools/ctx_etl): its pure transforms, the bundle format, and the committed Cincinnati bundles.

The downloads themselves (sources.py) need the network and GDAL; they run in .github/workflows/context-grid.yml. Here:
the palette, flood classes, reductions, quantising, densities, line encoding and the file format, which decide every
number the phone reads.
"""
import json
import math
import os
import re

import numpy as np
import pytest

from tools.ctx_etl import build, grid, transforms, vcg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CTX = os.path.join(ROOT, "web", "data", "ctx", "v1")


def test_noise_palette_decodes_exact_legend_colours():
    t = np.zeros((2, 4, 4), dtype=np.uint8)
    t[0, 0] = (255, 193, 7, 255)      # 45.0 - 49.9
    t[0, 1] = (82, 0, 204, 255)       # 80.0 - 89.9
    t[0, 2] = (0, 0, 255, 255)        # > 90
    t[0, 3] = (0, 0, 0, 0)            # transparent: below the 45 dB floor
    t[1, 0] = (12, 34, 56, 255)       # not a legend colour: unknown, never a guess
    t[1, 1] = (255, 51, 153, 255)     # 60.0 - 69.9
    d = transforms.decode_noise(t)
    assert d[0].tolist() == [45, 80, 90, 40]
    assert math.isnan(d[1, 0]) and d[1, 1] == 60


@pytest.mark.parametrize("zone,sub,want", [
    ("AE", "FLOODWAY", 3), ("AE", None, 2), ("A", "", 2), ("AO", None, 2), ("VE", None, 4),
    ("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", 1), ("X", "AREA OF MINIMAL FLOOD HAZARD", 0), ("D", None, None),
    ("AREA NOT INCLUDED", None, None), (None, None, None)])
def test_flood_classes(zone, sub, want):
    assert transforms.flood_class(zone, sub) == want


def test_block_reduce_ignores_unknown_pixels():
    a = np.array([[1, 3, np.nan, np.nan], [5, np.nan, np.nan, np.nan], [2, 2, 7, 7], [2, 9, 7, 1]], dtype=float)
    m = transforms.block_reduce(a, 2, "mean")
    assert m[0, 0] == 3 and math.isnan(m[0, 1]) and m[1, 0] == pytest.approx(15 / 4) and m[1, 1] == pytest.approx(22 / 4)
    assert transforms.block_reduce(a, 2, "max")[1].tolist() == [9, 7]
    assert transforms.block_reduce(a, 2, "mode")[1].tolist() == [2, 7]


def test_quantise_round_trips_and_keeps_unknown_unknown():
    v = np.array([0.0, 12.3, 99.9, np.nan, 1e9, -5])
    raw = transforms.quantise(v, 0.25, 0.0, 65535, "u16")
    assert raw.dtype == np.uint16 and raw[3] == 65535 and raw[4] == 65534 and raw[5] == 0
    back = transforms.dequantise(raw, 0.25, 0.0, 65535)
    assert back[1] == pytest.approx(12.25) and math.isnan(back[3])
    # an exact zero stays a measured zero, not unknown
    assert transforms.dequantise(transforms.quantise(np.array([0.0]), 1, 0, 255, "u8"), 1, 0, 255)[0] == 0


def test_count_density_is_per_km2_and_smoothed():
    px, py = np.array([1, 1, 1, 5]), np.array([1, 1, 1, 0])
    d = transforms.count_density(px, py, (3, 6), np.full(3, 0.25), smooth=0)
    assert d[1, 1] == 12 and d[0, 5] == 4 and d.sum() == 16
    s = transforms.count_density(px, py, (3, 6), np.full(3, 0.25), smooth=1)
    assert s[1, 1] == pytest.approx(12 / 9) and s[0, 0] == pytest.approx(12 / 9) and s[2, 3] == 0


def test_bundle_units_span_the_z8_tile():
    w, s, e, n = grid.tile_bounds_lonlat(67, 97, 8)
    assert transforms.to_bundle_units(w, n, 67, 97) == pytest.approx((0, 0), abs=1e-6)
    assert transforms.to_bundle_units(e, s, 67, 97) == pytest.approx((65535, 65535), abs=1e-3)
    assert grid.lonlat_to_tile(-84.51, 39.10, 8) == (67, 97)
    assert grid.lonlat_to_tile(-84.51, 39.10, 12) == (1086, 1563)
    assert 230 < grid.cell_size_m(32, 39.1) < 240 and 115 < grid.cell_size_m(64, 39.1) < 120


def test_line_deltas_round_trip():
    counts = [3, 2]
    xy = [(100, 200), (110, 190), (65535, 0), (0, 65535), (5, 65530)]
    x0, y0, dx, dy = transforms.delta_lines(counts, xy)
    assert x0.tolist() == [100, 0] and y0.tolist() == [200, 65535] and dx.max() <= 2 * 65535
    assert transforms.undelta_lines(counts, x0, y0, dx, dy).tolist() == [list(p) for p in xy]
    assert transforms.zigzag([0, -1, 1, -2]).tolist() == [0, 1, 2, 3] and transforms.unzigzag([0, 1, 2, 3]).tolist() == [0, -1, 1, -2]


def test_densities_are_log_scaled():
    v = np.array([0.0, 1.0, 140.8, 20000.0, 1e6, np.nan])
    raw = transforms.quantise(v, grid.LOG_SCALE, grid.LOG, 255, "u8")
    assert raw.tolist() == [0, 18, 127, 254, 254, 255]
    back = transforms.dequantise(raw, grid.LOG_SCALE, grid.LOG, 255)
    assert back[0] == 0 and back[3] == pytest.approx(20000) and math.isnan(back[5])
    assert all(abs(b / x - 1) < 0.05 for b, x in zip(back[1:4], v[1:4])), "about 4% steps"


def test_simplify_and_clip_lines():
    line = [(0, 0), (10, 0.3), (20, 0), (30, 10)]
    assert transforms.simplify(line, 1.0) == [(0, 0), (20, 0), (30, 10)]
    runs = transforms.clip_segment_to_box([(-50, 0), (-10, 0), (10, 0), (50, 0), (90, 0), (150, 0)], (0, -1, 100, 1))
    assert runs == [[(-10, 0), (10, 0), (50, 0), (90, 0), (150, 0)]]


def test_hpms_rows_with_one_geometry_merge_their_items():
    rows = [(("R1", 0, 1, 0), {"aadt": None, "iri": 120, "fclass": 3}, [(0, 0), (1, 1)]),
            (("R1", 0, 1, 0), {"aadt": 15000, "iri": None, "fclass": 3}, [(0, 0), (1, 1)]),
            (("R2", 0, 2, 0), {"aadt": 300, "iri": None, "fclass": 7}, [(0, 0), (2, 2)])]
    m = transforms.merge_hpms(rows)
    assert len(m) == 2 and m[0][1] == {"aadt": 15000, "iri": 120, "fclass": 3}


def test_an_hpms_limit_that_is_no_limit_is_unknown():
    """A state's "not reported" code (999, 0, 254) is nodata, never a 254 mph limit; real limits are kept as they are."""
    from tools.ctx_etl import build
    assert [build.limit_or(v) for v in (25, "55", 85.0, 5)] == [25, 55, 85, 5]
    assert [build.limit_or(v) for v in (999, 254, 99, 0, 3, -1, None, "", float("nan"), "n/a")] == [255] * 10


def test_acs_jam_values_are_unknown():
    assert transforms.acs_value("1962") == 1962 and math.isnan(transforms.acs_value("-666666666")) and math.isnan(transforms.acs_value(""))


def test_vcg_round_trip():
    w = vcg.Writer({"v": 1, "x": 67, "y": 97, "channels": {}})
    raw = transforms.quantise(np.array([[1.0, np.nan], [3.0, 4.0]]), 1.0, 0.0, 255, "u8").ravel()
    w.header["channels"]["canopy_pct"] = {"n": 2, "scale": 1.0, "offset": 0.0, "nodata": 255, "tiles": [[3, 4]],
                                          "array": w.add("ch_canopy_pct", raw, "u8")}
    w.add("line_aadt", [7, 0xFFFFFFFF], "u32")
    data = w.tobytes()
    assert data[:2] == b"\x1f\x8b" and data == w.tobytes(), "gzipped, and the same input gives the same bytes"
    h, a = vcg.read(data)
    t = vcg.channel_tile(h, a, "canopy_pct", 3, 4)
    assert t[0, 0] == 1 and math.isnan(t[0, 1]) and t[1, 1] == 4
    assert vcg.channel_tile(h, a, "canopy_pct", 0, 0) is None and a["line_aadt"].tolist() == [7, 0xFFFFFFFF]


def test_js_mirrors_the_channel_specs():
    js = open(os.path.join(ROOT, "web", "route_ctx", "context_grid.js")).read()
    for name, spec in grid.CHANNELS.items():
        m = re.search(name + r": \[(\d+), '(\w+)'\]", js)
        assert m, f"{name} missing from context_grid.js RASTERS"
        assert int(m.group(1)) == spec[0], f"{name}: cells per tile differ"
    for name in build.RASTERS:
        assert name in grid.CHANNELS


# ------------------------------------------------------------------------------------------------ the committed bundles
def index():
    with open(os.path.join(CTX, "index.json")) as f:
        return json.load(f)


def test_committed_bundles_are_listed_and_small():
    ix = index()
    assert ix["v"] == 1 and ix["region"] == "cincinnati" and ix["bundles"]
    total = 0
    for key, meta in ix["bundles"].items():
        p = os.path.join(CTX, "8", key + ".vcg")
        assert os.path.getsize(p) == meta["bytes"]
        total += meta["bytes"]
    assert total == ix["bytes"] and total < 15e6, "the committed grid stays small (it ships inside the app)"


def test_committed_bundles_carry_their_sources_and_specs():
    for key in index()["bundles"]:
        with open(os.path.join(CTX, "8", key + ".vcg"), "rb") as f:
            h, a = vcg.read(f.read())
        assert (h["x"], h["y"]) == tuple(int(v) for v in key.split("/"))
        for name, ch in h["channels"].items():
            spec = grid.CHANNELS[name]
            assert (ch["n"], ch["scale"], ch["nodata"]) == (spec[0], spec[2], spec[4])
            assert a[ch["array"]].size == len(ch["tiles"]) * ch["n"] ** 2
            assert ch["source"] in h["sources"] and h["sources"][ch["source"]]["licence"]
        if "lines" in h:
            L = h["lines"]
            n = a[L["n"]]
            assert len(n) == L["count"] and n.min() >= 2 and a[L["dx"]].size == n.sum() - L["count"]
            xy = transforms.undelta_lines(n, a[L["x0"]], a[L["y0"]], a[L["dx"]], a[L["dy"]])
            assert xy.min() >= 0 and xy.max() <= 65535
            assert all(a[A["array"]].size == L["count"] for A in L["attrs"].values())
        if "points" in h:
            assert h["points"]["years"] == [build.FARS_YEARS[0], build.FARS_YEARS[-1]]
