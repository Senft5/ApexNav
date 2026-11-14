"""A place's photo (web/place_photo.js): the Mapillary street photo taken near the place and facing it, never one
pointing away, a panorama, or one too far off; who took it is named, as CC BY-SA asks."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/place_photo.js');
const LAT = 39.1, LON = -84.5, M = 111320, K = Math.cos(LAT * Math.PI / 180);
// a photo `south` metres south and `east` metres east of the place, the camera on `heading` degrees
const im = (id, south, east, heading, o = {}) => ({ id, thumb_1024_url: 'https://scontent.example.fbcdn.net/' + id, computed_compass_angle: heading,
  captured_at: Date.UTC(o.year || 2024, 5, 1), computed_geometry: { type: 'Point', coordinates: [LON + east / (M * K), LAT - south / M] },
  is_pano: !!o.pano, creator: { username: o.by || 'driver1' } });
const id = (list) => { const p = P.pick(list, LAT, LON); return p && p.id; };
console.log(JSON.stringify({
  facing: id([im('a', 30, 0, 0)]),                                  // south of it, looking north: at it
  away: id([im('b', 30, 0, 180)]),                                  // looking south: away
  side: id([im('c', 30, 0, 90)]),                                   // looking east: past it
  far: id([im('d', 120, 0, 0)]),
  onTop: id([im('e', 1, 0, 0)]),
  pano: id([im('f', 30, 0, 0, { pano: true })]),
  nearer: id([im('g', 60, 0, 0), im('h', 20, 0, 5)]),
  newer: id([im('i', 25, 0, 0, { year: 2015 }), im('j', 25, 0, 0, { year: 2025 })]),
  wrap: id([im('k', -30, -30, 135)]),                               // north-west of it, looking south-east (across 0/360)
  noHttps: id([{ ...im('l', 30, 0, 0), thumb_1024_url: 'http://x/y' }]),
  junk: [P.pick(null, LAT, LON), P.pick([null, {}, { thumb_1024_url: 'https://x' }], LAT, LON)],
  picked: P.pick([im('m', 30, 0, 0, { by: 'roadie', year: 2023 })], LAT, LON),
  credit: [P.credit({ by: 'roadie', year: 2023 }), P.credit({ by: null, year: null })],
  page: P.page({ id: '123' }),
  url: P.url(LAT, LON, 'MLY|tok'),
  thumbs: [P.pick([{ ...im('n', 30, 0, 0), thumb_256_url: 'https://scontent.example.fbcdn.net/n256' }], LAT, LON).thumb, P.pick([im('o', 30, 0, 0)], LAT, LON).thumb],
}));
"""


@pytest.fixture(scope="module")
def got():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def test_only_a_photo_facing_the_place(got):
    assert got["facing"] == "a"
    assert got["away"] is None and got["side"] is None
    assert got["wrap"] == "k"


def test_not_too_far_not_on_top_not_a_panorama(got):
    assert got["far"] is None and got["onTop"] is None and got["pano"] is None
    assert got["noHttps"] is None
    assert got["junk"] == [None, None]


def test_nearer_and_newer_win(got):
    assert got["nearer"] == "h"
    assert got["newer"] == "j"


def test_credit_names_the_taker_and_licence(got):
    p = got["picked"]
    assert p["by"] == "roadie" and p["year"] == 2023 and p["m"] == 30
    assert got["credit"] == ["Photo: roadie · Mapillary · 2023 · CC BY-SA", "Photo · Mapillary · CC BY-SA"]
    assert got["page"].startswith("https://www.mapillary.com/app/?pKey=123")


def test_the_query_is_a_small_square_with_the_token_escaped(got):
    u = got["url"]
    assert u.startswith("https://graph.mapillary.com/images?access_token=MLY%7Ctok&")
    bbox = [float(v) for v in u.split("bbox=")[1].split("&")[0].split(",")]
    assert bbox[0] < -84.5 < bbox[2] and bbox[1] < 39.1 < bbox[3]
    assert (bbox[3] - bbox[1]) < 0.0015 and (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) < 0.01


def test_a_list_gets_the_small_picture_or_the_big_one(got):
    assert got["thumbs"] == ["https://scontent.example.fbcdn.net/n256", "https://scontent.example.fbcdn.net/o"]
    assert "thumb_256_url" in got["url"]
