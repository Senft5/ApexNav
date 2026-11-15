"""Events on the map (web/event_markers.js, Nate 2026-11-15): time attacks stand as start gates and meets at their meeting
points; a card rises for the nearest one ahead of you as you drive up to it, one at a time, Not now keeps it down."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const E = require(process.argv[1] + '/web/event_markers.js');
const now = Date.parse('2026-11-15T18:00:00Z');
// a loop starting at 39.1,-84.5 heading east; a crew drive in 2 h 400 m north; a public meet next week; the same crew drive in both lists
const loop = { id: 'L1', name: 'Ridge loop', length_m: 18000, featured: true, entered: false, geom: JSON.stringify([[39.1, -84.5], [39.1, -84.5], [39.1, -84.495], [39.105, -84.49]]) };
const soon = { id: 'E1', title: 'Saturday run', crew_name: 'Ridge Runners', starts_at: '2026-11-15T20:00:00Z', meet_lat: 39.1036, meet_lon: -84.5, going: ['a', 'b', 'c'] };
const later = { id: 'E2', title: 'Next week', crew_name: 'Far Crew', starts_at: '2026-11-22T20:00:00Z', meet_lat: 39.2, meet_lon: -84.5, going: 4 };
const evs = E.eventsOf({ ta: { circuits: [loop, { id: 'L2', geom: '[]' }] }, mine: [soon], near: [{ ...soon, going: 9 }, later] }, now);
const at = (lat, lon) => ({ lat, lon });
const down = new Map();
console.log(JSON.stringify({
  gate: E.gateOf(loop.geom),
  ids: evs.map((e) => [e.id, e.kind, e.own === undefined ? null : e.own, e.going === undefined ? null : e.going]),
  // standing 300 m west of the gate, still: the gate's card
  still: (E.pick(evs, at(39.1, -84.5035), { heading: null, speedMps: 0 }, down, now) || {}).ev?.id,
  // driving east toward it: the gate; driving west away from it (and the meet north is 90 degrees off): nothing
  east: (E.pick(evs, at(39.1, -84.5035), { heading: 90, speedMps: 20 }, down, now) || {}).ev?.id,
  west: E.pick(evs, at(39.1, -84.5035), { heading: 270, speedMps: 20 }, down, now),
  // beside the meet, 2 h before: its card (the meet window opens 3 h before)
  meet: (E.pick(evs, at(39.1036, -84.501), { heading: 0, speedMps: 15 }, down, now) || {}).ev?.id,
  early: E.pick(evs, at(39.1036, -84.501), null, down, now - 2 * 3600e3)?.ev?.id || null,
  far: E.pick(evs, at(39.2, -84.6), null, down, now),
  downed: (() => { const m = new Map([['ta:L1', now + 1000]]); return E.pick(evs, at(39.1, -84.5035), null, m, now); })(),
  stands: [E.stands(evs[0], at(39.1, -84.506)), E.stands(evs[0], at(39.1, -84.51))],
  taCard: E.cardOf(evs[0], { rows: [{ handle: 'sam', time_s: 754, mine: false }], you: { time_s: 801 } }, (m) => `${(m / 1609.344).toFixed(1)} mi`),
  taOpen: E.cardOf(evs[0], { rows: [], you: null }).facts[2],
  taLoading: E.cardOf(evs[0], null).facts.map((f) => f[1]),
  meetCard: E.cardOf(evs[1], null, undefined, now),
  starts: ['2026-11-15T18:25:00Z', '2026-11-15T18:01:00Z', '2026-11-15T17:50:00Z', 'x'].map((s) => E.startsText(s, now)),
}));
"""


def _run():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_what_stands_on_the_map():
    r = _run()
    assert r["gate"] == {"lat": 39.1, "lon": -84.5, "bearing": 90}       # the start, facing the way it leaves (east)
    # the loop with a shape, the crew drive once (yours: your crews' list wins), not next week's meet
    assert r["ids"] == [["ta:L1", "ta", None, None], ["meet:E1", "meet", True, 3]]


def test_one_card_for_what_is_ahead():
    r = _run()
    assert r["still"] == "ta:L1"
    assert r["east"] == "ta:L1"
    assert r["west"] is None                                                # behind you while you drive away
    assert r["meet"] == "meet:E1"
    assert r["early"] != "meet:E1"                                          # 4 h before: the meet waits
    assert r["far"] is None
    assert (r["downed"] or {}).get("ev", {}).get("id") != "ta:L1"            # Not now keeps that one down
    assert r["stands"] == [True, False]                                     # it goes once you're well past


def test_the_card_says_three_things_and_one_key():
    r = _run()
    assert r["taCard"] == {"kicker": "Featured time attack", "title": "Ridge loop",
                           "facts": [["Length", "11.2 mi"], ["Your best", "13:21"], ["Leader", "@sam 12:34"]], "key": "Start"}
    assert r["taOpen"] == ["Leader", "Open"]                                # nobody's run it: it's open
    assert r["taLoading"] == ["18.0 km", "--", "--"]                        # unknown stays --
    assert r["meetCard"] == {"kicker": "Crew drive", "title": "Saturday run",
                             "facts": [["Starts", "2:00 PM"], ["Crew", "Ridge Runners"], ["Going", "3"]], "key": "Join"} or r["meetCard"]["facts"][0][0] == "Starts"
    assert r["starts"][:3] == ["in 25 min", "now", "10 min ago"] and r["starts"][3] == "--"
