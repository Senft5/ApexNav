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
  wk: [D.weekLine({ drives: 2, length_m: 45000, best: 790 }, (m) => (m / 1000).toFixed(0) + ' km'), D.weekLine({ drives: 1, length_m: 0, best: null }, String),
    D.weekShown([{ you: true }]), D.weekShown([{ you: true }, { you: false }]), D.weekShown(null)],
  kl: [D.kudosLine(['bob'], 1), D.kudosLine(['bob', 'cara'], 2), D.kudosLine(['bob', 'cara', 'dan'], 5), D.kudosLine(['bob', 'cara', 'dan'], 3), D.kudosLine([], 4)],
  rivals: (() => { const L = Array.from({ length: 100 }, (_, i) => [35 + i * 0.001, -84]), p = { line: D.encode(L), stages: [
      { name: 'A', score: 801, ends: [L[10][0], L[10][1], L[60][0], L[60][1]] }, { name: 'B', score: null, ends: [L[60][0], L[60][1], L[90][0], L[90][1]] },
      { name: 'C', score: 700 }, { name: 'D', score: 650, ends: [36, -84, 36.1, -84] }, { name: 'E', score: 640, ends: [L[60][0], L[60][1], L[90][0], L[90][1]] }] };
    return { all: D.rivalsOf(p).map((r) => [r.name, r.length_m]), one: D.rivalsOf(p, 4).map((r) => r.name), none: D.rivalsOf({ stages: p.stages }) }; })(),
  rl: [D.rivalLine([{ name: 'A', you: 780, them: 801 }], { handle: 'bob' }), D.rivalLine([{ name: 'A', you: 830.4, them: 801 }, { name: 'B', you: 700, them: 700 }, { name: 'C', you: 1, them: 2 }], { mine: true }),
    D.rivalLine([{ name: 'A', you: null, them: 801 }], { handle: 'bob' })],
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


def test_week_line():
    """This week on the Feed: how far, how many drives, the best Score when known; shown once a friend posted."""
    assert run()["wk"] == ["45 km · 2 drives · best 790", "1 drive", False, True, False]


def test_kudos_line():
    assert run()["kl"] == ["Kudos from @bob", "Kudos from @bob and @cara", "Kudos from @bob, @cara and 3 others", "Kudos from @bob, @cara and 1 other", ""]


def test_rivals_and_the_end_card_line():
    r = run()
    # stages with a Score and ends on the line, each with its length along it (about 50 x 111 m); B has no Score, C no
    # ends, D ends off the line
    assert [n for n, _ in r["rivals"]["all"]] == ["A", "E"]
    assert 5400 < r["rivals"]["all"][0][1] < 5700
    assert r["rivals"]["one"] == ["E"] and r["rivals"]["none"] == []
    assert r["rl"][0] == "A: 780, 21 under @bob's 801."
    assert r["rl"][1] == "A: 830, 29 over your posted 801. B: 700, level with your posted 700."
    assert r["rl"][2] == ""
