"""The native car map (CarPlay/ApexCarMap.swift, REVIEW_FEEL.md F-07) and the shell's threads (F-13). Swift compiles in CI
only (build.yml build-ipa); these hold its contract to the web car map it replaces: the same palettes, the same restyle,
the same message set, the web map as its fallback, and the motion pipeline and live-frame encoding off the main thread."""
import json
import os
import re
import shutil
import subprocess

import pytest

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
    # plain text (CI's test job has no PyYAML): the package block, the target's dependency and the source line
    yml = read("project.yml")
    pkg = re.search(r"\n  MapLibre:\n((?:    .*\n)+)", yml)
    assert pkg, "MapLibre under packages"
    assert "url: https://github.com/maplibre/maplibre-gl-native-distribution" in pkg.group(1)
    assert re.search(r"exactVersion: \"?\d+\.\d+\.\d+\"?\n", pkg.group(1)), "an exact release, never a branch"
    assert re.search(r"- package: MapLibre\n\s+product: MapLibre", yml)
    assert re.search(r"- path: CarPlay/ApexCarMap\.swift", yml)


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


def test_hillshade_colours_are_arrays_as_maplibre_native_6_wants():
    # 2026-10-31: a bare UIColor for hillshadeShadowColor threw doesNotRecognizeSelector on every style load (the crash
    # on open, phone and CarPlay); MapLibre Native 6.x takes the shadow and highlight as arrays of colours
    swift = read("CarPlay", "ApexCarMap.swift")
    assert "hillshadeShadowColor = NSExpression(forConstantValue: [P.shadow])" in swift
    assert "hillshadeHighlightColor = NSExpression(forConstantValue: [P.highlight])" in swift
    assert "hillshadeShadowColor = k(" not in swift and "hillshadeHighlightColor = k(" not in swift


def test_the_sight_plate_is_not_a_limit_sign():
    """U-119 quietened OPEN to the eye alone; panel round 2 (TH-2, IN-3) goes further. The plate under the car was a white box
    with "20 MPH" where Apple Maps draws the limit. Both car maps now draw the eye, SIGHT and the number with no unit on the
    dark plate with rounded ends; faster than it, the signal red with the eye barred and SLOW (two channels); OPEN nothing."""
    js, html, swift = read("web", "carmap.js"), read("web", "carmap.html"), read("CarPlay", "ApexCarMap.swift")
    draw = js[js.index("function sightPlate("):js.index("function addLayers()")]
    assert "(s.text === 'OPEN' && !s.short)) return null;" in draw and "label: s.short ? 'SLOW' : 'SIGHT'" in draw
    assert "if (!t || !state.pos) { el.hidden = true; return; }" in draw, "OPEN and unknown draw nothing"
    assert "t.short ? EYE_BARRED : EYE" in draw and "unit" not in draw, "no unit, the eye barred when short"
    css = html[html.index(".car-sight {"):html.index(".car-sight[hidden]")]
    assert "background: #111111" in css and "border-radius: 999px" in css and "#FFFFFF" not in css.split(".car-sight.short")[0], "a dark pill, never white"
    assert ".car-sight.open" not in html
    view = swift[swift.index("final class ApexCarSightView"):]
    assert 'systemName: s.short ? "eye.slash" : "eye"' in view and 's.short ? "SLOW " : "SIGHT "' in view
    assert "UIColor(white: 0.067, alpha: 1)" in view and "label.layer.cornerRadius = bounds.height / 2" in view
    assert "s.unit" not in view and "palette.plate" not in view.split("func set(")[1], "no unit, and never the theme's paper plate"
    assert 'var drawn: Bool { !(text == "OPEN" && !short) }' in swift and "s.flatMap { $0.drawn ? $0 : nil }" in swift


def test_the_cluster_never_draws_the_sight_plate():
    """TH-2: the cluster sits in front of the driver beside the car's own speedometer; the plate is never drawn there."""
    shell = read("CarPlay", "ApexCarPlay.swift")
    show = shell[shell.index("@MainActor func showSight()"):]
    show = show[:show.index("\n    }\n")]
    assert "let sight = role == .cluster ? nil : ApexCar.shared.sight" in show and "native.setSight(sight)" in show
    assert 'role == .cluster ? "null" : ApexCar.shared.sightJSON' in show


def test_plates_stay_clear_of_the_card():
    """U-136 (REVIEW5 guided-drive car/020): an R3 plate against the guidance card's edge. The card covers 300 of the window's
    710 points on the review simulator; the reserved column was 36 % (256). Both maps keep plates CARD_GAP (>= 12) past it."""
    shell = read("CarPlay", "ApexCarPlay.swift")
    assert "static let cardShare: CGFloat = 0.43" in shell and "view.bounds.width * 0.36" not in shell
    assert "return max(w * Self.cardShare, min(view.safeAreaInsets.left, w * 0.6))" in shell
    assert "Int(cardWidth().rounded(.up))" in shell
    assert 0.43 * 710 >= 300, "the measured card fits inside the share"
    native, js = read("CarPlay", "ApexCarMap.swift"), read("web", "carmap.js")
    gap_s = float(re.search(r"cardGap: CGFloat = (\d+)", native).group(1))
    gap_j = float(re.search(r"const CARD_GAP = (\d+)", js).group(1))
    assert gap_s >= 12 and gap_j >= 12
    assert "width: 1e4 + inset + Self.cardGap" in native and "state.inset + CARD_GAP" in js
