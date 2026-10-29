"""The road ahead with no route (web/horizon.js, docs/design/REVIEW.md 3.1): follow the road you're on through plain
junctions, stop at any junction where the way on isn't plain; never guess a turn."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const H = require(process.argv[1] + '/web/horizon.js');
const LAT = 35.6, LON = -83.9, KX = 111320 * Math.cos(LAT * Math.PI / 180);
const P = (x, y) => [LON + x / KX, LAT + y / 110540];                 // metres east, north from (0, 0)
const me = (h, x = 0, y = 0) => ({ lat: LAT + y / 110540, lon: LON + x / KX, heading: h });
const north = (y0, y1, step = 20) => { const c = []; for (let y = y0; y <= y1; y += step) c.push(P(0, y)); return c; };
const summary = (r) => r && { m: r.m, end: r.end, last: [Math.round((r.coords[r.coords.length - 1][0] - LON) * KX), Math.round((r.coords[r.coords.length - 1][1] - LAT) * 110540)] };
const out = {};
// a plain road north, split into two tile pieces at y = 400
out.plain = summary(H.ahead([{ coords: north(-100, 400), cls: 'secondary' }, { coords: north(400, 3000), cls: 'secondary' }], me(5)));
// the other way along it
out.back = summary(H.ahead([{ coords: north(-1000, 400), cls: 'secondary' }], me(185)));
// a side road joins from the east at y = 500: carry on
out.side = summary(H.ahead([{ coords: north(-100, 1200), cls: 'secondary' }, { coords: [P(0, 500), P(300, 500)], cls: 'minor' }], me(0), 1000));
// a T at y = 600: stop there
out.tee = summary(H.ahead([{ coords: north(-100, 600), cls: 'tertiary' }, { coords: [P(-400, 600), P(0, 600), P(400, 600)], cls: 'primary' }], me(0)));
// a Y fork at y = 300, both branches 20 degrees off: stop
const yb = (s) => [P(0, 300), P(s * 70, 500), P(s * 140, 700)];
out.fork = summary(H.ahead([{ coords: north(-100, 300), cls: 'secondary' }, { coords: yb(1), cls: 'secondary' }, { coords: yb(-1), cls: 'secondary' }], me(0)));
// a bend: north, then curving east, followed round
const bend = [...north(-100, 200)]; for (let a = 0; a <= 90; a += 10) bend.push(P(200 - 200 * Math.cos(a * Math.PI / 180), 200 + 200 * Math.sin(a * Math.PI / 180)));
bend.push(P(1200, 400));
out.bend = summary(H.ahead([{ coords: bend, cls: 'tertiary' }], me(0)));
// off the road, or across it
out.far = H.ahead([{ coords: north(-100, 400), cls: 'secondary' }], me(0, 80, 0));
out.across = H.ahead([{ coords: north(-100, 400), cls: 'secondary' }], me(90));
out.noHeading = H.ahead([{ coords: north(-100, 400), cls: 'secondary' }], { lat: LAT, lon: LON, heading: null });
// a road that ends
out.dead = summary(H.ahead([{ coords: north(-100, 300), cls: 'minor' }], me(0)));
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_follows_the_road_across_tile_pieces_either_way(out):
    assert out["plain"]["m"] == 2000 and out["plain"]["end"] == "length" and out["plain"]["last"] == [0, 2000]
    assert out["back"] == {"m": 1000, "end": "dead end", "last": [0, -1000]}


def test_carries_on_past_a_side_road_and_round_a_bend(out):
    assert out["side"]["m"] == 1000 and out["side"]["end"] == "length"
    assert out["bend"]["last"][0] > 1000 and out["bend"]["end"] == "dead end"


def test_stops_at_a_t_or_a_fork(out):
    assert out["tee"]["end"] == "junction" and out["tee"]["last"] == [0, 600]
    assert out["fork"]["end"] == "junction" and out["fork"]["last"] == [0, 300]


def test_nothing_when_not_on_a_road_going_along_it(out):
    assert out["far"] is None and out["across"] is None and out["noHeading"] is None
    assert out["dead"]["end"] == "dead end" and out["dead"]["m"] == 300
