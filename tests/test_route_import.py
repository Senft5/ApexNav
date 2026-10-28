"""Routes from elsewhere (web/route_import.js, IDEAS R-25, R-26): GPX tracks, route points and waypoints; Google Maps,
Apple Maps and geo: links; and a planned route out as GPX that reads back in."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = require(process.argv[1] + '/web/route_import.js');
const trk = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Tail &amp; Dragon</name><trkseg>
<trkpt lat="35.52" lon="-83.94"><ele>500</ele></trkpt><trkpt lon="-83.93" lat="35.53"/><trkpt lat="bad" lon="1"/></trkseg></trk></gpx>`;
const rte = `<gpx><rte><name>Loop</name><rtept lat="35.1" lon="-84.1"/><rtept lat="35.2" lon="-84.2"/><rtept lat="35.3" lon="-84.3"/></rte></gpx>`;
const wpt = `<gpx><wpt lat="35.1" lon="-84.1"><name>A</name></wpt><wpt lat="35.4" lon="-84.4"/></gpx>`;
const L = (u) => R.parseMapsLink(u);
const back = R.parseGpx(R.toGpx('My <route>', [35.1, 35.2, 35.3, 35.4, 35.5], [-84.1, -84.2, -84.3, -84.4, -84.5], 2));
console.log(JSON.stringify({
  trk: R.parseGpx(trk), rte: R.parseGpx(rte), wpt: R.parseGpx(wpt), none: [R.parseGpx('<gpx></gpx>'), R.parseGpx('not xml'), R.parseGpx(null)],
  gdir: L('https://www.google.com/maps/dir/35.9606,-83.9207/Townsend,+TN/35.7565,-83.97/@35.8,-83.9,11z/data=!3m1'),
  gapi: L('https://www.google.com/maps/dir/?api=1&destination=35.56,-83.50&waypoints=35.6,-83.6%7CGatlinburg'),
  gplace: L('https://www.google.com/maps/place/Newfound+Gap/@35.6111,-83.4250,15z'),
  gshort: L('https://maps.app.goo.gl/abc123'),
  apple: L('https://maps.apple.com/?saddr=Knoxville&daddr=35.4842,-83.3149'),
  geo: L('geo:35.61,-83.42?z=12'), other: L('https://example.com/?q=1'), word: L('Maryville'),
  back,
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_gpx(out):
    assert out["trk"] == {"name": "Tail & Dragon", "kind": "track", "coords": [[-83.94, 35.52], [-83.93, 35.53]]}
    assert out["rte"] == {"name": "Loop", "kind": "stops", "stops": [{"lat": 35.1, "lon": -84.1}, {"lat": 35.2, "lon": -84.2}, {"lat": 35.3, "lon": -84.3}]}
    assert out["wpt"]["kind"] == "stops" and len(out["wpt"]["stops"]) == 2
    assert out["none"] == [None, None, None]


def test_maps_links(out):
    assert out["gdir"] == {"from": {"lat": 35.9606, "lon": -83.9207}, "to": {"lat": 35.7565, "lon": -83.97}, "via": [{"query": "Townsend, TN"}]}
    assert out["gapi"] == {"from": None, "to": {"lat": 35.56, "lon": -83.5}, "via": [{"lat": 35.6, "lon": -83.6}, {"query": "Gatlinburg"}]}
    assert out["gplace"] == {"from": None, "to": {"lat": 35.6111, "lon": -83.425}, "via": []}
    assert out["gshort"] == {"short": True}
    assert out["apple"] == {"from": {"query": "Knoxville"}, "to": {"lat": 35.4842, "lon": -83.3149}, "via": []}
    assert out["geo"] == {"from": None, "to": {"lat": 35.61, "lon": -83.42}, "via": []}
    assert out["other"] is None and out["word"] is None


def test_gpx_export_reads_back(out):
    b = out["back"]
    assert b["name"] == "My <route>" and b["kind"] == "track"
    assert b["coords"] == [[-84.1, 35.1], [-84.3, 35.3], [-84.5, 35.5]]


def test_wired_in_app_and_shell():
    read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()
    html, yml, swift = read("web", "index.html"), read("project.yml"), read("ApexNavApp.swift")
    assert '<script src="route_import.js"></script>' in html and 'id="gpxFile"' in html and 'id="routeGpxBtn"' in html
    assert "msg.type === 'gpx'" in html and "ApexRouteImport.parseMapsLink(toQ);" in html
    assert "LSItemContentTypes: [com.topografix.gpx]" in yml and yml.count("LSSupportsOpeningDocumentsInPlace:") == 1   # one key: a duplicate is ambiguous to YAML readers
    assert "if url.isFileURL { openFile(url); return }" in swift and "data.count <= 5_000_000" in swift
