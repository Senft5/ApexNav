"""Road cameras (web/road_cams.js): Ohio DOT's traffic cameras as an opt-in layer, pictures only from ODOT's own host."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/road_cams.js');
const H = 'https://itscameras.dot.state.oh.us/images/a.jpg';
const out = {};
out.geo = C.geojson({ cams: [{ id: '1', lat: 40, lon: -83, name: 'I-70 at SR-256', views: [{ dir: '', url: H }] },
  { id: '2', lat: 40, lon: -83, name: 'x', views: [{ url: 'https://example.com/b.jpg' }] }, { id: '3', lat: 'x', lon: 1, views: [{ url: H }] }, null] });
out.none = C.geojson(null);
out.pic = C.pictureUrl(H, 120000);
out.picQ = C.pictureUrl(H + '?a=1', 120000);
out.picBad = C.pictureUrl('https://example.com/b.jpg', 0);
out.ky = C.geojson({ cams: [{ id: 'ky-CCTV_05_71_0103', lat: 38.32, lon: -85.56, name: 'I-71 at Old Brownsboro Rd', views: [{ dir: '', url: 'https://www.trimarc.org/images/milestone/CCTV_05_71_0103.jpg' }] }] });
out.who = [C.ownerOf(H), C.ownerOf('https://www.trimarc.org/images/milestone/x.jpg'), C.ownerOf('http://www.trimarc.org/x.jpg')];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_points_with_odot_pictures_only(out):
    assert [f["id"] for f in out["geo"]["features"]] == ["1"]
    assert out["geo"]["features"][0]["geometry"]["coordinates"] == [-83, 40]
    assert out["none"]["features"] == []
    assert [f["id"] for f in out["ky"]["features"]] == ["ky-CCTV_05_71_0103"]                 # Kentucky's, on TRIMARC's host


def test_each_picture_says_whose_camera_it_is(out):
    assert out["who"] == ["Ohio DOT", "Kentucky TRIMARC", None]                               # never an http picture


def test_a_fresh_picture_each_minute_and_never_another_host(out):
    assert out["pic"] == "https://itscameras.dot.state.oh.us/images/a.jpg?t=2"
    assert out["picQ"].endswith("?a=1&t=2")
    assert out["picBad"] is None


def test_wired_as_an_opt_in_lazy_layer_kept_apart_from_speed_cameras():
    web = os.path.join(ROOT, "web")
    lazy = open(os.path.join(web, "lazy.js"), encoding="utf-8").read()
    html = open(os.path.join(web, "index.html"), encoding="utf-8").read()
    js = open(os.path.join(web, "cockpit.js"), encoding="utf-8").read()
    assert "roadcams: ['road_cams.js']" in lazy and '<script src="road_cams.js"' not in html   # never on the launch path
    assert 'data-toggle="roadcams"' in html and "roadcams: false," in js                       # off until switched on
    assert "if (k === 'roadcams') roadCamsLayer(state.toggles.roadcams);" in js
    assert "https://itscameras.dot.state.oh.us https://www.trimarc.org" in html                                         # the pictures' host in img-src
    assert "driving: () => driveActive && state.mode === 'live'" in js                          # the picture waits for a stop
