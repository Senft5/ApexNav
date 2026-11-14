"""Drive posts (web/drive_posts.js, docs/SOCIAL.md 2.13): the line loses its privacy-zone ends and 500 m more, is thinned,
round-trips through the polyline codec, draws inside its box, and the card's facts read length then roads."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const D = require(process.argv[1] + '/web/drive_posts.js');
const lat = [], lon = [];
for (let i = 0; i < 2000; i++) { lat.push(35 + i * 5 / 110540); lon.push(-84); }          // 10 km north, a point every 5 m
const plain = D.trimLine(lat, lon);
const zoned = D.trimLine(lat, lon, (la) => la < 35 + 2000 / 110540);                     // home: the first 2 km
const round = D.decode(D.encode(plain));
const path = D.lineSvg(plain, 200, 96);
const xy = path.match(/[\d.]+ [\d.]+/g).map((p) => p.split(' ').map(Number));
console.log(JSON.stringify({
  n: plain.length, first: plain[0][0], last: plain[plain.length - 1][0],
  zonedFirst: zoned[0][0], short: D.trimLine(lat.slice(0, 150), lon.slice(0, 150)),
  roundOk: round.length === plain.length && round.every((p, i) => Math.abs(p[0] - plain[i][0]) < 1e-5),
  inBox: xy.every(([x, y]) => x >= 0 && x <= 200 && y >= 0 && y <= 96),
  facts: D.facts({ length_m: 32000, roads: ['A', 'B', 'C', 'D'] }, (m) => (m / 1000).toFixed(1) + ' km'),
  factsNone: D.facts({ length_m: null, roads: [] }, String),
  mentions: [D.mentionParts('@sam nice, and you@bob? @cara!'), D.mentionParts('no one here'), D.mentionParts('@ab @toolonghandle_toolong x')],
  at: [D.mentionAt('hey @Sa', 7), D.mentionAt('hey @', 5), D.mentionAt('mail x@y', 8), D.mentionAt('@sam done', 9), D.mentionAt('@bo and', 3)],
  sug: [D.suggest('c', ['cara', 'Cara', 'carl', 'me', 'cy', 'ce', 'cz'], 'me'), D.suggest('', ['bob', 'me', null], 'me')],
  kl: [D.kudosLine(['bob'], 1), D.kudosLine(['bob', 'cara'], 2), D.kudosLine(['bob', 'cara', 'dan'], 5), D.kudosLine(['bob', 'cara', 'dan'], 3), D.kudosLine([], 4)],
  ago: [D.ago('2026-11-13 12:00:00', Date.parse('2026-11-13T12:01:00Z')), D.ago('2026-11-13 12:00:00', Date.parse('2026-11-13T15:00:00Z'))],
}));
"""


def run():
    out = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_line_loses_both_ends_and_zones():
    r = run()
    assert r["n"] <= 600
    assert r["first"] > 35 + 495 / 110540 and r["last"] < 35 + (10000 - 495) / 110540
    assert r["zonedFirst"] > 35 + 2495 / 110540        # out of the zone, then 500 m more
    assert r["short"] is None                           # 750 m: nothing left to show


def test_codec_svg_and_facts():
    r = run()
    assert r["roundOk"] and r["inBox"]
    assert r["facts"] == "32.0 km · A, B +2"
    assert r["factsNone"] == ""
    assert r["ago"] == ["just now", "3 h"]


def test_mentions_bold_handles_only():
    m = run()["mentions"]
    assert m[0] == [[True, "@sam"], [False, " nice, and you@bob? "], [True, "@cara"], [False, "!"]]   # an email-ish "you@bob" isn't one
    assert m[1] == [[False, "no one here"]]
    assert m[2] == [[False, "@ab @toolonghandle_toolong x"]]                                          # too short, too long


def test_mention_suggestions():
    r = run()
    assert r["at"] == [{"start": 4, "q": "sa"}, {"start": 4, "q": ""}, None, None, {"start": 0, "q": "bo"}]
    assert r["sug"] == [["cara", "carl", "cy", "ce"], ["bob"]]


def test_kudos_line():
    assert run()["kl"] == ["Kudos from @bob", "Kudos from @bob and @cara", "Kudos from @bob, @cara and 3 others", "Kudos from @bob, @cara and 1 other", ""]
