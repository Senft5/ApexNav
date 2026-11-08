"""The context-grid ETL's two account-backed sources (tools/ctx_etl, 2026-11-08): NASA Black Marble VNP46A4 night lights
(EARTHDATA_TOKEN) and FCC mobile coverage (FCC_USERNAME + FCC_API_TOKEN).

Every input here is a SYNTHETIC TEST FIXTURE (made-up radiance tiles, a hand-written FCC listing, invented polygons), never
real measured data: the real downloads need the owner's accounts and run in .github/workflows/context-grid.yml. The pure
parts need numpy only; the HDF5 read and the rasterising parts skip without h5py / rasterio (CI's core tests have neither).
"""
import json
import math
import os

import numpy as np
import pytest

from tools.ctx_etl import grid, sources, transforms

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FCC_LISTING = os.path.join(ROOT, "tests", "fixtures", "ctx_etl", "fcc_listing_synthetic.json")


# ------------------------------------------------------------------------------------------------------- Black Marble
def test_black_marble_tiles_cover_the_region():
    assert transforms.bm_tiles_for_box(-84.90, 38.70, -83.95, 39.33) == [(9, 5)]           # Cincinnati
    assert transforms.bm_tiles_for_box(-89.6, 36.5, -80.5, 42.3) == [(9, 4), (9, 5)]       # OH, KY, IN
    assert transforms.bm_tile_origin(9, 5) == (-90.0, 40.0, 10 / 2400)
    names = ["VNP46A4.A2025001.h09v05.002.2026100000000.h5", "VNP46A4.A2025001.h09v05.002.2026200000000.h5",
             "VNP46A4.A2025001.h19v05.002.2026100000000.h5", "VNP46A4.A2025001.h09v05.002.2026300000000.txt"]
    assert transforms.bm_file_for(names, 9, 5) == names[1] and transforms.bm_file_for(names, 10, 5) is None


def test_vnp46_fill_and_poor_quality_are_unknown():
    dn = np.array([[0, 5, 200, 65535], [30, 30, 30, 30]], dtype=np.uint16)
    q = np.array([[0, 0, 1, 255], [0, 1, 2, 255]], dtype=np.uint8)
    r = transforms.vnp46_radiance(dn, q, fill=65535, scale=0.1, offset=0.0)
    assert r[0, :3].tolist() == pytest.approx([0.0, 0.5, 20.0]) and math.isnan(r[0, 3])
    assert r[1, :2].tolist() == pytest.approx([3.0, 3.0]) and math.isnan(r[1, 2]) and math.isnan(r[1, 3])   # gap-filled: unknown
    assert transforms.vnp46_radiance(dn)[1, 2] == pytest.approx(3.0)                                       # no quality layer


def test_radiance_maps_to_the_2016_scale():
    r = np.array([0.0, 0.3, 1.0, 3.0, 10.0, 20.0, 400.0, np.nan, -0.5])
    v = transforms.night_from_radiance(r)
    assert v[0] == 0 and v[8] == 0 and math.isnan(v[7])
    assert v[1] < 0.15 and v[2] < 0.15                    # forest and farmland stay "dark" for route_engine.js
    assert 0.15 < v[3] < 0.4 and 0.5 < v[4] < 0.75        # a village lit, a town brighter
    assert v[5] == 1 and v[6] == 1                        # suburbs and city cores saturate, as the 2016 image did
    assert np.all(np.diff(v[:7]) >= 0)
    raw = transforms.quantise(v, 1 / 254, 0.0, 255, "u8")  # the channel's own spec round-trips within a step
    spec = grid.CHANNELS["night_lights"]
    back = transforms.dequantise(raw, spec[2], spec[3], spec[4])
    assert np.nanmax(np.abs(back - v)) <= 0.5 / 254 + 1e-9 and math.isnan(back[7])


def test_hdf5_tile_reads_radiance_and_quality(tmp_path):
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "VNP46A4.A2099001.h09v05.002.SYNTHETIC.h5"     # a made-up 4 x 4 tile, not NASA data
    with h5py.File(p, "w") as f:
        g = f.create_group(transforms.BM_FIELDS.rstrip("/"))
        d = g.create_dataset(transforms.BM_LAYER, data=np.array([[10, 200, 65535, 0]] * 4, dtype=np.uint16))
        d.attrs["_FillValue"] = np.array([65535], dtype=np.uint16)
        d.attrs["scale_factor"] = np.array([0.1])
        d.attrs["add_offset"] = np.array([0.0])
        g.create_dataset(transforms.BM_LAYER + "_Quality", data=np.array([[0, 1, 255, 2]] * 4, dtype=np.uint8))
    r = sources.read_vnp46a4(str(p))
    assert r.shape == (4, 4) and r[0, 0] == pytest.approx(1.0) and r[0, 1] == pytest.approx(20.0)
    assert math.isnan(r[0, 2]) and math.isnan(r[0, 3])


def test_night_lights_use_vnp46a4_with_a_token_and_2016_without(monkeypatch):
    pytest.importorskip("rasterio")
    win = sources.Window(67, 97, 0, 0, 3, 3, 16)                  # a 4 x 4-tile chunk of the Cincinnati bundle 8/67/97
    tile = np.full((2400, 2400), 5.0)                              # synthetic: 5 nW everywhere on h09v05 ...
    x0, y0, px = transforms.bm_tile_origin(9, 5)
    w, s, e, n = win.lonlat_box()
    tile[:, int((((w + e) / 2) - x0) / px):] = np.nan              # ... except the window's east half: no good pixel
    asked = []
    monkeypatch.setattr(sources, "bm_tile", lambda ctx, h, v: asked.append((h, v)) or (tile if (h, v) == (9, 5) else None))
    monkeypatch.setattr(sources, "night_lights_2016", lambda ctx, win: np.full((win.height, win.width), 0.4))
    for k in sources.NIGHT_CHECK:
        monkeypatch.setitem(sources.NIGHT_CHECK, k, 0)
    monkeypatch.setitem(sources.NIGHT_MODE, "viirs", None)
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
    assert sources.night_lights(None, win).max() == pytest.approx(0.4)          # no token: the 2016 path, as before
    monkeypatch.setenv("EARTHDATA_TOKEN", "test-not-a-token")
    out = sources.night_lights(None, win)
    assert asked == [(9, 5)] and out.shape == (64, 64)
    west, east = out[:, :28], out[:, 36:]
    assert np.allclose(west, transforms.night_from_radiance(5.0)) and np.isnan(east).all()   # unknown stays unknown
    assert sources.NIGHT_CHECK["n"] > 0 and "night lights vs 2016" in sources.night_check_summary()


def test_a_refused_token_falls_back_to_the_2016_image_for_the_whole_run(monkeypatch):
    class Log(list):
        def log(self, m):
            self.append(m)
    ctx = Log()
    monkeypatch.setitem(sources.NIGHT_MODE, "viirs", None)
    monkeypatch.setenv("EARTHDATA_TOKEN", "test-expired")

    def refused(ctx, h, v):
        raise RuntimeError("VNP46A4.A2025001.h09v05.h5: not an HDF5 file (download refused?)")
    monkeypatch.setattr(sources, "bm_tile", refused)
    monkeypatch.setattr(sources, "night_lights_2016", lambda ctx, win: "2016")
    monkeypatch.setattr(sources, "night_lights_viirs", lambda ctx, win: "viirs")
    assert sources.night_prepare(ctx, (-84.9, 38.7, -83.95, 39.33)) is False
    assert sources.night_lights(ctx, None) == "2016" and "EARTHDATA_TOKEN expired" in ctx[0] and "test-expired" not in ctx[0]
    monkeypatch.setattr(sources, "bm_tile", lambda ctx, h, v: np.zeros((1, 1)))
    assert sources.night_prepare(ctx, (-84.9, 38.7, -83.95, 39.33)) is True and sources.night_lights(ctx, None) == "viirs"
    monkeypatch.delenv("EARTHDATA_TOKEN")
    assert sources.night_prepare(ctx, (-84.9, 38.7, -83.95, 39.33)) is False   # no token: never asks LAADS


# ------------------------------------------------------------------------------------------------------------------ FCC
def test_fcc_listing_picks_4g_5g_mobile_gis_files_one_environment_per_state():
    data = json.load(open(FCC_LISTING))["data"]
    oh, env = transforms.fcc_pick_files(data, "39")
    assert env == "in-vehicle"
    assert {pid: [f["file_id"] for f in p["files"]] for pid, p in oh.items()} == {"900001": [101, 103], "900002": [201]}
    # outdoor twin (102), CSV twin (104), 3G (202), voice (301) and fixed (401) are not counted
    ky, env_ky = transforms.fcc_pick_files(data, 21)
    assert env_ky == "outdoor" and list(ky) == ["900005"]                # KY lists no in-vehicle file: outdoor for all
    assert transforms.fcc_pick_files(data, "18") == ({}, None)          # nothing listed for IN
    assert transforms.fcc_tech({"technology_code": "300", "technology_code_desc": "3G"}) is None
    assert transforms.fcc_tech({"file_name": "x_5G-NR_y"}) == "5G" and transforms.fcc_env({"file_name": "a_In-Vehicle_b"}) == "in-vehicle"


def test_latest_as_of_date():
    ans = {"data": [{"data_type": "availability", "as_of_date": "2024-06-30T00:00:00"}, {"data_type": "challenge", "as_of_date": "2025-12-31"},
                    {"data_type": "availability", "as_of_date": "2025-06-30"}]}
    assert transforms.latest_as_of(ans) == "2025-06-30" and transforms.latest_as_of({"data": []}) is None


def test_provider_count_is_unknown_outside_the_states_read_and_never_guessed():
    known = np.array([[True, True, True, False]])
    a = np.array([[1.0, 0.0, 1.0, 1.0]])
    b = np.array([[1.0, 0.0, np.nan, 1.0]])            # provider b's file failed: where it reports nothing, unknown
    out = transforms.provider_count([a, b], known)
    assert out[0, 0] == 2 and out[0, 1] == 0 and math.isnan(out[0, 2]) and math.isnan(out[0, 3])
    assert transforms.provider_count([], known)[0, :3].tolist() == [0, 0, 0]


def test_credentials_only_from_the_environment(monkeypatch):
    for k in ("FCC_USERNAME", "FCC_API_TOKEN", "EARTHDATA_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    assert sources.fcc_creds() is None and sources.earthdata_token() is None
    monkeypatch.setenv("FCC_USERNAME", "owner@example.com")
    assert sources.fcc_creds() is None                                   # both or nothing: skipped exactly as before
    monkeypatch.setenv("FCC_API_TOKEN", "  t  ")
    assert sources.fcc_creds() == ("owner@example.com", "t")


def test_mobile_coverage_raster_counts_providers(monkeypatch):
    pytest.importorskip("rasterio")
    from shapely.geometry import box
    win = sources.Window(67, 97, 0, 0, 3, 3, 32)

    def rect(fx0, fx1):                       # a synthetic polygon spanning a share of the window's width, full height
        x0, x1 = win.west + fx0 * (win.east - win.west), win.west + fx1 * (win.east - win.west)
        ring = np.array([[x0, win.south], [x0, win.north], [x1, win.north], [x1, win.south], [x0, win.south]])
        return ([[ring]], (x0, win.south, x1, win.north), {})

    class Store:
        def __init__(self, items):
            self.items = items

        def get(self, bx, by):
            return self.items

    mc = sources.MobileCoverage.__new__(sources.MobileCoverage)
    mc.providers = {"a": {"name": "A", "stores": [Store([rect(0.0, 0.5)])]}, "b": {"name": "B", "stores": [Store([rect(0.25, 0.75)])]}}
    mc.failed = set()
    mc.known = [box(win.west, win.south, win.west + 0.875 * (win.east - win.west), win.north)]   # the state ends at 7/8
    out = mc.raster(win)
    assert out.shape == (128, 128)
    row = out[64]
    assert row[10] == 1 and row[50] == 2 and row[80] == 1 and row[100] == 0 and np.isnan(row[120])
