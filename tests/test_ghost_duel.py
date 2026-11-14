"""Live ghost duels (web/ghost_duel.js, IDEAS D-04): a friend's shared splits on your stage as a ghost. Splits come from the
drive's own clock; the gap is your elapsed time less the ghost's at the same point; the tracker follows a live pass from
the stage's start (heading its way) to its finish, and says how it stands half way and at the finish."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1];
const Core = require(R + '/web/apex_core.js'), G = require(R + '/web/ghost_duel.js');
// a straight 1 km stage north, 200 bins of 5 m
const lat = [], lon = []; for (let i = 0; i <= 220; i++) { lat.push(39.0 + i * 5 / 110540); lon.push(-84.5); }
const v = lat.map(() => 20);                                   // 20 m/s: 0.25 s a bin
const d = { speed_mps: v };
const fine = G.splitsOf(Core, d, 10, 210);                     // your own pass: 1000 m, 40 even cuts, 50 s
const cuts = G.cutsOf(10, 210, [12, 40, 50, 70, 120, 205]);     // apexes: too near the start, 140 m, too near, 300 m, 550 m, too near the finish
const sp = G.splitsOf(Core, d, 10, 210, cuts);
const stage = { id: 's1', name: 'Dry Ridge', start: [lat[10], lon[10]], end: [lat[210], lon[210]], length_m: 1000, geom: [[lat[10], lon[10]], [lat[60], lon[60]], [lat[210], lon[210]]] };
function live(speed) {                                          // rows at `speed` m/s with their own clock
  const tr = G.createTracker([{ stage, who: 'sam', splits: sp, time_s: 50 }]), rows = [], seen = [];
  let t = 0;
  for (let i = 0; i <= 220; i++) { rows.push({ lat: lat[i], lon: lon[i], t_s: t }); t += 5 / speed;
    const r = tr.update(rows); if (r) seen.push(r); }
  return { says: seen.filter((r) => r.say).map((r) => [r.state, Math.round(r.gap * 10) / 10]), done: seen.filter((r) => r.state === 'done'), mid: seen.find((r) => r.q > 0.5) };
}
const back = G.createTracker([{ stage, who: 'sam', splits: sp, time_s: 50 }]), brows = [];
let anyBack = false; for (let i = 220; i >= 0; i--) { brows.push({ lat: lat[i], lon: lon[i], t_s: (220 - i) * 0.25 }); if (back.update(brows)) anyBack = true; }
console.log(JSON.stringify({
  n: fine.length, first: fine[0], last: fine[fine.length - 1], counts: [G.countFor(30), G.countFor(1000), G.countFor(20000)], cuts, sp,
  t: [G.timeAt(sp, 0), G.timeAt(sp, 0.5), G.timeAt(sp, 1)], gap: G.gapAt(sp, 0.5, 26.2),
  same: live(20), slow: live(16), backwards: anyBack,
  corners: G.cornerSplits(fine.map(([q, t]) => [q, t * 1.1]), sp),
  standout: G.standout([{ k: 1, gap_s: 0.5 }, { k: 2, gap_s: -1.2 }, { k: 3, gap_s: 0.02 }, { k: 4, gap_s: 2 }, { k: 5, gap_s: 0.3 }, { k: 6, gap_s: 0.1 }], 2),
  labels: [G.label(0.31, 'sam'), G.label(-1.24, '@sam'), G.label(0.01, 'sam'), G.label(null, 'sam')],
  spoken: [G.spoken(0.3, 'sam'), G.spoken(-1.4, '@sam'), G.spoken(0, 'sam'), G.spoken(null, 'sam')],
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_splits_from_the_drive_clock(out):
    assert out["n"] == 40 and out["first"][0] == 0.025 and out["first"][1] == pytest.approx(1.25, abs=0.06) and out["last"] == [1, 50]
    assert out["counts"] == [2, 40, 200]
    assert out["t"][0] == 0 and out["t"][1] == pytest.approx(25, abs=0.1) and out["t"][2] == pytest.approx(50, abs=0.1)
    assert out["gap"] == pytest.approx(1.2, abs=0.1)


def test_level_with_the_ghost_at_its_own_pace(out):
    s = out["same"]
    assert [st for st, _ in s["says"]] == ["in", "done"] and all(abs(g) <= 0.3 for _, g in s["says"])
    assert len(s["done"]) == 1 and s["done"][0]["time_s"] == pytest.approx(50, abs=0.6)


def test_slower_falls_behind_and_says_so(out):
    s = out["slow"]
    gaps = [g for _, g in s["says"]]
    assert gaps == sorted(gaps) and gaps[0] > 5 and s["done"][0]["gap"] == pytest.approx(12.5, abs=0.7)
    assert s["mid"]["gap"] > 0


def test_the_wrong_way_is_no_duel(out):
    assert out["backwards"] is False


def test_a_shared_run_is_cut_at_its_corners_only(out):
    # apexes 100 m from the start, the finish and each other at least: never the straight between two cuts on its own
    assert out["cuts"] == [0.15, 0.3, 0.55, 1]
    assert out["sp"] == [[0.15, 7.5], [0.3, 15], [0.55, 27.5], [1, 50]]


def test_corner_splits_and_words(out):
    c = out["corners"]
    assert [r["k"] for r in c["rows"]] == [1, 2, 3, 4] and c["total"] == pytest.approx(5, abs=0.1)
    assert c["rows"][0] == {"k": 1, "a": 0, "b": 0.15, "mine_s": 8.25, "ghost_s": 7.5, "gap_s": 0.75}
    assert out["labels"] == ["+0.3 s vs @sam", "−1.2 s vs @sam", "level with @sam", "--"]
    assert out["spoken"] == ["0.3 seconds down on sam.", "1.4 seconds up on sam.", "Level with sam.", None]


def test_what_decided_it(out):
    st = out["standout"]
    assert [r["k"] for r in st["lost"]] == [4, 1] and [r["k"] for r in st["gained"]] == [2]
