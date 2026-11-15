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
  // the ghost on the map (D-04): where the tracker puts it when you reach the middle of the stage
  const mid = seen.find((r) => r.q > 0.5), at = mid ? tr2(speed) : null;
  return { says: seen.filter((r) => r.say).map((r) => [r.state, Math.round(r.gap * 10) / 10]), done: seen.filter((r) => r.state === 'done'), mid, ghostMid: at };
}
function tr2(speed) {                                           // a fresh pass, stopped at the stage's middle
  const tr = G.createTracker([{ stage, who: 'sam', splits: sp, time_s: 50 }]), rows = [];
  let t = 0, r = null;
  for (let i = 0; i <= 110; i++) { rows.push({ lat: lat[i], lon: lon[i], t_s: t }); t += 5 / speed; r = tr.update(rows) || r; }
  const p = tr.ghostAt(r.elapsed_s);
  return { elapsed: r.elapsed_s, ahead_m: p ? (p[0] - lat[110]) * 110540 : null, off: tr.ghostAt(null) };
}
const back = G.createTracker([{ stage, who: 'sam', splits: sp, time_s: 50 }]), brows = [];
let anyBack = false; for (let i = 220; i >= 0; i--) { brows.push({ lat: lat[i], lon: lon[i], t_s: (220 - i) * 0.25 }); if (back.update(brows)) anyBack = true; }
console.log(JSON.stringify({
  n: fine.length, first: fine[0], last: fine[fine.length - 1], counts: [G.countFor(30), G.countFor(1000), G.countFor(20000)], cuts, sp,
  t: [G.timeAt(sp, 0), G.timeAt(sp, 0.5), G.timeAt(sp, 1)], gap: G.gapAt(sp, 0.5, 26.2),
  q: [G.qAt(sp, -1), G.qAt(sp, 0), G.qAt(sp, 25), G.qAt(sp, 50), G.qAt(sp, 80), G.qAt(null, 3)],
  inverse: [0.1, 0.33, 0.77].map((x) => G.qAt(sp, G.timeAt(sp, x))),
  pt: [G.pointAt(stage.geom, 0), G.pointAt(stage.geom, 0.5), G.pointAt(stage.geom, 1), G.pointAt(null, 0.5)],
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


KEY_RUNNER = r"""
const G = require(process.argv[1] + '/web/ghost_duel.js');
console.log(JSON.stringify({
  key: [[1.4, 'sam', false], [-2, '@sam', false], [0, 'sam', false], [1, 'sam', true], [null, 'sam', false], [1, '', false]].map((a) => G.challengeKey(...a)),
  said: [201, 409, 429, 404, 0].map((s) => G.challengeSaid(s, 'sam', 'Dry Ridge')),
}));
"""


def test_challenge_back_key():
    """The drive page's key under a ghost result: Challenge back when they were quicker, a dare when you were; none in a duel."""
    r = json.loads(subprocess.run([NODE, "-e", KEY_RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["key"] == ["Challenge @sam back", "Dare @sam to beat it", "Dare @sam to beat it", None, None, None]
    assert r["said"][0] == "Sent. @sam has 7 days on Dry Ridge once they say yes."
    assert r["said"][1] == "You and @sam already have a duel on Dry Ridge."
    assert r["said"][2] == "That’s enough duels for now."
    assert r["said"][3].startswith("@sam isn’t your friend")
    assert r["said"][4] == "Couldn’t send it. Try again."


def test_the_ghost_on_the_map_goes_at_its_splits_pace(out):
    """D-04: the ghost marker. qAt is timeAt's inverse; between two splits it goes evenly, so the map tells no more than
    the splits (corner to corner times) already do; pointAt places it along the stage's line by length."""
    assert out["q"][:5] == [0, 0, pytest.approx(0.5, abs=0.01), 1, 1] and out["q"][5] is None
    assert out["inverse"] == [pytest.approx(x, abs=1e-6) for x in (0.1, 0.33, 0.77)]
    p0, p5, p1, none = out["pt"]
    assert none is None and p0[0] == pytest.approx(39.0 + 50 / 110540) and p1[0] == pytest.approx(39.0 + 1050 / 110540)
    assert p5[0] == pytest.approx(39.0 + 550 / 110540, abs=1e-7)          # half its 1000 m, past the bend in its line


def test_the_ghost_is_where_your_friend_was_at_this_moment(out):
    same, slow = out["same"]["ghostMid"], out["slow"]["ghostMid"]
    assert abs(same["ahead_m"]) < 6                                       # at their pace: beside you
    assert slow["ahead_m"] > 100                                         # 16 m/s against their 20: they are well up the road
    assert same["off"] is None


OWN_RUNNER = r"""
const R = process.argv[1];
const Core = require(R + '/web/apex_core.js'), G = require(R + '/web/ghost_duel.js');
const lat = [], lon = []; for (let i = 0; i <= 220; i++) { lat.push(39.0 + i * 5 / 110540); lon.push(-84.5); }
const pass = (mps) => G.splitsOf(Core, { speed_mps: lat.map(() => mps) }, 10, 210);
const p = (mps, surface) => ({ time_s: 1000 / mps, splits: pass(mps), surface });
const passes = [p(20, null), p(25, 'wet'), p(18, 'dry'), { time_s: 30, splits: null, surface: null }, p(40, 'ice')];
const stage = { id: 's1', name: 'Dry Ridge', start: [lat[10], lon[10]], end: [lat[210], lon[210]], length_m: 1000, geom: [[lat[10], lon[10]], [lat[210], lon[210]]] };
const best = G.bestOwn(passes);
// a live pass at 16 m/s against your own best (20 m/s): the tracker says it is yours
const tr = G.createTracker([{ stage, who: 'you', self: true, splits: best.splits, time_s: best.time_s }]), rows = [], seen = [];
let t = 0; for (let i = 0; i <= 220; i++) { rows.push({ lat: lat[i], lon: lon[i], t_s: t }); t += 5 / 16; const r = tr.update(rows); if (r) seen.push(r); }
console.log(JSON.stringify({
  dry: best, wet: G.bestOwn(passes, 'wet'), ice: G.bestOwn(passes, 'ice'), none: [G.bestOwn([]), G.bestOwn(null), G.bestOwn([p(20, 'wet')])],
  n: best.splits.length, selfs: seen.map((r) => r.self), done: seen.filter((r) => r.state === 'done').map((r) => Math.round(r.gap)),
  labels: [G.label(0.31, 'you', true), G.label(-1.24, 'you', true), G.label(0, 'you', true)], spoken: G.spoken(-1.4, 'your best'),
}));
"""


def test_your_own_best_is_a_ghost_on_a_road_like_todays():
    """Your quickest pass of a stage is its ghost on any stage you've driven before: on a dry road the quickest dry or
    unknown-surface pass, on a wet one only a wet pass (a dry best is no ghost for the rain); its splits every 25 m (it
    never leaves your phone), so the marker goes at your own pace down the straights too."""
    r = json.loads(subprocess.run([NODE, "-e", OWN_RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["dry"]["time_s"] == 50 and r["dry"]["surface"] is None and r["n"] == 40        # 20 m/s unknown beats 18 m/s dry; no splits, no ghost
    assert r["wet"]["time_s"] == 40 and r["wet"]["surface"] == "wet" and r["ice"]["time_s"] == 25
    assert r["dry"]["pass"]["time_s"] == 50 and r["dry"]["pass"]["surface"] is None   # which pass it is (the drive page dates it)
    assert r["none"] == [None, None, None]
    assert r["selfs"] and all(r["selfs"]) and r["done"] == [13]                              # 62.5 s against 50: 12.5 down (rounded up)
    assert r["labels"] == ["+0.3 s vs your best", "−1.2 s vs your best", "level with your best"]
    assert r["spoken"] == "1.4 seconds up on your best."


WORST_RUNNER = r"""
const R = process.argv[1];
const Core = require(R + '/web/apex_core.js'), G = require(R + '/web/ghost_duel.js');
const lat = [], lon = []; for (let i = 0; i <= 220; i++) { lat.push(39.0 + i * 5 / 110540); lon.push(-84.5); }
const d = { speed_mps: lat.map(() => 20) };
const sp = G.splitsOf(Core, d, 10, 210, G.cutsOf(10, 210, [12, 40, 50, 70, 120, 205]));   // cut at 15 %, 30 %, 55 %, the finish
const stage = { id: 's1', name: 'Dry Ridge', start: [lat[10], lon[10]], end: [lat[210], lon[210]], length_m: 1000, geom: [[lat[10], lon[10]], [lat[210], lon[210]]] };
function finish(slow) {                                      // the ghost's pace, but 10 m/s over bins slow[0]..slow[1]
  const tr = G.createTracker([{ stage, who: 'sam', splits: sp, time_s: 50 }]), rows = [];
  let t = 0, done = null;
  for (let i = 0; i <= 220; i++) { rows.push({ lat: lat[i], lon: lon[i], t_s: t }); t += 5 / (i >= slow[0] && i < slow[1] ? 10 : 20);
    const r = tr.update(rows); if (r && r.state === 'done') done = r; }
  return done && { gap: Math.round(done.gap * 10) / 10, worst: done.worst, said: G.worstSaid(done.worst) };
}
console.log(JSON.stringify({
  middle: finish([95, 115]), early: finish([20, 40]), late: finish([150, 170]), none: finish([0, 0]),
  said: [G.worstSaid({ k: 2, of: 4, a: 0.7, b: 0.9 }), G.worstSaid(null)],
  gap: G.worstOf([{ t_s: 0 }, { t_s: null }, { t_s: 2 }], 0, 2, 0, [[0.5, 1], [1, 2]]),
}));
"""


def test_where_a_stage_was_lost():
    """At the finish, down on the ghost: the stretch between its corner cuts that cost most (0.3 s or more), said by where
    it is on the stage (early on, in the middle, late on, the run to the finish), never a corner number the road doesn't have."""
    r = json.loads(subprocess.run([NODE, "-e", WORST_RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["middle"]["gap"] == pytest.approx(5, abs=0.3) and r["middle"]["worst"]["k"] == 3 and r["middle"]["worst"]["of"] == 4
    assert r["middle"]["worst"]["gap_s"] == pytest.approx(5, abs=0.3) and r["middle"]["said"] == "Most of it in the middle."
    assert r["early"]["worst"]["k"] == 1 and r["early"]["said"] == "Most of it early on."
    assert r["late"]["worst"]["k"] == 4 and r["late"]["said"] == "Most of it in the run to the finish."
    assert r["none"]["worst"] is None and r["none"]["said"] is None                          # level: nothing lost anywhere
    assert r["said"] == ["Most of it late on.", None]
    assert r["gap"] is None                                                                  # a gap in the clock: no answer
