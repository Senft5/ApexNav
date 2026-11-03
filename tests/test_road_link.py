"""Send the road, not the drive (web/road_link.js, panel round 2 DA-4 / RA-4; JA-3's public drive link vetoed by VI): the link
carries a road's line and its name only, never the drive's ends, time, speeds, score or person, and fits the app's link rules."""
import json
import os
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const L = require(process.argv[1] + '/web/road_link.js');
const lat = [], lon = [], dist = [];
for (let i = 0; i < 2000; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29 + Math.sin(i / 40) * 0.002); dist.push(i * 5); }   // 10 km
const pts = L.roadPoints(lat, lon, dist);
const tok = L.encode(pts, 'Cherohala Skyway'), back = L.decode(tok);
const long = L.encode(pts, 'Ruta Panorámica de la Sierra de Guadarrama y alrededores muy largos');
console.log(JSON.stringify({
  n: pts.length, first: pts[0], last: pts[pts.length - 1], tok, back, unnamed: L.decode(L.encode(pts, '')),
  longName: L.decode(long).name, short: L.roadPoints(lat.slice(0, 380), lon.slice(0, 380), dist.slice(0, 380)),
  bad: [L.decode(''), L.decode('r1.'), L.decode('x1.AAAA'), L.decode('r1.@@'), L.decode('r1.' + 'A'.repeat(300)), L.decode(L.encode([{ lat: 35, lon: -84 }, { lat: 36, lon: -84 }]))],
  url: L.url('https://apexnav.senftns.workers.dev/', tok),
  fromHash: L.fromLocation('', '#road=' + tok), fromQuery: L.fromLocation('?road=' + tok, ''), none: L.fromLocation('?drive=x', '#y'),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_road_round_trips_to_a_metre(out):
    b = out["back"]
    assert b["name"] == "Cherohala Skyway" and len(b["pts"]) == out["n"] == 11
    assert abs(b["pts"][0]["lat"] - out["first"]["lat"]) < 1e-5 and abs(b["pts"][-1]["lon"] - out["last"]["lon"]) < 1e-5
    assert out["unnamed"]["name"] == ""


def test_the_drive_ends_stay_on_the_phone(out):
    # the first and last 800 m are not in the link (home and work): the road starts 160 rows in, ends 160 rows from the end
    assert abs(out["first"]["lat"] - (35.36 + 160 * 5 / 110540)) < 1e-6
    assert abs(out["last"]["lat"] - (35.36 + 1839 * 5 / 110540)) < 1e-6
    assert out["short"] is None                                           # 1.9 km: under 400 m left once the ends are off


def test_fits_the_apps_link_rules(out):
    tok = out["tok"]
    assert re.fullmatch(r"[A-Za-z0-9._-]{1,200}", tok)                   # ApexWebBundle.linkItems passes exactly these
    assert len(out["longName"].encode()) <= 48
    swift = open(os.path.join(ROOT, "ApexNavApp.swift"), encoding="utf-8").read()
    assert re.search(r'static let linkKeys: Set<String> = \[[^\]]*"road"', swift)


def test_anything_else_is_not_a_road(out):
    assert out["bad"] == [None] * 6                                      # empty, cut, wrong version, junk, too long, a 111 km jump


def test_the_website_carries_it_in_the_fragment(out):
    assert out["url"] == "https://apexnav.senftns.workers.dev/#road=" + out["tok"]   # never sent to a server
    assert out["fromHash"] == out["tok"] == out["fromQuery"] and out["none"] is None


def test_the_log_sends_the_road_not_the_drive():
    html = open(os.path.join(ROOT, "web", "analysis.html"), encoding="utf-8").read()
    i = html.index("$('dvShare').addEventListener")
    body = html[i:html.index("});", i)]
    assert "ApexRoadLink.roadPoints(d.lat, d.lon, d.dist)" in body and "ApexRoadLink.encode" in body
    for leak in ["score", "d.ds", "date", "speed", "/?drive="]:
        assert leak not in body, leak
    assert '<button class="linkbtn" id="dvShare">Send the road</button>' in html
    js = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "if (ok(p.road)) { closeSheet(); openRoadLink(p.road); return; }" in js
    assert "roadFromLocation(location.search);" in js
