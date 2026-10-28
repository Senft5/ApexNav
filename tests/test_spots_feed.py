"""Spots near you (web/spots_feed.js, IDEAS S-12): best rated first, then nearest; a category filter; no position, no feed."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const F = require(process.argv[1] + '/web/spots_feed.js');
const here = { lat: 35.6, lon: -83.5 };
const spots = [
  { id: 'a', name: 'Near overlook', category: 'overlook', rating: 4.2, lat: 35.61, lon: -83.5 },
  { id: 'b', name: 'Far overlook', category: 'overlook', rating: 4.2, lat: 35.7, lon: -83.5 },
  { id: 'c', name: 'Cafe', category: 'cafe', rating: 4.8, lat: 35.65, lon: -83.5 },
  { id: 'd', name: 'Odd', category: 'unknown', rating: 3, lat: 35.6, lon: -83.5 }, { id: 'e', name: 'Broken', category: 'cafe', rating: 5, lat: null, lon: 1 },
];
console.log(JSON.stringify({ all: F.feed(spots, here).map((s) => [s.id, s.km, s.label]), cafe: F.feed(spots, here, 'cafe').map((s) => s.id), none: F.feed(spots, null) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_feed_order_and_labels(out):
    assert out["all"] == [["c", 5.5, "Café"], ["a", 1.1, "Overlook"], ["b", 11.1, "Overlook"], ["d", 0, "Spot"]]


def test_filter_and_no_position(out):
    assert out["cafe"] == ["c"]
    assert out["none"] == []
