"""The Log's coach (web/log_coach.js, Nate 2026-11-16): the news from your drives, why, the trend, what to work on next.

Never sycophantic: "best" only above every earlier drive, "rougher" said as plainly as "cleaner", a part named only beyond
its own drive-to-drive spread, and nothing from fewer than three scored drives.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = Path(__file__).resolve().parents[1]

SCRIPT = r"""
const L = require('./web/log_coach.js'), P = require('./web/driver_profile.js');
const words = { ...P.WORDS, sideWords: P.sideWords };
const NOW = Date.parse('2026-11-16T12:00');
const day = (n) => new Date(NOW - n * 864e5).toISOString().slice(0, 16);
const drive = (id, n, score, c = {}) => ({ id, date: day(n), ds: { score, components: { smoothness: 0.6, braking: 0.9, consistency: 0.6, pace: 0.7, ...c } } });
const base = [drive('a', 9, 640), drive('b', 8, 650, { consistency: 0.62 }), drive('c', 7, 660, { consistency: 0.58 }), drive('d', 6, 655)];
const b = (ds, prof = null, now = NOW) => L.brief(ds, prof, words, now);
const out = {
  few: b(base.slice(0, 2)),
  best: b([...base, drive('e', 1, 700, { smoothness: 0.75 })]),
  tie: b([...base, drive('e', 1, 660)]),
  rougher: b([...base, drive('e', 1, 590, { braking: 0.7 })]),
  cleaner: b([drive('x', 10, 720), ...base, drive('e', 1, 700, { smoothness: 0.75 })]),
  usual: b([...base, drive('e', 1, 652)]),
  noisy: b([drive('a', 9, 640, { consistency: 0.2 }), drive('b', 8, 650, { consistency: 0.7 }), drive('c', 7, 660, { consistency: 0.4 }), drive('d', 6, 655, { consistency: 0.9 }), drive('e', 1, 652, { consistency: 0.45 })]),
  partBest: b([...base, drive('e', 1, 655, { braking: 0.99 })]),
  stale: b([drive('a', 60, 600), drive('b', 59, 610), drive('c', 58, 605), drive('d', 40, 680), drive('e', 39, 690), drive('f', 38, 700, { braking: 0.9 }), drive('g', 30, 690)].slice(0, 7)),
  focus: b([...base, drive('e', 1, 652)], { focus: { skill: 'line', where: { split: 'size', worse: 'tight' } } }),
  unscoredLast: b([...base, { id: 'z', date: day(0), ds: { score: null } }]).go,
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", SCRIPT], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_too_few_drives_say_nothing(out):
    assert all(v is None for v in out["few"].values())


def test_a_best_drive_is_only_one_above_every_earlier_drive(out):
    b = out["best"]
    assert b["kind"] == "best" and b["go"] == "e" and b["headline"].startswith("Your best drive yet on Nov ")
    assert b["why"].startswith("700, 40 above your previous best.") and "Smoothness carried it: 75 out of 100 (usually 60)." in b["why"]
    assert out["tie"]["kind"] == "usual"                     # level with the best is not a new best


def test_a_rough_drive_is_said_as_plainly_as_a_clean_one(out):
    r = out["rougher"]
    assert r["kind"] == "rougher" and r["headline"] == "Your latest drive was rougher than usual"
    assert "against your usual 650. Braking is where it went: 70 out of 100 (usually 90)." in r["why"]
    c = out["cleaner"]
    assert c["kind"] == "cleaner" and c["headline"] == "Your latest drive was one of your cleanest"
    assert "Smoothness made the difference" in c["why"]


def test_a_usual_drive_is_called_one_and_no_noise_is_named(out):
    u = out["usual"]
    assert u["kind"] == "usual" and u["headline"].startswith("A typical drive for you on Nov ") and u["why"] == "652, against your usual 650."
    assert out["noisy"]["why"] == "652, against your usual 650."   # rhythm swings this much drive to drive: not a reason
    assert out["usual"]["trend"] is None                     # a steady trend is the headline's "usual", not said twice


def test_a_part_at_its_best_is_news_on_a_usual_score(out):
    p = out["partBest"]
    assert p["kind"] == "part_best" and p["headline"] == "Your braking was the best it has been"
    assert p["why"].startswith("99 out of 100 (usually 90) on Nov ")


def test_an_old_latest_drive_leaves_the_trend_as_the_news(out):
    s = out["stale"]
    assert s["kind"] == "trend" and s["go"] is None and s["headline"] == "Your driving is getting cleaner"
    assert s["why"].startswith("Your Score is climbing: about 610 to about 690 over your last 6 drives.")


def test_next_is_the_profile_focus_where_it_shows_most(out):
    assert out["focus"]["next"].startswith("Next drive, work on patient apex: stay slow a little longer")
    assert out["focus"]["next"].endswith("It shows most in tight corners.")
    assert out["usual"]["next"] == "Next drive, work on smoothness: build cornering load gently: squeeze the wheel in, don’t snap it."


def test_an_unscored_latest_drive_is_not_the_news(out):
    assert out["unscoredLast"] == "d"
