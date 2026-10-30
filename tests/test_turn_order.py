"""Turn-by-turn in road order around a junction (web/directions.js due/createProgress, web/carplay.js guideMessage).

The owner's drive with CarPlay, 2026-10-30: "It would be like 'take exit 19 in 0.1 miles', then say 'sharp right in 1 mile',
then say 'take exit 19'. This is bad and confusing." The route shape: a motorway, exit 19, a bend on the ramp, and a sharp
right a mile past the exit. The standard is Apple's and Google's: one maneuver at a time in road order, nothing past a
junction until it is taken, a fixed ladder of prompts said once each, and a turn once taken never back on the card."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const D = require(process.argv[1] + '/web/directions.js'), C = require(process.argv[1] + '/web/carplay.js');
// I-75 north, exit 19 at 5 km, a right 2 on the ramp, a sharp right onto Main St a mile past the exit, then arrive
const steps = [{ m: 0, type: 1, street: 'I-75 North' }, { m: 5000, type: 20, exit: '19', toward: 'Downtown', street: 'Exit 19' },
  { m: 6610, type: 11, street: 'Main St' }, { m: 8000, type: 4 }];
const events = [{ type: 'corner', dir: 'L', severity: 4, start_m: 3800, dist_m: 3840, call: 'Left 4' },
  { type: 'corner', dir: 'R', severity: 2, start_m: 5150, dist_m: 5190, call: 'Right 2' }];
const t = { id: 'r', steps, events, dist: [0, 8000] };
function drive(v, jitter) {
  const said = new Set(), heard = [], cards = [], P = D.createProgress();
  for (let m = 2000; m <= 8000; m += 5) {
    // GPS at the diverge: the cursor runs 40 m past the exit, falls 25 m back over it, then on
    const c = jitter && m === 5040 ? 5040 : jitter && m > 5040 && m < 5070 ? 5015 : m;
    const at = P.at(steps, c, t.id);
    for (const l of D.due(steps, c, v, said, t.id, at)) { said.add(l.key); heard.push({ m: c, text: l.text, key: l.key }); }
    const g = C.guideMessage(t, c, null, D.phrase, { speedMps: v, step: at >= 0 ? steps[at] : null });
    if (g && (!cards.length || cards[cards.length - 1].key !== g.key)) cards.push({ m: c, key: g.key, text: g.instruction, distM: g.distM });
  }
  return { heard, cards };
}
// the same drive without the page's tracker (due's own stateless pick)
const bare = (() => { const said = new Set(), heard = [];
  for (let m = 2000; m <= 8000; m += 5) for (const l of D.due(steps, m, 31, said, 'r')) { said.add(l.key); heard.push({ m, text: l.text }); }
  return heard; })();
// the progress: a replay seek back to the start begins it over; a new route too
const P = D.createProgress(), seek = [P.at(steps, 4000, 'r'), P.at(steps, 5100, 'r'), P.at(steps, 5010, 'r'), P.at(steps, 100, 'r'), P.at(steps, 5100, 'other')];
// a turn first seen inside its near rung (the one just after a turn): no far rung, the near one with the real distance
const close = (() => { const said = new Set(), out = []; const s = [{ m: 300, type: 15, street: 'Oak Rd' }];
  for (let m = 100; m <= 320; m += 5) for (const l of D.due(s, m, 20, said, 'c')) { said.add(l.key); out.push(l.text); } return out; })();
// a short ramp (the sharp right 600 m past the exit, inside the old 30 s window): the old code said "In 0.6 miles, take exit
// 19", "In 0.6 miles, sharp right onto Main St", "Take exit 19": the owner's order
const ramp = (() => { const said = new Set(), out = [], s = [{ m: 5000, type: 20, exit: '19' }, { m: 5600, type: 11, street: 'Main St' }];
  for (let m = 3000; m <= 5700; m += 5) for (const l of D.due(s, m, 31, said, 'q')) { said.add(l.key); out.push(l.text); } return out; })();
console.log(JSON.stringify({ hwy: drive(31, false), jit: drive(31, true), city: drive(13, false), bare, seek, close, ramp }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def exit_line(text):
    return "exit 19" in text


def main_line(text):
    return "Main St" in text


@pytest.mark.parametrize("run", ["hwy", "jit", "city"])
def test_nothing_past_the_exit_until_it_is_taken(out, run):
    heard = out[run]["heard"]
    texts = [h["text"] for h in heard]
    last_exit = max(i for i, t in enumerate(texts) if exit_line(t))
    first_main = min(i for i, t in enumerate(texts) if main_line(t))
    assert last_exit < first_main, texts
    assert all(h["m"] > 5000 for h in heard if main_line(h["text"])), heard   # past the exit before Main St is said


@pytest.mark.parametrize("run", ["hwy", "jit", "city"])
def test_each_turn_is_a_ladder_said_once(out, run):
    heard = out[run]["heard"]
    keys = [h["key"] for h in heard]
    assert len(keys) == len(set(keys)), keys
    exit_texts = [h["text"] for h in heard if exit_line(h["text"])]
    main_texts = [h["text"] for h in heard if main_line(h["text"])]
    for ladder, verb in ((exit_texts, "take exit 19 toward Downtown"), (main_texts, "sharp right onto Main St")):
        assert len(ladder) == 3, ladder
        assert ladder[0].startswith("In ") and ladder[0].endswith(verb), ladder
        assert ladder[1].startswith("In ") and ladder[1].endswith(verb), ladder
        assert ladder[2] == verb[0].upper() + verb[1:], ladder
    assert heard[-1]["text"] == "Arriving at your destination"


def test_the_ladder_at_motorway_speed(out):
    at = {h["text"]: h["m"] for h in out["hwy"]["heard"]}
    exits = [t for t in at if exit_line(t)]
    # 70 mph: 30 s out (0.6 mi), 12 s (0.2 mi), 5 s at the turn
    assert exits == ["In 0.6 miles, take exit 19 toward Downtown", "In 0.2 miles, take exit 19 toward Downtown", "Take exit 19 toward Downtown"]
    assert 5000 - 960 <= at[exits[0]] <= 5000 - 900
    assert 5000 - 400 <= at[exits[1]] <= 5000 - 340
    assert 5000 - 160 <= at[exits[2]] <= 5000 - 140


@pytest.mark.parametrize("run", ["hwy", "jit", "city"])
def test_the_card_is_one_maneuver_at_a_time_in_road_order(out, run):
    cards = out[run]["cards"]
    texts = [c["text"] for c in cards]
    # never back to one it has left (the owner's card: exit 19, sharp right, exit 19)
    assert len(texts) == len(set(texts)), texts
    exit_i = texts.index("Take exit 19 toward Downtown")
    main_i = texts.index("Sharp right onto Main St")
    ramp = [i for i, t in enumerate(texts) if t == "Right 2"]
    assert exit_i < main_i and (not ramp or exit_i < ramp[0] < main_i), texts
    assert all(c["m"] > 5000 for c in cards[exit_i + 1:]), cards


def test_the_stateless_pick_is_one_at_a_time_too(out):
    texts = [h["text"] for h in out["bare"]]
    last_exit = max(i for i, t in enumerate(texts) if exit_line(t))
    first_main = min(i for i, t in enumerate(texts) if main_line(t))
    assert last_exit < first_main, texts


def test_progress_latches_and_starts_over(out):
    # 4000: exit pending (1); 5100: taken, Main St (2); a fix back at 5010 keeps it taken; a seek to 100 starts over (1); a
    # new route too
    assert out["seek"] == [1, 2, 2, 1, 2]


def test_a_turn_first_seen_close_gets_the_near_rung_only(out):
    assert out["close"] == ["In 700 feet, turn left onto Oak Rd", "Turn left onto Oak Rd"]


def test_a_short_ramp_never_interleaves(out):
    # every exit prompt, then every Main St prompt (the old order was exit, Main St, exit)
    assert out["ramp"] == ["In 0.6 miles, take exit 19", "In 0.2 miles, take exit 19", "Take exit 19",
                           "In 0.4 miles, sharp right onto Main St", "In 0.2 miles, sharp right onto Main St", "Sharp right onto Main St"]
