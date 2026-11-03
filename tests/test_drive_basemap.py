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
const loop = (lat0, lon0, km) => { const lat = [], lon = [];
  for (let i = 0; i <= 400; i++) { const a = i / 400 * 2 * Math.PI; lat.push(lat0 + Math.sin(a) * km / 111 + i * 1e-5); lon.push(lon0 + Math.cos(a) * km / 70); }
  return [lat, lon]; };
const [la, lo] = loop(35.6, -83.9, 3), [nla, nlo] = loop(69.6, 18.9, 40);
const areas = [{ lat: 35.6, lon: -83.9, radiusKm: 25 }];
console.log(JSON.stringify({
  tn: worst(la, lo, 0.1), north: worst(nla, nlo, 0.004),
  inArea: B.covered(areas, [35.55, -83.95, 35.65, -83.85]), edge: B.covered(areas, [35.55, -83.95, 35.65, -83.5]),
  bad: B.covered([{ lat: null, lon: 1, radiusKm: 5 }], [0, 0, 0.01, 0.01]),
  tryOnline: B.worthTrying(true, [], [0, 0, 1, 1]), tryOffNone: B.worthTrying(false, [], [35.55, -83.95, 35.65, -83.85]),
  tryOffSaved: B.worthTrying(false, areas, [35.55, -83.95, 35.65, -83.85]), tryUnknown: B.worthTrying(undefined, [], [0, 0, 1, 1]),
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
    assert r["tryOnline"] is True and r["tryUnknown"] is True
    assert r["tryOffNone"] is False, "no signal and no saved area: the blank panel, never a broken map"
    assert r["tryOffSaved"] is True, "no signal but a saved area under the drive: the map from the phone"


def test_the_page_loads_it_lazily_and_inside_the_policy():
    an = (WEB / "analysis.html").read_text(encoding="utf-8")
    src = (WEB / "drive_basemap.js").read_text(encoding="utf-8")
    # MapLibre is not in the Log's head: it loads when the picture scrolls into view (REVIEW_FEEL: the Log stays fast)
    assert 'src="vendor/maplibre-gl.js"' not in an and 'href="vendor/maplibre-gl.css"' not in an
    assert '<script src="drive_basemap.js"></script>' in an and an.index("drive_basemap.js") < an.index('src="drive_view.js"')
    assert "IntersectionObserver" in src and "'vendor/maplibre-gl.js'" in src
    assert "interactive: false" in src and "transformRequest: O ? O.transform" in src, "a picture, through the offline areas"
    assert "mapPalette: () => look.map" in an, "the theme's own day or night map palette"
    # every host it talks to is already in the policy: the style and tiles only
    csp = an.split('http-equiv="Content-Security-Policy" content="', 1)[1].split('"', 1)[0]
    assert "https://tiles.openfreemap.org" in csp and "worker-src 'self' apexnav: blob:" in csp
    assert (WEB / "vendor" / "maplibre-gl.js").exists() and (WEB / "vendor" / "maplibre-gl.css").exists()
