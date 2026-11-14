"""A place someone sent (web/place_link.js): the place card's Share makes a vettadrive.app link with the spot and its
name in the fragment, in the characters the app passes on; the link opens the same card, and anything malformed opens
nothing. The app and the site's apple-app-site-association both take #place=."""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
ROOT = Path(__file__).resolve().parents[1]

RUNNER = r"""
const L = require(process.argv[1] + '/web/place_link.js');
const t = L.encode({ lat: 39.103512345, lon: -84.512, name: 'Skyline Chili' });
const long = L.encode({ lat: 35.5, lon: -83.9, name: 'Ça va café ☕ '.repeat(10) });
console.log(JSON.stringify({
  t, back: L.decode(t), url: L.url('https://vettadrive.app/', { lat: 39.1, lon: -84.5, name: 'Eden Park' }),
  noName: [L.encode({ lat: 1, lon: 2 }), L.decode(L.encode({ lat: 1, lon: 2 }))],
  long: [long.length, L.decode(long) && L.decode(long).name],
  accents: L.decode(L.encode({ lat: 46.2, lon: 6.1, name: 'Genève — Café\n<b>' })),
  bad: [L.encode({ lat: 91, lon: 0 }), L.encode(null), L.decode(''), L.decode('39.1_-84.5_!!'), L.decode('139.1_-84.5'), L.decode('39.1,-84.5'), L.decode('39.1_-84.5_____')],
  from: [L.fromLocation('?place=' + t, ''), L.fromLocation('', '#place=' + t), L.fromLocation('?x=1', '#road=abc')],
}));
"""


@pytest.fixture(scope="module")
def got():
    if NODE is None:
        pytest.skip("node not installed")
    r = subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def test_round_trip_in_the_apps_characters(got):
    assert got["t"].startswith("39.10351_-84.51200_")
    assert re.fullmatch(r"[A-Za-z0-9._-]{1,200}", got["t"])
    assert got["back"] == {"lat": 39.10351, "lon": -84.512, "name": "Skyline Chili"}
    assert got["url"].startswith("https://vettadrive.app/#place=39.10000_-84.50000_")
    assert got["noName"] == ["1.00000_2.00000", {"lat": 1, "lon": 2, "name": ""}]


def test_a_long_name_is_cut_to_fit_never_the_place(got):
    n, name = got["long"]
    assert n <= 200 and name and name.startswith("Ça va café")
    assert got["accents"]["name"] == "Genève — Café <b>"


def test_malformed_opens_nothing(got):
    assert got["bad"][0] is None and got["bad"][1] is None
    assert all(b is None for b in got["bad"][2:6])


def test_read_from_the_app_or_the_site(got):
    assert got["from"][0] == got["t"] and got["from"][1] == got["t"] and got["from"][2] is None


def test_the_app_and_the_site_take_place_links():
    swift = (ROOT / "ApexNavApp.swift").read_text(encoding="utf-8")
    keys = re.search(r"static let linkKeys: Set<String> = \[([^\]]*)\]", swift).group(1)
    assert '"place"' in keys and 'frag.hasPrefix("place=")' in swift
    assert '{ "/": "/", "#": "place=*" }' in (ROOT / "backend/src/hosts.ts").read_text(encoding="utf-8")
    page = (ROOT / "web/index.html").read_text(encoding="utf-8")
    assert '<script src="place_link.js" defer></script>' in page and 'id="pinShareBtn"' in page
