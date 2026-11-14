"""Roadbooks (web/roadbooks.js, docs/SOCIAL.md 2.6): what a planned route leaves in a book (private ends and privacy zones
cut), how much of a road a drive covers (a stamp is found in the Log, never tapped), and the lines the pages say."""
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
const R = require(process.argv[1] + '/web/roadbooks.js');
const out = {};
// a 6 km route heading east at 35.5 N, a point every 10 m
const n = 601, lat = Array.from({ length: n }, (_, i) => 35.5 + Math.sin(i / 40) * 0.002), lon = Array.from({ length: n }, (_, i) => -83.9 + i * 0.00011);
const dist = [0]; for (let i = 1; i < n; i++) dist.push(dist[i - 1] + Math.hypot((lat[i] - lat[i - 1]) * 110540, (lon[i] - lon[i - 1]) * 111320 * Math.cos(35.5 * Math.PI / 180)));
const t = { lat, lon, dist };
const g = R.fromTrack(t);
const first = dist.findIndex((d) => d >= 400);
out.trim = [g.length <= R.MAX_POINTS, g[0][0] === +lon[first].toFixed(5), g[g.length - 1][0] === +lon[n - 1].toFixed(5), Math.round(R.lengthM(g) / 100)];
// a privacy zone over the end: the road stops before it; one in the middle: the longer side is kept
const zEnd = R.fromTrack(t, [{ lat: lat[n - 1], lon: lon[n - 1], r: 500 }]);
out.zoneEnd = Math.round((dist[n - 1] - 400 - R.lengthM(zEnd)) / 100);
const zMid = R.fromTrack(t, [{ lat: lat[200], lon: lon[200], r: 300 }]);
out.zoneMid = [zMid[0][0] > lon[200], Math.round(R.lengthM(zMid) / 100)];
// a loop loses both ends; a route that is all private leaves nothing
const loop = { lat: [...lat, ...lat.slice().reverse()], lon: [...lon, ...lon.slice().reverse()], dist: [...dist, ...dist.map((d) => dist[n - 1] * 2 - d).reverse()] };
const gl = R.fromTrack(loop);
out.loop = [gl.length <= R.MAX_POINTS, Math.round((dist[n - 1] * 2 - 800 - R.lengthM(gl)) / 100)];
out.none = [R.fromTrack({ lat: lat.slice(0, 60), lon: lon.slice(0, 60), dist: dist.slice(0, 60) }), R.fromTrack(t, [{ lat: 35.5, lon: -83.87, r: 20000 }]), R.fromTrack(null)];

// coverage: the same road driven (GPS 8 m off, either direction), half of it, a parallel road 120 m away, a drive with a gap
const off = (m) => lat.map((v) => v + m / 110540);
const cov = (la, lo) => +R.coverage(g, la, lo).toFixed(2);
out.cover = { same: cov(off(8), lon), back: cov(off(8).slice().reverse(), lon.slice().reverse()), half: cov(off(8).slice(0, 320), lon.slice(0, 320)),
  beside: cov(off(120), lon), sparse: cov(off(5).filter((_, i) => i % 12 === 0), lon.filter((_, i) => i % 12 === 0)),
  gap: cov(off(5).filter((_, i) => i < 150 || i > 450), lon.filter((_, i) => i < 150 || i > 450)), nothing: R.coverage(g, [], []), nan: cov([NaN, ...off(8)], [NaN, ...lon]) };
out.stampAt = R.STAMP_AT;
out.boxes = [R.overlaps(R.boxOf(lat, lon), [35.49, 35.51, -83.95, -83.89]), R.overlaps(R.boxOf(lat, lon), [36, 36.1, -83.9, -83.8]), R.overlaps(null, [0, 1, 0, 1]), R.boxOf([NaN], [1])];

out.progress = [R.progress([]), R.progress([{ stamped: true }, {}, {}]), R.progress([{ stamped: true }, { stamped: true }]), R.progress([{ stamped: true }])].map((p) => [p.text, p.all]);
out.lines = [R.bookLine({ roads: 7, length_m: 212000, followers: 41 }), R.bookLine({ roads: 1, length_m: 5400, followers: 0 }), R.bookLine({ roads: 0, length_m: 0 }), R.bookLine({ roads: 2, length_m: 16093 }, (m) => `${(m / 1609.344).toFixed(0)} mi`)];
out.link = [R.link('https://vetta.example/', 'AbCdEfGhIjKlMnOp'), R.link('https://vetta.example', 'a b')];
const svg = R.overview([{ geom: g, stamped: true }, { geom: g.map(([lo, la]) => [lo, la + 0.01]) }, { geom: [[1, 1]] }], { line: 'var(--panel-dim)', hi: 'var(--accent)' });
out.esc = R.overview([{ geom: g }], { label: 'A "book" <img src=x onerror=1> & more' });
out.svg = [(svg.match(/<path /g) || []).length, svg.indexOf('var(--panel-dim)') < svg.indexOf('var(--accent)'), /NaN|undefined/.test(svg), R.overview([]), R.overview([{ geom: [[1, 1]] }])];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_a_route_leaves_its_road_without_the_private_ends(out):
    assert out["trim"] == [True, True, True, 60]             # 6.4 km less the first 400 m
    assert out["zoneEnd"] in (4, 5, 6)                       # a 500 m zone at the end takes about that much more
    assert out["zoneMid"][0] is True and out["zoneMid"][1] > 30   # the longer side of a zone in the middle
    assert out["loop"] == [True, 0]                          # a loop loses 400 m at both ends, and stays under the point limit
    assert out["none"] == [None, None, None]


def test_coverage_is_the_share_of_the_road_a_drive_was_on(out):
    c = out["cover"]
    assert c["same"] == 1 and c["back"] == 1 and c["sparse"] == 1 and c["nan"] == 1
    assert 0.45 <= c["half"] <= 0.6
    assert c["beside"] == 0 and c["nothing"] == 0
    assert c["gap"] < out["stampAt"] <= c["same"]            # a drive that skipped the middle earns no stamp
    assert out["boxes"] == [True, False, False, None]


def test_the_lines_the_pages_say(out):
    assert out["progress"] == [["", False], ["1 of 3 driven", False], ["All 2 driven", True], ["Driven", True]]
    assert out["lines"] == ["7 roads · 212 km · 41 following", "1 road · 5 km", "0 roads", "2 roads · 10 mi"]
    assert out["link"] == ["https://vetta.example/?roadbook=AbCdEfGhIjKlMnOp", "https://vetta.example/?roadbook=a%20b"]
    assert '<img' not in out["esc"] and 'aria-label="A &quot;book&quot; &lt;img src=x onerror=1&gt; &amp; more"' in out["esc"]   # a book's name can't become markup
    assert out["svg"] == [2, True, False, None, None]        # two roads drawn, the driven one on top, nothing for an empty book


def test_wired_into_the_app():
    cockpit = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "'roadbooks.js'" in open(os.path.join(ROOT, "web", "lazy.js"), encoding="utf-8").read()
    for needle in ("ApexRoadbooks.mount(", "roadbooks.afterDrive(", "navRow('Roadbooks'", "roadbooks.addPart(", "openRoadbookLink("):
        assert needle in cockpit, needle
    # the app's link handler passes the key on (apexnav://open?roadbook=…)
    assert '"roadbook"' in re.search(r"static let linkKeys: Set<String> = \[([^\]]*)\]", open(os.path.join(ROOT, "ApexNavApp.swift"), encoding="utf-8").read()).group(1)
