"""The native car map (CarPlay/ApexCarMap.swift, REVIEW_FEEL.md F-07) and the shell's threads (F-13). Swift compiles in CI
only (build.yml build-ipa); these hold its contract to the web car map it replaces: the same palettes, the same restyle,
the same message set, the web map as its fallback, and the motion pipeline and live-frame encoding off the main thread."""
import json
import os
import re
import shutil
import subprocess

import pytest
import yaml

NODE = shutil.which("node")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


PALETTE_KEYS = {"bg", "water", "waterLine", "land", "wood", "road", "roadMinor", "casing", "label", "halo", "boundary", "shadow",
                "highlight", "accentShade", "route", "plate", "plateInk", "accent"}

RUNNER = r"""
global.window = { localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
require(process.argv[1] + '/web/themes.js');
const C = require(process.argv[1] + '/web/carplay.js'), T = window.ApexThemes.THEMES;
console.log(JSON.stringify(Object.fromEntries(Object.keys(T).map((id) => [id, C.lookMessage(T[id], true, 'imperial')]))));
"""


@pytest.fixture(scope="module")
def looks():
    if NODE is None:
        pytest.skip("node not installed")
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_every_theme_sends_the_native_map_its_palettes(looks):
    assert set(looks) >= {"roadbook", "tapedeck", "billet"}
    for theme, msg in looks.items():
        for mode in ("day", "night"):
            p = msg["palette"][mode]
            assert PALETTE_KEYS <= set(p), (theme, mode, PALETTE_KEYS - set(p))
            assert all(re.fullmatch(r"#[0-9A-Fa-f]{6}", p[k]) for k in PALETTE_KEYS), (theme, mode)


def test_the_cold_start_palette_is_the_roadbooks(looks):
    """Before the page's first look message the native map paints the Roadbook; its copy must equal web/themes.js."""
    swift = read("CarPlay", "ApexCarMap.swift")
    block = swift[swift.index("static let roadbook"):]
    day_s, night_s = re.findall(r"ApexCarPalette\(\[(.*?)\]\)!", block, re.S)[:2]
    parse = lambda s: dict(re.findall(r'"(\w+)": "(#[0-9A-Fa-f]{6})"', s))
    rb = looks["roadbook"]["palette"]
    for got, want in ((parse(day_s), rb["day"]), (parse(night_s), rb["night"])):
        assert set(got) == PALETTE_KEYS
        assert all(got[k].upper() == want[k].upper() for k in PALETTE_KEYS), {k: (got[k], want[k]) for k in PALETTE_KEYS if got[k].upper() != want[k].upper()}


def test_the_swift_restyle_is_basemap_js():
    """basemap.js restyle and its Swift pass must pick the same layers for the same colours."""
    js, swift = read("web", "basemap.js"), read("CarPlay", "ApexCarMap.swift")
    for pattern in re.findall(r"/([a-z|]+)/\.test\(id\)", js):
        assert f'"{pattern}"' in swift, pattern
    for key in ("P.water", "P.wood", "P.land", "P.waterLine", "P.boundary", "P.casing", "P.roadMinor", "P.road", "P.label", "P.halo",
                "P.shadow", "P.highlight", "P.accentShade", "P.route"):
        assert key in swift, key
    assert "hillshadeExaggeration = NSExpression(forConstantValue: 0.36)" in swift and "hillshade-exaggeration', 0.36" in js
    assert "textHaloWidth = NSExpression(forConstantValue: 1.4)" in swift and "'text-halo-width', [1.4]" in js
    # the same sources as web/carmap.js: OpenFreeMap's style, the terrarium DEM to z13 as hillshade, no contours
    carmap = read("web", "carmap.js")
    for s in ("https://tiles.openfreemap.org/styles/liberty", "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"):
        assert s in swift and s in carmap
    assert ".maximumZoomLevel: 13" in swift and "maxzoom: 13" in carmap and ".demEncoding: MLNDEMEncoding.terrarium.rawValue" in swift
    assert "apex-contour" not in swift and "contour\"" not in swift, "no contour lines in the car (2026-10-30)"


def test_mapLibre_native_is_a_pinned_package():
    yml = yaml.safe_load(read("project.yml"))
    pkg = yml["packages"]["MapLibre"]
    assert pkg["url"] == "https://github.com/maplibre/maplibre-gl-native-distribution"
    assert re.fullmatch(r"\d+\.\d+\.\d+", str(pkg["exactVersion"])), "an exact release, never a branch"
    app = yml["targets"]["ApexNav"]
    assert {"package": "MapLibre", "product": "MapLibre"} in app["dependencies"]
    assert {"path": "CarPlay/ApexCarMap.swift"} in [{"path": s["path"]} for s in app["sources"]]


def test_one_message_set_two_maps_and_the_web_one_as_fallback():
    swift = read("CarPlay", "ApexCarPlay.swift")
    ctl = swift[swift.index("final class ApexCarMapViewController"):]
    # every message the web car map takes goes to the native one when it is up, else to the page
    for native, web in (("native.setPalette(", "car.look("), ("native.setRoute(", "car.route("), ("native.setCorners(", "car.corners("),
                        ("native.setHazards(", "car.hazards("), ("native.setSight(", "car.sight("), ("native.position(", "car.position("),
                        ("native.setMode(mode, inset:", "car.inset("), ("native.zoom(", "car.zoom("), ("native.pan(", "car.pan("),
                        ("native.recentre()", "car.recentre()")):
        assert native in ctl and web in ctl, (native, web)
    assert "Self.nativeFailed = true" in ctl and "self?.fallBackToWeb()" in ctl and "carmap.html" in ctl
    assert "if Self.nativeFailed { startWeb() } else { startNative() }" in ctl
    native = read("CarPlay", "ApexCarMap.swift")
    assert "func mapViewDidFailLoadingMap(" in native and "onFail?()" in native
    # dead reckoned on a display link, from the fix's speed and age (F-01)
    assert "CADisplayLink(target:" in native and "glide.push(lat: lat, lon: lon, course: course, mps: speed, t: now - age, now: now)" in native
    assert "speed: fixSpeedMps, at: fixAt" in read("ApexNavApp.swift")


def test_the_motion_pipeline_and_the_live_frame_are_off_the_main_thread():
    """F-13: 100 Hz CoreMotion went to the main queue; the live frame's JSON was string-built there ten times a second."""
    swift = read("ApexNavApp.swift")
    assert "startDeviceMotionUpdates(to: .main)" not in swift
    assert "startDeviceMotionUpdates(to: motion.queue, withHandler: MotionLane.handler(motion)" in swift
    assert "q.maxConcurrentOperationCount = 1" in swift, "samples in order"
    push = swift[swift.index("private func pushLiveFrame()"):swift.index("private static let liveQueue")]
    assert "Self.liveQueue.async" in push and "JSONEncoder().encode(frame)" in push
    assert push.index("Self.liveQueue.async") < push.index("DispatchQueue.main.async") < push.index("wv.evaluateJavaScript")
    assert '+ "\\"' not in push, "no string-built JSON"
    # the page reads the same keys as before
    for key in ("lat", "lon", "accuracy_m", "speed_mps", "course_deg", "elevation_m", "grade_pct", "lat_g", "lon_g", "camber_deg",
                "crest_vertical_g", "roughness_rms", "vert_peak_g", "impact_g", "recording", "calibration", "thermal", "low_power_mode",
                "battery", "charging", "has_fix", "segments", "at", "seq"):
        assert re.search(rf'(\b{key}\b(,|\s*$)|= "{key}")', swift[swift.index("enum CodingKeys"):swift.index("static func r(")], re.M), key
