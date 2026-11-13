"""The map under the drive page's route picture (web/drive_basemap.js, TestFlight 15 "need to see map under path").

The path is planned in Mercator metres, so the MapLibre camera viewFor() gives puts every point of the drive exactly
under its SVG point; the map is asked for only with a connection or a saved area under the drive, never as a broken map.
"""
import json
import os
import pathlib
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

RUNNER = r"""
const B = require(process.argv[1] + '/web/drive_basemap.js');
// MapLibre's own Web Mercator: world size 512 * 2^zoom pixels
const screen = (lon, lat, cam) => {
  const ws = 512 * 2 ** cam.zoom, m = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  return [(lon + 180) / 360 * ws, (1 - m / Math.PI) / 2 * ws];
};
function worst(lat, lon, pxPerM) {
  const p = B.project(lat, lon);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < lat.length; i++) { x0 = Math.min(x0, p.x[i]); x1 = Math.max(x1, p.x[i]); y0 = Math.min(y0, p.y[i]); y1 = Math.max(y1, p.y[i]); }
  const xc = (x0 + x1) / 2, yc = (y0 + y1) / 2, cam = B.viewFor(p.frame, xc, yc, pxPerM), c = screen(cam.center[0], cam.center[1], cam);
  let err = 0;
  for (let i = 0; i < lat.length; i++) {
    const s = screen(lon[i], lat[i], cam);                          // where MapLibre draws the point, from the centre
    const svg = [(p.x[i] - xc) * pxPerM, -(p.y[i] - yc) * pxPerM];   // where the SVG draws it, from the centre
    err = Math.max(err, Math.hypot(s[0] - c[0] - svg[0], s[1] - c[1] - svg[1]));
  }
  return { err, zoom: cam.zoom, center: cam.center };
}
// the picture's transform (overlay) at a zoomed, panned camera puts every point where MapLibre draws it
function follow(lat, lon) {
  const p = B.project(lat, lon), MW = 360, MH = 300, ms = 0.05, w = 720;            // 2 screen px per viewBox unit
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < lat.length; i++) { x0 = Math.min(x0, p.x[i]); x1 = Math.max(x1, p.x[i]); y0 = Math.min(y0, p.y[i]); y1 = Math.max(y1, p.y[i]); }
  const xc = (x0 + x1) / 2, yc = (y0 + y1) / 2, fit = B.viewFor(p.frame, xc, yc, ms * w / MW);
  const cam = { center: B.unproject(p.frame, xc + 400, yc - 250), zoom: fit.zoom + 2.3 }, T = B.overlay(p.frame, xc, yc, ms, MW, MH, fit.zoom, cam);
  const c = screen(cam.center[0], cam.center[1], cam), u = w / MW;
  let err = 0;
  for (let i = 0; i < lat.length; i += 7) {
    const sv = [MW / 2 + (p.x[i] - xc) * ms, MH / 2 - (p.y[i] - yc) * ms], s = screen(lon[i], lat[i], cam);
    const mapPx = [s[0] - c[0] + w / 2, s[1] - c[1] + MH * u / 2], svgPx = [(T.s * sv[0] + T.tx) * u, (T.s * sv[1] + T.ty) * u];
    err = Math.max(err, Math.hypot(mapPx[0] - svgPx[0], mapPx[1] - svgPx[1]));
  }
  const id = B.overlay(p.frame, xc, yc, ms, MW, MH, fit.zoom, fit), none = B.overlay(p.frame, xc, yc, ms, MW, MH, fit.zoom, null);
  const back = B.planOf(p.frame, ...B.unproject(p.frame, 123.4, -567.8));
  return { err, s: T.s, id, none, back };
}
function lim(lat, lon) {
  const fit = { center: [-83.9, 35.6], zoom: 13.4 }, L = B.limits(fit, 360, 240), cam = { zoom: L.minZoom };
  // at the lowest zoom the whole view still fits inside the pan box: the limit is the zoom, not the box
  const ws = 512 * 2 ** L.minZoom, sw = screen(L.maxBounds[0][0], L.maxBounds[0][1], cam), ne = screen(L.maxBounds[1][0], L.maxBounds[1][1], cam);
  return { L, fitZoom: fit.zoom, wide: ne[0] - sw[0], tall: sw[1] - ne[1], ws };
}
const loop = (lat0, lon0, km) => { const lat = [], lon = [];
  for (let i = 0; i <= 400; i++) { const a = i / 400 * 2 * Math.PI; lat.push(lat0 + Math.sin(a) * km / 111 + i * 1e-5); lon.push(lon0 + Math.cos(a) * km / 70); }
  return [lat, lon]; };
// an L-shaped saved route (north, then east) and its area as offline_tiles.js keeps it, line thinned to 100 m
function corridor() {
  const O = require(process.argv[1] + '/web/offline_tiles.js'), rl = [], ro = [];
  for (let i = 0; i <= 200; i++) { rl.push(35.6 + 0.2 * i / 200); ro.push(-83.9 + 0.0005 * Math.sin(i / 3)); }   // a little wiggle
  for (let i = 1; i <= 200; i++) { rl.push(35.8); ro.push(-83.9 + 0.2 * i / 200); }
  const line = O.lineOf(rl, ro, 0.1), a = { lat: 35.7, lon: -83.8, radiusKm: null, alongKm: 1.5, box: O.boxOf(rl, ro), line, lineTolKm: 0.1 };
  const pts = (f) => { const lat = [], lon = []; for (let i = 0; i <= 300; i++) { const [p, q] = f(i / 300); lat.push(p); lon.push(q); } return { lat, lon }; };
  const along = pts((t) => (t < 0.5 ? [35.6 + 0.4 * t, -83.896] : [35.803, -83.9 + 0.4 * (t - 0.5)]));   // 300-400 m off the line
  const across = pts((t) => [35.6 + 0.2 * t, -83.9 + 0.2 * t]);                                        // the diagonal: inside the box
  const box = (q) => [Math.min(...q.lat), Math.min(...q.lon), Math.max(...q.lat), Math.max(...q.lon)];
  return { n: rl.length, kept: line.length, along: B.covered([a], box(along), along), across: B.covered([a], box(across), across),
    acrossNoPts: B.covered([a], box(across)), acrossOld: B.covered([{ ...a, line: undefined }], box(across), across),
    offline: B.worthTrying(false, [a], box(across), across), short: O.lineOf([1], [2]) };
}
const [la, lo] = loop(35.6, -83.9, 3), [nla, nlo] = loop(69.6, 18.9, 40);
const areas = [{ lat: 35.6, lon: -83.9, radiusKm: 25 }];
console.log(JSON.stringify({
  tn: worst(la, lo, 0.1), north: worst(nla, nlo, 0.004),
  inArea: B.covered(areas, [35.55, -83.95, 35.65, -83.85]), edge: B.covered(areas, [35.55, -83.95, 35.65, -83.5]),
  bad: B.covered([{ lat: null, lon: 1, radiusKm: 5 }], [0, 0, 0.01, 0.01]),
  route: [B.covered([{ lat: 35.7, lon: -83.9, radiusKm: null, alongKm: 1.5, box: [35.6, -83.91, 35.8, -83.89] }], [35.62, -83.905, 35.78, -83.895]),
          B.covered([{ lat: 35.7, lon: -83.9, radiusKm: null, alongKm: 1.5, box: [35.6, -83.91, 35.8, -83.89] }], [35.62, -83.95, 35.78, -83.895]),
          B.covered([{ lat: 35.7, lon: -83.9, radiusKm: null, alongKm: 1.5, box: [35.6, -83.91, 35.8, null] }], [35.62, -83.905, 35.78, -83.895])],
  corridor: corridor(),
  tryOnline: B.worthTrying(true, [], [0, 0, 1, 1]), tryOffNone: B.worthTrying(false, [], [35.55, -83.95, 35.65, -83.85]),
  tryOffSaved: B.worthTrying(false, areas, [35.55, -83.95, 35.65, -83.85]), tryUnknown: B.worthTrying(undefined, [], [0, 0, 1, 1]),
  follow: follow(la, lo), lim: lim(la, lo),
}));
"""


@pytest.fixture(scope="module")
def r():
    p = subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_the_map_lies_exactly_under_the_path(r):
    assert r["tn"]["err"] < 0.01, r["tn"]                       # under a hundredth of a pixel anywhere on a 6 km loop
    assert r["north"]["err"] < 0.05, r["north"]                 # and on an 80 km loop inside the Arctic circle
    assert 12 < r["tn"]["zoom"] < 15, r["tn"]["zoom"]           # 0.1 px a metre at 35.6 N is about zoom 13.3


def test_asked_for_only_where_it_can_draw(r):
    assert r["inArea"] is True and r["edge"] is False and r["bad"] is False
    assert r["route"] == [True, False, False], "a saved route's map: a drive inside its corridor's box, not one that leaves it"
    assert r["tryOnline"] is True and r["tryUnknown"] is True
    assert r["tryOffNone"] is False, "no signal and no saved area: the blank panel, never a broken map"
    assert r["tryOffSaved"] is True, "no signal but a saved area under the drive: the map from the phone"


def test_the_page_loads_it_lazily_and_inside_the_policy():
    an = (WEB / "analysis.html").read_text(encoding="utf-8") + (WEB / "analysis_page.js").read_text(encoding="utf-8")
    src = (WEB / "drive_basemap.js").read_text(encoding="utf-8")
    # MapLibre is not in the Log's head: it loads when the picture scrolls into view (REVIEW_FEEL: the Log stays fast)
    assert 'src="vendor/maplibre-gl.js"' not in an and 'href="vendor/maplibre-gl.css"' not in an
    assert '<script src="drive_basemap.js"></script>' in an and an.index("drive_basemap.js") < an.index('src="drive_view.js"')
    assert "IntersectionObserver" in src and "'vendor/maplibre-gl.js'" in src
    assert "transformRequest: O ? O.transform" in src, "through the offline areas"
    # the owner, 2026-11-03: zoom in and out "but not all the way out": two fingers (one finger scrolls the page)
    assert "interactive: true, cooperativeGestures: true, dragRotate: false" in src
    assert "minZoom: lim.minZoom, maxBounds: lim.maxBounds" in src
    assert "mapPalette: () => look.map" in an, "the theme's own day or night map palette"
    # every host it talks to is already in the policy: the style and tiles only
    csp = an.split('http-equiv="Content-Security-Policy" content="', 1)[1].split('"', 1)[0]
    assert "https://tiles.openfreemap.org" in csp and "worker-src 'self' apexnav: blob:" in csp
    assert (WEB / "vendor" / "maplibre-gl.js").exists() and (WEB / "vendor" / "maplibre-gl.css").exists()


def test_the_path_follows_the_map_when_zoomed_and_panned(r):
    f = r["follow"]
    assert f["err"] < 0.05, f                                     # every point within a twentieth of a pixel
    assert abs(f["s"] - 2 ** 2.3) < 1e-9
    for t in (f["id"], f["none"]):                                 # the fitted view, or no map: the picture as drawn
        assert abs(t["s"] - 1) < 1e-12 and abs(t["tx"]) < 1e-6 and abs(t["ty"]) < 1e-6, t
    assert abs(f["back"][0] - 123.4) < 1e-6 and abs(f["back"][1] + 567.8) < 1e-6


def test_out_a_little_past_the_drive_never_all_the_way(r):
    lim = r["lim"]
    assert abs(lim["L"]["minZoom"] - (lim["fitZoom"] - 1)) < 1e-12, "one zoom level past the fitted view, no further"
    # the pan box is three fitted views across: at the lowest zoom (half the scale) one and a half views of it show,
    # wider than the 360 x 240 box, so the zoom-out limit is the one that holds and the drive stays in reach
    assert abs(lim["wide"] - 540) < 0.5 and abs(lim["tall"] - 360) < 0.5, lim


def test_a_route_map_only_for_a_drive_that_kept_to_the_route(r):
    c = r["corridor"]
    assert 3 <= c["kept"] < c["n"] / 10, c                        # the line thinned, the corner kept
    assert c["along"] is True, "a drive that kept to the route: its map is on the phone"
    assert c["across"] is False and c["offline"] is False, "the diagonal inside the box but off the corridor: blank, said"
    assert c["acrossNoPts"] is True and c["acrossOld"] is True, "without points, or an older area with no line: the box"
    assert c["short"] is None
