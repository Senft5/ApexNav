"""Route context `events` (web/route_ctx/events.js): game traffic from the real MLB schedule of 2026-07-03/04, SeatGeek's
shape, school runs and church hours in local time, each at the sample's eta."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const root = process.argv[1];
const E = require(root + '/web/route_ctx/events.js'), C = require(root + '/tests/fixtures/route_ctx/corridor.js');
const F = (n) => require(root + '/tests/fixtures/route_ctx/' + n);
const nan = (a) => Array.from(a, (v) => (Number.isNaN(v) ? null : Math.round(v * 10) / 10));
const ev = E.parseMlb(F('mlb_schedule_2026-07-03.json'));
// Mehring Way / US-52 east past Great American Ball Park toward Riverbend, 15 m/s
const line = [[39.0930, -84.5250], [39.0945, -84.5120], [39.0955, -84.5040], [39.1010, -84.4900], [39.1040, -84.4700], [39.0900, -84.4450], [39.0600, -84.4250], [39.0500, -84.4150]];
const at = (ms) => C.corridor('river', line, { departAt: ms, speedMps: 15 });
const places = { schools: [{ lat: 39.0960, lon: -84.4980 }], worship: [{ lat: 39.1005, lon: -84.4905 }] };
const before = E.evaluate(at(Date.UTC(2026, 6, 3, 22, 0)), E.dedupe(ev), places);     // 6 pm EDT, first pitch 7:10
const during = E.evaluate(at(Date.UTC(2026, 6, 4, 0, 30)), E.dedupe(ev), places);     // 8:30 pm, mid-game
const after = E.evaluate(at(Date.UTC(2026, 6, 4, 2, 30)), E.dedupe(ev), places);      // 10:30 pm, the crowd leaving
const noon = E.evaluate(at(Date.UTC(2026, 6, 3, 16, 0)), E.dedupe(ev), places);
const unknown = E.evaluate(at(Date.UTC(2026, 6, 3, 22, 0)), null, null);
const sunday = E.evaluate(at(Date.UTC(2026, 10, 8, 15, 0)), [], places);              // Sunday 10 am EST
const monday = E.evaluate(at(Date.UTC(2026, 10, 2, 12, 30)), [], places);             // Monday 7:30 am EST
const thanks = E.evaluate(at(Date.UTC(2026, 10, 27, 12, 30)), [], places);            // Friday after Thanksgiving
const july = E.evaluate(at(Date.UTC(2026, 6, 6, 12, 30)), [], places);                // a July Monday
// SeatGeek's documented event shape (no key here, so not a live answer): a Bengals game at Paycor with capacity 0
const sg = E.parseSeatgeek({ events: [
  { title: 'Cincinnati Bengals vs. Baltimore Ravens', short_title: 'Ravens at Bengals', datetime_utc: '2026-11-08T18:00:00', type: 'nfl', taxonomies: [{ name: 'sports' }, { name: 'football' }, { name: 'nfl' }], venue: { name: 'Paycor Stadium', capacity: 0, location: { lat: 39.0955, lon: -84.5161 } } },
  { title: 'Open mic', datetime_utc: '2026-11-08T23:00:00', type: 'concert', taxonomies: [{ name: 'concert' }], venue: { name: 'A bar', capacity: 120, location: { lat: 39.1, lon: -84.5 } } },
  { title: 'TBD', datetime_utc: '2026-11-08T23:00:00', time_tbd: true, type: 'concert', venue: { name: 'Riverbend', capacity: 20500, location: { lat: 39.0505, lon: -84.4185 } } },
] });
const both = E.dedupe([...ev, { ...ev.find((e) => e.venue === 'Great American Ball Park'), people: 30000, label: 'SeatGeek copy', startMs: ev.find((e) => e.venue === 'Great American Ball Park').startMs + 600e3 }]);
const lt = (y, m, d, dow, hour) => ({ y, m, d, dow, hour });
console.log(JSON.stringify({
  events: ev.map((e) => [e.label, e.kind, e.people, new Date(e.startMs).toISOString()]),
  before: { spans: before.spans, points: before.points, max: Math.max(...nan(before.channels.event_crowd)) },
  duringMax: Math.max(...nan(during.channels.event_crowd)), afterMax: Math.max(...nan(after.channels.event_crowd)), noonMax: Math.max(...nan(noon.channels.event_crowd)),
  unknown: { crowd: [...new Set(nan(unknown.channels.event_crowd))], school: [...new Set(nan(unknown.channels.school_zone))], bus: [...new Set(nan(unknown.channels.school_bus_hour))], note: unknown.note },
  sunday: sunday.spans.map((s) => s.kind), monday: { spans: monday.spans.map((s) => s.kind), bus: [...new Set(nan(monday.channels.school_bus_hour))] },
  thanks: [...new Set(nan(thanks.channels.school_bus_hour))], july: [...new Set(nan(july.channels.school_bus_hour))],
  sg: sg.map((e) => [e.label, e.kind, e.people, e.venue]),
  dedupe: both.filter((e) => e.venue === 'Great American Ball Park' && e.startMs < Date.UTC(2026, 6, 4)).map((e) => e.label),
  radius: [Math.round(E.radiusM(1000)), Math.round(E.radiusM(40000)), Math.round(E.radiusM(100000))],
  school: [E.schoolDay(lt(2026, 11, 2, 1, 8), 'OH'), E.schoolDay(lt(2026, 8, 12, 3, 8), 'OH'), E.schoolDay(lt(2026, 8, 12, 3, 8), 'KY'), E.schoolDay(lt(2026, 12, 24, 4, 8), 'NC')],
  mlbUrl: E.mlbUrl(Date.UTC(2026, 6, 3, 22), Date.UTC(2026, 6, 3, 23)),
  query: E.placesQuery(['156_-339']),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_mlb_schedule_parses_major_and_triple_a_and_drops_postponed(out):
    labels = [(e[0], e[1]) for e in out["events"]]
    assert ("Cincinnati Reds home game", "baseball") in labels and ("Columbus Clippers home game", "aaa") in labels
    sounds = [e for e in out["events"] if e[0].startswith("Nashville Sounds")]
    assert all(e[3] >= "2026-07-04" for e in sounds)               # the 2026-07-03 game was postponed (rain)
    reds = next(e for e in out["events"] if e[0] == "Cincinnati Reds home game")
    assert reds[2] == round(42319 * 0.6) and reds[3] == "2026-07-03T23:10:00.000Z"


def test_game_traffic_peaks_before_and_after_not_during_or_at_noon(out):
    b = out["before"]
    assert [s["kind"] for s in b["spans"]] == ["event"] and "Great American Ball Park" in b["spans"][0]["label"]
    assert b["points"][0]["kind"] == "venue" and b["max"] == 25.4
    assert out["afterMax"] == 25.4 and 0 < out["duringMax"] < 10 and out["noonMax"] == 0


def test_unknown_schedules_and_places_stay_unknown(out):
    u = out["unknown"]
    assert u["crowd"] == [None] and u["school"] == [None] and "no schedules" in u["note"]
    assert u["bus"] == [0]                                         # a July Friday: no school, known from the calendar


def test_church_and_school_windows(out):
    assert out["sunday"] == ["church"]
    assert out["monday"]["spans"] == ["school-zone"] and out["monday"]["bus"] == [1]
    assert out["thanks"] == [0] and out["july"] == [0]
    assert out["school"] == [True, False, True, False]            # Ohio starts ~Aug 20, Kentucky ~Aug 12; Christmas Eve off


def test_seatgeek_shape(out):
    assert out["sg"] == [["Ravens at Bengals", "football", round(65515 * 0.95), "Paycor Stadium"]]


def test_dedupe_and_radius(out):
    assert len(out["dedupe"]) == 1
    assert out["radius"] == [600, 1882, 2200]


def test_requests_name_only_dates_and_tiles(out):
    assert "startDate=2026-07-02" in out["mlbUrl"] and "sportId=1,11" in out["mlbUrl"]
    assert "place_of_worship" in out["query"] and "39.0000,-84.7500,39.2500,-84.5000" in out["query"]
