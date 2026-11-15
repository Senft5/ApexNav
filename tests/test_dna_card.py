"""Driving DNA card (web/dna_card.js): Your driving's six skills as one picture, only when all six are measured, never pace."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const K = require(process.argv[1] + '/web/dna_card.js');
const sk = (lv) => ({ level: lv, n: 80, se: 2 });
const p = { corners: 212, drives: 14, span: ['2026-09', '2026-11'], strongest: 'arc',
  skills: { squeeze: sk(81), brake: sk(64), arc: sk(92), entry: sk(77), line: sk(58), exit: sk(70), pace: sk(99) },
  change: { arc: { from: '2026-09', to: '2026-11', delta: 9, sure: true }, line: { from: '2026-09', to: '2026-11', delta: 14, sure: true },
            brake: { from: '2026-09', to: '2026-11', delta: -6, sure: true }, exit: { from: '2026-09', to: '2026-11', delta: 20, sure: false } },
  style: { trail_share: 0.62, slow_m: 6, use: 0.8 }, touch: { release: 0.6 },
  matrix: [{ dir: 'L', size: 'tight', levels: { squeeze: 60, arc: 70 } }, { dir: 'R', size: 'fast', levels: { squeeze: 90, arc: 94 } }, { dir: 'L', size: 'medium', levels: {} }] };
const m = K.dnaModel(p);
const part = { ...p, skills: { ...p.skills, line: { level: null, n: 12, se: null } } };
console.log(JSON.stringify({ m, lines: K.dnaLines(m), scope: K.scopeText(m), part: K.dnaModel(part), none: K.dnaModel(null),
  spans: [['2026-11', '2026-11'], ['2025-12', '2026-02'], null].map(K.spanText),
  styles: [K.styleWords({ trail_share: 0.1, slow_m: -4 }, { release: 1.5 }), K.styleWords({ trail_share: 0.3, slow_m: 1 }, { release: 1 }), K.styleWords({}, null)],
  close: K.bySize([{ size: 'tight', levels: { arc: 80 } }, { size: 'fast', levels: { arc: 84 } }]),
  top: K.hexPoint(0, 0, 100, 0, 50).map((x) => Math.round(x)),
  wire: K.wireOf(m), noWire: K.wireOf(null),
  cmp: K.compareLines(K.wireOf(m), { skills: { squeeze: 80, brake: 75, arc: 70, entry: 77, line: 60, exit: 72 } }, '@sam'),
  even: K.compareLines(K.wireOf(m), K.wireOf(m), 'sam'), alone: K.compareLines({ skills: K.wireOf(m).skills, style: [] }, null, 'sam'), noCmp: K.compareLines(null, null, 'sam'),
  crew: K.crewLeaders([{ handle: 'me', mine: true, skills: { squeeze: 80, brake: 75, arc: 70, entry: 77, line: 60, exit: 72 } },
    { handle: 'sam', mine: false, skills: K.wireOf(m).skills }, { handle: 'ann', mine: false, skills: { squeeze: 81, brake: 50, arc: 50, entry: 50, line: 50, exit: 50 } }, { handle: 'x', skills: null }]),
  lone: K.crewLeaders([{ handle: 'me', mine: true, skills: K.wireOf(m).skills }]) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_six_skills_in_the_corners_order_never_pace(out):
    m = out["m"]
    assert [s["key"] for s in m["skills"]] == ["squeeze", "brake", "arc", "entry", "line", "exit"]
    assert [s["level"] for s in m["skills"]] == [81, 64, 92, 77, 58, 70]
    assert "pace" not in json.dumps(m).lower() and "99" not in json.dumps(m["skills"])
    assert [s["trend"] for s in m["skills"]] == [None, "down", "up", None, "up", None]   # an unsure change shows nothing


def test_what_the_card_says(out):
    assert out["m"]["style"] == ["Trail-braker", "Late apex", "Gentle off the brakes"]
    assert out["lines"] == ["Best: One arc 92", "Cleanest in fast corners", "Up since Sep: Patient apex +14, One arc +9"]
    assert out["scope"] == "212 clean corners · 14 drives · Sep – Nov 2026"


def test_only_a_whole_picture(out):
    assert out["part"] is None and out["none"] is None   # a skill not yet measured: no card, never a corner drawn at 0


def test_words_and_spans(out):
    assert out["spans"] == ["Nov 2026", "Dec 2025 – Feb 2026", None]
    assert out["styles"] == [["Brakes before turning", "Early apex", "Sharp off the brakes"], ["Some trail-braking", "Slowest at the apex", "Even on the brakes"], []]
    assert out["close"] is None                         # within a few points: no kind of corner named
    assert out["top"] == [0, -50]                       # the first skill at the top


def test_what_a_friend_sees(out):
    assert out["wire"] == {"skills": {"squeeze": 81, "brake": 64, "arc": 92, "entry": 77, "line": 58, "exit": 70},
                           "style": ["Trail-braker", "Late apex", "Gentle off the brakes"], "size": "fast", "corners": 212, "drives": 14}
    assert out["noWire"] is None


def test_beside_a_friend(out):
    assert out["cmp"] == ["@sam: Trail-braker · Late apex · Gentle off the brakes", "@sam leads at One arc: 92 to your 70", "You lead at Brakes done: 75 to 64"]
    assert out["even"][1] == "Within 5 points of each other at every skill"
    assert out["alone"] == ["Yours shows here once all six of your skills are measured"]
    assert out["noCmp"] == []


def test_cleanest_in_the_crew(out):
    rows = [(r["name"], r["handle"], r["level"], r["you"]) for r in out["crew"]]
    assert rows == [("One braking", "ann", 81, 80), ("Brakes done", "me", 75, None), ("One arc", "sam", 92, 70),
                    ("Entry speed", "me", 77, None), ("Patient apex", "me", 60, None), ("Back to power", "me", 72, None)]
    assert out["lone"] == []
