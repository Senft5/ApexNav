"""The Social home (web/social_home.js, Nate 2026-11-16): the Feed side's rings across the top say who is out driving now,
who drove today and your crews, each once, in that order; and the home's keys reach their places (e2e/smoke.js)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const S = require(process.argv[1] + '/web/social_home.js');
const now = Date.parse('2026-11-16T12:00:00Z');
const live = [{ handle: 'cara', photo_id: 'p1' }, { handle: 'dan' }, { handle: 'cara' }];
const posts = [
  { id: 'a', handle: 'sam', created_at: '2026-11-16 10:00:00', title: 'Kellogg bends' },
  { id: 'b', handle: 'sam', created_at: '2026-11-16 11:00:00', title: 'Newer' },
  { id: 'c', handle: 'cara', created_at: '2026-11-16 11:30:00' },
  { id: 'd', handle: 'old', created_at: '2026-11-14 11:00:00' },
  { id: 'e', mine: true, handle: 'me', created_at: '2026-11-16 11:59:00' },
  { id: 'f', handle: 'eve', created_at: '2026-11-16T09:00:00Z' },
];
const crews = [{ id: 'k1', name: 'Ridge Runners' }, { name: 'no id' }];
const rs = S.rings(live, posts, crews, now);
const many = S.rings(Array.from({ length: 30 }, (_, i) => ({ handle: 'f' + i })), [], crews, now);
console.log(JSON.stringify({
  rs: rs.map((r) => [r.kind, r.handle || r.crew, r.post || null]),
  labels: rs.map(S.ringLabel),
  many: many.length, empty: S.rings(null, null, null, now).length,
}));
"""


def run():
    out = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60, check=True).stdout
    return json.loads(out)


def test_rings_order_once_each():
    r = run()
    # driving now first (cara once, though twice live and posted too), then today's posters newest first with their
    # newest post (sam's 'b'), never your own or one older than a day, then crews with an id
    assert r["rs"] == [["live", "cara", None], ["live", "dan", None], ["new", "sam", "b"], ["new", "eve", "f"], ["crew", "k1", None]]


def test_ring_labels_say_what_a_tap_does():
    r = run()
    assert r["labels"][0] == "@cara, driving now. See them on the map"
    assert r["labels"][2] == "@sam drove today: Newer. Open it"
    assert r["labels"][4] == "Ridge Runners, your crew. Open it"


def test_rings_capped_and_empty_safe():
    r = run()
    assert r["many"] == 20 and r["empty"] == 0
