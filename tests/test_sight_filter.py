"""The sight-line speed as the plate holds it (web/carplay.js sightFilter, docs/design/REVIEW4.md U-60): steps of 5 mph
(10 km/h), a new value only once it has held 2 s, red only after 3 s faster than it, no plate under 5 mph, OPEN past the
limit by 15 mph, and unknown hides at once."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/carplay.js');
// feed one reading every 100 ms; return what the plate says after each
const run = (readings, unit = 'mph') => { const f = C.sightFilter(); return readings.map((r, i) => { const o = f.step({ unit, ...r }, i * 100); return { text: o.msg.text, short: o.msg.short, value: o.value, open: o.open }; }); };
const rep = (n, r) => Array.from({ length: n }, () => r);
// the recording's interstate: a steady 70 in a 65 while the raw value jumps every few samples
const noisy = [67, 55, 97, 88, 124, 89, 83, 122, 81, 83, 91, 79, 67, 104, 90].flatMap((s) => rep(5, { sight: s, speed: 70, limit: 65 }));
console.log(JSON.stringify({
  first: run([{ sight: 67.4, speed: 40 }])[0],
  noisy: run(noisy).map((o) => o.text + (o.short ? '!' : '')),
  step: run([...rep(5, { sight: 52, speed: 40 }), ...rep(25, { sight: 63, speed: 40 })]).map((o) => o.text),
  jitter: run([...rep(5, { sight: 60.5, speed: 40 }), ...Array.from({ length: 60 }, (_, i) => ({ sight: i % 2 ? 59.8 : 60.4, speed: 40 }))]).map((o) => o.text),
  red: run(rep(40, { sight: 47, speed: 56 })).map((o) => o.short),
  redBreak: run([...rep(25, { sight: 47, speed: 56 }), { sight: 47, speed: 40 }, ...rep(25, { sight: 47, speed: 56 })]).map((o) => o.short),
  underShown: run(rep(40, { sight: 54.9, speed: 51 })).map((o) => o.short),
  slow: run([{ sight: 40, speed: 3 }, { sight: 40, speed: 4.9 }, { sight: 40, speed: 5 }]),
  open: run([...rep(5, { sight: 82, speed: 50, limit: 65 }), ...rep(25, { sight: 75, speed: 50, limit: 65 })]).map((o) => o.text),
  openCap: run([{ sight: 125, open: true, speed: 60 }])[0],
  unknown: run([{ sight: 60, speed: 50 }, { sight: null, speed: 50 }, { sight: 40, speed: 30 }]),
  kmh: run([{ sight: 97, speed: 60 }, { sight: 120, speed: 60, limit: 90 }, ...rep(25, { sight: 120, speed: 60, limit: 90 }), { sight: 90, speed: 7 }], 'km/h').map((o) => o.text),
}));
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_first_value_shows_at_once_in_a_step_down(out):
    assert out["first"] == {"text": "65", "short": False, "value": 65, "open": False}


def test_the_interstate_holds_still(out):
    # the recording's numbers, each for half a second: the plate changes once, to OPEN when every reading for 2 s cleared
    # the limit by 15, and the half-second dips to 79 and 67 after it never knock it down; never red at 70 in a 65 (each
    # spell of "faster than the sight line" is broken well before 3 s)
    t = out["noisy"]
    changes = [t[i] for i in range(1, len(t)) if t[i] != t[i - 1]]
    assert t[0] == "65" and changes == ["OPEN"], t
    assert t.index("OPEN") >= 25            # 2 s of readings above it first


def test_a_new_step_after_two_seconds(out):
    s = out["step"]
    assert s[:5] == ["50"] * 5
    assert s[5:24] == ["50"] * 19          # 63 for under 2 s: still 50
    assert s[-1] == "60"


def test_jitter_at_a_step_edge_never_flips(out):
    assert set(out["jitter"]) == {"60"}


def test_red_only_after_three_seconds(out):
    red = out["red"]
    assert not any(red[:30]) and all(red[30:]), red
    rb = out["redBreak"]
    assert not any(rb[:26]) and not any(rb[26:56])   # one sample under it starts the three seconds over


def test_never_red_under_the_figure_shown(out):
    # 51 against a plate of 50 is faster than the plate but not than the sight line (54.9): no alarm
    assert not any(out["underShown"])


def test_no_plate_when_crawling(out):
    a, b, c = out["slow"]
    assert a["text"] is None and b["text"] is None and a["value"] == 40     # the cell still has the held value
    assert c["text"] == "40"


def test_open_past_the_limit_by_a_margin(out):
    o = out["open"]
    assert o[0] == "OPEN"                   # 82 clears 65 + 15
    assert o[5:24] == ["OPEN"] * 19 and o[-1] == "75"
    assert out["openCap"] == {"text": "OPEN", "short": False, "value": None, "open": True}


def test_unknown_hides_and_starts_over(out):
    a, n, b = out["unknown"]
    assert a["text"] == "60" and n["text"] is None and n["value"] is None
    assert b["text"] == "40"                # no hold carried across the gap


def test_metric_steps(out):
    k = out["kmh"]
    assert k[0] == "90" and k[1] == "90"    # 10 km/h steps; 120 clears 90 + 25 only once held
    assert k[-2] == "OPEN" and k[-1] is None   # under 8 km/h: no plate
