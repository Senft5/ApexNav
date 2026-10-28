"""Big-target in-car mode (web/in_car.js): when the car counts as moving, and which fields open the keyboard."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const C = require(process.argv[1]);
const out = {};
// Feed (speed, from s, to s) runs at 1 Hz and record the state after each sample.
function run(steps) {
  const g = new C.MotionGate(), log = [];
  for (const [v, a, b] of steps) for (let s = a; s <= b; s++) { g.update(v, s * 1000); log.push(g.moving ? 1 : 0); }
  return { log, g };
}
out.pullAway = run([[0, 0, 4], [10, 5, 12]]).log;                 // moving 3 s after passing 10 mph
out.blip = run([[0, 0, 2], [10, 3, 4], [0, 5, 10]]).log;           // 2 s of speed: a GPS blip, never moving
out.crawl = run([[10, 0, 5], [2, 6, 20]]).log;                    // traffic crawl at 2 m/s stays moving
out.stop = run([[10, 0, 5], [0.5, 6, 14]]).log;                   // stopped after 5 s below 1.5 m/s
out.unknown = run([[null, 0, 30]]).log;                           // no speed at all: never moving
const g = run([[10, 0, 5]]).g;
out.staleAt = [g.tick(10000), g.moving, g.tick(15000), g.moving];   // last speed at 5 s: stale at 15 s
out.badClock = new C.MotionGate().update(20, NaN);
const sparse = new C.MotionGate(); sparse.update(6, 0); sparse.update(null, 1000); sparse.update(6, 60000);
out.sparse = sparse.moving;                                         // two readings a minute apart: not 3 s of driving
const ticked = new C.MotionGate();                                  // 1 Hz samples with the page's 2 s tick in between
for (let s = 0; s <= 4; s++) { ticked.update(10, s * 1000); ticked.tick(s * 1000 + 500); }
out.ticked = ticked.moving;
const el = (tag, extra = {}) => ({ tagName: tag, ...extra });
out.keyboard = [el('INPUT', { type: 'text' }), el('INPUT', { type: 'search' }), el('TEXTAREA'), el('INPUT', { type: 'checkbox' }),
                el('INPUT', { type: 'range' }), el('INPUT', { type: 'text', readOnly: true }), el('BUTTON'), el('DIV', { isContentEditable: true }),
                null].map(C.opensKeyboard);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    out = subprocess.run([NODE, "-e", RUNNER, os.path.abspath("web/in_car.js")], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_moving_needs_three_seconds_over_10_mph(r):
    assert r["pullAway"] == [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
    assert 1 not in r["blip"], "a 2 s speed blip never flips the UI"


def test_stays_moving_in_a_crawl_and_stops_after_five_seconds(r):
    assert all(r["crawl"][3:]), "2 m/s in traffic is still driving"
    assert r["stop"][3:11] == [1] * 8 and r["stop"][-1] == 0 and r["stop"].index(0, 3) == 11


def test_unknown_speed_never_turns_it_on_and_goes_stale(r):
    assert 1 not in r["unknown"]
    assert r["staleAt"] == [False, True, True, False]
    assert r["badClock"] is False
    assert r["sparse"] is False, "the 3 s must be unbroken"
    assert r["ticked"] is True, "the timer tick between samples does not reset the count"


def test_only_text_fields_open_the_keyboard(r):
    assert r["keyboard"] == [True, True, True, False, False, False, False, True, False]
