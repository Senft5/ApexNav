"""Which road was better? (web/road_votes.js, IDEAS S-17): one question per drive and pair, Elo per road, a ranking."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const V = require(process.argv[1] + '/web/road_votes.js');
const m = {}; const st = { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } };
const drives = [{ id: 'a', name: 'Dragon', date: '2026-10-20' }, { id: 'b', name: 'Drive 10/21/2026', date: '2026-10-21' },
  { id: 'c', name: 'Cherohala', date: '2026-10-22' }, { id: 'd', name: 'dragon', date: '2026-10-25' }];
let s = V.load(st);
const q1 = V.question(drives, drives[3], s);                  // newest other road before it: Cherohala
s = V.vote(s, q1, 'Cherohala');
const again = V.question(drives, drives[3], s);              // asked already
const q2 = V.question(drives, drives[2], s);                  // Cherohala vs Dragon (the 20th)
s = V.vote(s, q2, 'Cherohala');
V.save(st, s);
const s2 = V.load(st);
console.log(JSON.stringify({ q1, again, q2, ranking: V.ranking(s2), none: V.question(drives, drives[0], s2), unnamed: V.question(drives, drives[1], s2) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_questions(out):
    assert (out["q1"]["a"], out["q1"]["b"]) == ("dragon", "Cherohala")
    assert out["again"] is None
    assert (out["q2"]["a"], out["q2"]["b"]) == ("Cherohala", "Dragon")
    assert out["none"] is None and out["unnamed"] is None       # no other road before it; an unnamed drive isn't asked


def test_ranking(out):
    assert [r["name"] for r in out["ranking"]] == ["Cherohala", "Dragon"]
    assert out["ranking"][0]["rating"] > 1500 > out["ranking"][1]["rating"]
