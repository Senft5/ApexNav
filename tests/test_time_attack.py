"""Weekly time attack (web/time_attack.js, SOCIAL 2.9): the clock, the gap, the runs the Log sends (quickest this week on a
circuit you entered, never a guess), the local copy of an entered stage, which of your stages can be put up, and the area
point the phone sends instead of where it is."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const T = require(process.argv[1] + '/web/time_attack.js');
const circuits = [{ segment_id: 'C1', cell: '39,-85' }];
const segs = [
  { id: 'mine1', origin: 'C1', synced: true },         // a copy of the circuit
  { id: 'C1x', origin: null, synced: true },            // not the circuit
  { id: 'loc', origin: 'C1', synced: false },           // not backed up yet
];
const passes = {
  mine1: [{ p: { score: 800, time_s: 201.4 }, d: { date: '2026-11-10T09:00:00Z' } },
          { p: { score: 900, time_s: 190.6 }, d: { date: '2026-11-08T09:00:00Z' } },   // quicker, but last week
          { p: { score: 700, time_s: 195.2 }, d: { date: '2026-11-12' } },
          { p: { score: 950, time_s: null }, d: { date: '2026-11-12' } },              // not timed
          { p: { score: null, time_s: 4 }, d: { date: '2026-11-12' } }],               // not a run
  C1x: [{ p: { score: 1, time_s: 50 }, d: { date: '2026-11-10' } }],
  loc: [{ p: { score: 1, time_s: 50 }, d: { date: '2026-11-10' } }],
};
const runs = T.runsToSend(circuits, segs, (s) => passes[s.id], '2026-11-09', '2026-11-15');
const own = [{ id: 'a', synced: true, length_m: 2500 }, { id: 'b', synced: true, length_m: 800 }, { id: 'c', synced: true, length_m: 2500, origin: 'x' },
             { id: 'd', synced: false, length_m: 2500 }, { id: 'e', synced: true, length_m: 30000 }, { id: 'f', synced: true, length_m: 5000 }];
console.log(JSON.stringify({
  clock: [T.clock(75), T.clock(3725), T.clock(9.6), T.clock(null), T.clock(-1)],
  gap: [T.gap(0), T.gap(3), T.gap(null)],
  days: [T.daysLeft('2026-11-13', '2026-11-15'), T.daysLeft('2026-11-15', '2026-11-15'), T.daysLeft('x', '2026-11-15')],
  area: [T.areaPoint({ lat: 39.25, lon: -84.6 }), T.areaPoint({ lat: -33.9, lon: 151.2 }), T.areaPoint(null)],
  runs,
  none: T.runsToSend([], segs, (s) => passes[s.id], '2026-11-09', '2026-11-15'),
  copy: T.localCopy({ segment_id: 'C1', name: 'Dry Ridge', length_m: 2500, geom: '[[39.2,-84.6],[39.21,-84.61],[39.3,-84.5]]' }, 'new1'),
  nocopy: T.localCopy({ segment_id: 'C1', geom: 'oops' }, 'n'),
  putUp: T.canPutUp(own, [{ segment_id: 'f' }]).map((s) => s.id),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_clock_and_gap(out):
    assert out["clock"] == ["1:15", "1:02:05", "0:10", "--", "--"]
    assert out["gap"] == ["", "+0:03", ""]


def test_days_left_counts_today(out):
    assert out["days"] == [3, 1, None]


def test_the_phone_sends_the_area_not_where_it_is(out):
    assert out["area"] == [{"lat": 39.5, "lon": -84.5}, {"lat": -33.5, "lon": 151.5}, None]


def test_runs_are_the_quickest_timed_pass_this_week_on_a_backed_up_circuit(out):
    assert out["runs"] == [{"segment_id": "mine1", "time_s": 195, "driver_score": 700, "driven_on": "2026-11-12"}]
    assert out["none"] == []


def test_entered_stage_copy(out):
    assert out["copy"] == {"id": "new1", "name": "Dry Ridge", "length_m": 2500, "geom": "[[39.2,-84.6],[39.21,-84.61],[39.3,-84.5]]",
                           "lat0": 39.2, "lon0": -84.6, "lat1": 39.3, "lon1": -84.5, "origin": "C1", "synced": True}
    assert out["nocopy"] is None


def test_only_your_own_backed_up_stages_of_1_to_25_km_go_up(out):
    assert out["putUp"] == ["a"]
