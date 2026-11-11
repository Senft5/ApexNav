"""Your roads and a Sunday suggestion (panel round 1, D-1, R-1, D-2; web/your_roads.js): the idle deck's own roads, the one
suggestion with its reason, the opt-in weekly reminder, and the wiring in the page, the Log and the iOS shell."""
import json
import pathlib
import re
import shutil
import subprocess

import pytest

from tests.page_source import cockpit_source

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
NODE = shutil.which("node")

RUNNER = r"""
const Y = require(process.argv[1] + '/web/your_roads.js');
const long = (m) => `${(m / 1609.344).toFixed(1)} mi`;
const day = (iso) => new Date(iso).toISOString();
const S = (id, name, date, len, score, source = 'web-gps') => ({ id, name, date, len_m: len, source, ds: { score } });
const sums = [
  S('a1', 'Dry Ridge Road', '2026-10-04T14:00:00', 23000, 702.4),
  S('a2', 'Dry Ridge Road', '2026-10-11T14:00:00', 23500, 788),
  S('a3', 'dry ridge road ', '2026-10-25T14:00:00', 22800, null),
  S('b1', 'Pippin Road', '2026-10-18T14:00:00', 9000, 650),
  S('c1', 'Drive 10/19/2026 7:38 PM', '2026-10-19T19:38:00', 12000, 600),     // no road named it
  S('c2', '45 mi loop', '2026-10-20T10:00:00', 72000, 640),                 // a loop
  S('c3', 'To Shell', '2026-10-21T10:00:00', 5000, 610),                     // a trip to a place
  S('c4', 'Circle Freeway', '2026-10-22T10:00:00', 600, null),               // too short to be a road to drive again
  S('c5', 'Cherohala Skyway', '2026-10-23T10:00:00', 30000, 900, 'demo'),    // not yours
  S('d1', 'Carolina Trace Road', '2026-10-30T19:38:00', 2200, 640),
];
const mine = Y.roads(sums, 50);
const now = new Date(2026, 10, 2, 9, 0).getTime();                          // Monday 2 Nov 2026, 9 AM local
const crew = { title: 'Ridge run', crew: 'Ridge Runners', when: 'Sun 9:00 AM', at: new Date(2026, 10, 8, 9, 0).getTime(), lat: 39.2, lon: -84.6 };
const untried = { name: 'Bank Road', good: 12, awayM: 8047, sky: 'Dry' };
const sat = new Date(2026, 10, 7, 19, 0).getTime(), nextSat = new Date(2026, 10, 14, 19, 0).getTime();
console.log(JSON.stringify({
  names: ['Dry Ridge Road', 'Drive 11/2/2026 7:38 PM', 'web_20261102_193800', '45 mi loop', 'To Shell', 'Home', 'Pin 39.1, -84.5', 'The road ahead', 'Route 282', '', null].map(Y.isRoadName),
  mine,
  three: Y.roads(sums).map((r) => r.name),
  line: Y.roadLine(mine.find((r) => r.name.toLowerCase() === 'dry ridge road'), long),
  lineOne: Y.roadLine({ lenM: null, best: null, runs: 1 }, long),
  sCrew: Y.suggest({ crew, untried, mine, now, long }),
  sCrewFar: Y.suggest({ crew: { ...crew, at: now + 9 * 86400000 }, untried, mine, now, long }),
  sUntried: Y.suggest({ untried, mine, now, long }),
  sUntriedDriven: Y.suggest({ untried: { ...untried, name: 'pippin road' }, mine, now, long }),
  sBest: Y.suggest({ mine, now, long }),
  sNone: Y.suggest({ mine: Y.roads([S('x', 'Pippin Road', '2026-10-18', 9000, null)], 50), now, long }),
  sEmpty: Y.suggest({ now, long }),
  deckEmpty: Y.deck(null, []),
  deckBest: Y.deck(Y.suggest({ mine, now, long }), mine.slice(0, 3)).map((r) => r.kind + ':' + (r.r ? r.r.name : r.s ? r.s.name : '')),
  deckUntried: Y.deck(Y.suggest({ untried, mine, now, long }), mine.slice(0, 1)).map((r) => r.kind),
  usual: Y.usualDay(['2026-10-04T14:00:00', '2026-10-11T14:00:00', '2026-10-21T10:00:00']),
  usualOne: Y.usualDay(['2026-10-04T14:00:00']),
  usualTie: Y.usualDay(['2026-10-04T14:00:00', '2026-10-11T14:00:00', '2026-10-06T14:00:00', '2026-10-13T14:00:00']),
  atSun: Y.nudgeAt({ now, day: 0 }) === sat,
  atSunAfterOne: Y.nudgeAt({ now: sat + 3600000, day: 0, lastAt: sat }) === nextSat,
  atWeekGap: Y.nudgeAt({ now, day: 0, lastAt: now - 3600000 }) === nextSat,
  atCrew: Y.nudgeAt({ now, day: 3, crewAt: crew.at }) === sat,
  atNoDay: Y.nudgeAt({ now, day: null }),
  atSatNight: Y.nudgeAt({ now: new Date(2026, 10, 7, 21, 0).getTime(), day: 0 }) === nextSat,
  tBest: Y.nudgeText(Y.suggest({ mine, now, long }), 0),
  tUntried: Y.nudgeText(Y.suggest({ untried, mine, now, long }), 0),
  tCrew: Y.nudgeText(Y.suggest({ crew, mine, now, long }), 0),
  tLoop: Y.nudgeText(null, 6),
  ...(() => {
    const T = (o) => ({ week: '2026-11-02', ends_on: '2026-11-08', today: '2026-11-06', cell: '39,-85', entered: false, entrants: 8, you: null,
      circuit: { name: 'Pippin and Bank loop', length_m: 32187, segment_id: 'seg1', geom: JSON.stringify([[39.1, -84.6], [39.2, -84.5], [39.1, -84.6]]) }, ...o });
    const inA = Y.attackFrom(T({ entered: true, you: { place: 3, time_s: 1200 } })), outA = Y.attackFrom(T({}));
    const sunEve = new Date(2026, 10, 7, 19, 0).getTime();
    return {
      ta: inA,
      taNone: [Y.attackFrom(null), Y.attackFrom({ circuit: null }), Y.attackFrom(T({ circuit: { name: 'X', geom: '[[1,2]]' } })), Y.attackFrom(T({ today: '2026-11-09' }))],
      sAttackIn: Y.suggest({ attack: inA, untried, mine, now, long }),
      sAttackNoTime: Y.suggest({ attack: { ...inA, place: null }, untried, mine, now, long }).reason,
      sAttackLast: Y.suggest({ attack: Y.attackFrom(T({ entered: true, today: '2026-11-08' })), mine, now, long }).reason,
      sAttackCrew: Y.suggest({ crew, attack: inA, mine, now, long }).kind,
      sAttackOutUntried: Y.suggest({ attack: outA, untried, mine, now, long }).kind,
      sAttackOut: Y.suggest({ attack: outA, mine, now, long }),
      sAttackOver: Y.suggest({ attack: outA, mine, now: outA.until, long }).kind,
      tAttack: Y.nudgeText(Y.suggest({ attack: inA, mine, now, long }), 0, new Date(2026, 10, 5, 19, 0).getTime()),
      tAttackOver: Y.nudgeText(Y.suggest({ attack: inA, mine, now, long }), 1, sunEve + 86400000),
      nth: [1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map((n) => Y.suggest({ attack: { ...inA, place: n, times: 200 }, now, long }).reason.split(' · ')[0]),
    };
  })(),
  again: Y.againPoints({ lat: 1, lon: 2 }, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3),
  againShort: Y.againPoints({ lat: 1, lon: 2 }, [10], [0]),
}));
"""


@pytest.fixture(scope="module")
def out():
    if NODE is None:
        pytest.skip("node not installed")
    return json.loads(subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, check=True, timeout=30).stdout)


def test_only_a_road_names_a_road(out):
    assert out["names"] == [True, False, False, False, False, False, False, False, True, False, False]


def test_your_roads_are_your_drives_by_road_newest_first(out):
    by = {r["name"]: r for r in out["mine"]}
    assert set(by) == {"dry ridge road", "Carolina Trace Road", "Pippin Road"}           # named as the latest drive on it was
    dry = next(r for r in out["mine"] if r["name"].lower() == "dry ridge road")
    assert dry["runs"] == 3 and dry["best"] == 788 and dry["id"] == "a3"          # the latest drive on it, the best score of all three
    assert [r["name"].lower() for r in out["mine"]] == ["carolina trace road", "dry ridge road", "pippin road"]
    assert len(out["three"]) == 3


def test_a_road_line_says_only_what_is_known(out):
    assert out["line"] == "14.2 mi · best 788 · 3 runs"
    assert out["lineOne"] == "1 run"


def test_the_suggestion_is_chosen_in_order_and_names_its_reason(out):
    c = out["sCrew"]
    assert c["kind"] == "crew" and c["title"] == "Sun 9:00 AM · Ridge run" and c["reason"] == "Ridge Runners · you’re going"
    assert out["sCrewFar"]["kind"] == "untried"                                    # a crew drive more than a week off waits
    u = out["sUntried"]
    assert u["kind"] == "untried" and u["title"] == "Bank Road"
    assert u["reason"] == "Not driven yet · 5.0 mi from here · 12 good corners · Dry now"
    assert u["lasting"] == "Not driven yet · 5.0 mi from here · 12 good corners"
    assert out["sUntriedDriven"]["kind"] == "best"                                 # one you've driven is not "not driven yet"
    b = out["sBest"]
    assert b["kind"] == "best" and b["title"] == "Back to dry ridge road" and b["reason"].startswith("Your best Score here, 788") and b["id"] == "a3"
    assert out["sNone"] is None and out["sEmpty"] is None                           # never scored: no invented reason, the loop


def test_the_deck_is_three_rows_with_no_road_twice(out):
    assert out["deckEmpty"] == [{"kind": "loop"}]
    rows = out["deckBest"]
    assert rows[0] == "suggest:dry ridge road" and len(rows) == 3
    assert not any(r.lower().endswith("dry ridge road") for r in rows[1:])
    assert out["deckUntried"] == ["suggest", "road", "loop"]                       # the loop comes back when there is room


def test_the_usual_day_is_known_or_unknown(out):
    assert out["usual"] == 0                                                        # two Sundays
    assert out["usualOne"] is None and out["usualTie"] is None


def test_the_reminder_is_the_evening_before_and_at_most_once_a_week(out):
    assert out["atSun"] and out["atSunAfterOne"] and out["atWeekGap"] and out["atCrew"] and out["atSatNight"]
    assert out["atNoDay"] is None


def test_the_reminder_names_the_suggestion_without_guilt(out):
    assert out["tBest"] == {"title": "Sunday: dry ridge road", "body": out["sBest"]["reason"]}
    assert out["tUntried"]["body"] == out["sUntried"]["lasting"]                   # today's sky is never tomorrow's
    assert out["tCrew"]["title"] == "Tomorrow: Ridge run" and "you’re going" in out["tCrew"]["body"]
    assert out["tLoop"]["title"] == "Saturday: a loop from home"
    words = json.dumps([out["tBest"], out["tUntried"], out["tCrew"], out["tLoop"]]).lower()
    for nag in ("streak", "haven't", "haven’t", "miss", "days since", "don't forget", "come back"):
        assert nag not in words, nag


def test_this_weeks_time_attack_is_read_from_the_answer(out):
    ta = out["ta"]
    assert ta["name"] == "Pippin and Bank loop" and ta["entered"] is True and ta["place"] == 3 and ta["times"] == 8
    assert ta["left"] == 3 and (ta["lat"], ta["lon"]) == (39.1, -84.6) and ta["key"] == "2026-11-02|39,-85|seg1"
    assert out["taNone"] == [None, None, None, None]                       # no loop, no line to drive, the week over


def test_the_time_attack_is_the_suggestion_in_its_place(out):
    a = out["sAttackIn"]
    assert a["kind"] == "attack" and a["title"] == "Time attack · Pippin and Bank loop"
    assert a["reason"] == "You’re 3rd of 8 · 3 days left"                 # entered: ahead of the road you haven't driven
    assert out["sAttackNoTime"] == "No time yet · 3 days left"
    assert out["sAttackLast"] == "No time yet · last day"
    assert out["sAttackCrew"] == "crew"                                    # a crew drive you're going to still comes first
    assert out["sAttackOutUntried"] == "untried"                           # not entered: after the road you haven't driven
    o = out["sAttackOut"]
    assert o["kind"] == "attack" and o["reason"] == "This week’s loop · 20.0 mi · 8 times · 3 days left"   # and before your best road
    assert out["sAttackOver"] == "best"
    assert out["nth"] == ["You’re 1st of 200", "You’re 2nd of 200", "You’re 3rd of 200", "You’re 4th of 200", "You’re 11th of 200",
                          "You’re 12th of 200", "You’re 13th of 200", "You’re 21st of 200", "You’re 22nd of 200", "You’re 101st of 200", "You’re 111th of 200"]


def test_the_time_attack_reminder_says_only_what_lasts(out):
    assert out["tAttack"] == {"title": "Sunday: Pippin and Bank loop", "body": "This week’s time attack · 20.0 mi"}
    assert out["tAttackOver"]["title"] == "Monday: a loop from home"       # the week is over by the day it names


def test_the_deck_reads_the_week_for_members_and_drives_to_the_start():
    src = cockpit_source()
    assert "apiCall('GET', `/api/timeattack?lat=${at.lat}&lon=${at.lon}`)" in src and "YR.attackFrom(" in src
    assert "if (s && s.kind === 'attack') { routeToPlace({ label: s.name, lat: s.lat, lon: s.lon }); return; }" in src
    assert "YR.nudgeText(sugg, day, at)" in src


def test_drive_it_again_goes_from_here_along_the_drive(out):
    pts = out["again"]
    assert pts[0] == {"lat": 1, "lon": 2}
    assert [p["lat"] for p in pts[1:]] == [10, 13, 15, 18, 20]
    assert [p["shaping"] for p in pts[1:]] == [False, True, True, True, False]
    assert out["againShort"] is None


def test_the_page_wires_the_deck_the_log_and_the_end_card():
    src = cockpit_source()
    assert '<script src="your_roads.js" defer></script>' in src
    assert 'id="yourRoads"' in src and 'id="loopSuggestWhy"' in src and 'id="endAgain"' in src
    assert "async function driveAgain(id, name)" in src and "YR.againPoints(from, d.lat, d.lon)" in src
    assert "if (again) { ApexLogHost.close('map'); driveAgain(again); return; }" in src
    assert "if (params.get('again')) driveAgain(params.get('again'));" in src
    # D-2: twisty roads on by default, and on again for saves made under the old default; never searched during a drive
    assert re.search(r"toggles: \{[^}]*twisty: true[^}]*nudge: false", src)
    assert "if (saved.twistyV !== 2) state.toggles.twisty = true;" in src and "twistyV: 2" in src
    assert "state.toggles.twisty && !!window.ApexTwisty && state.mode !== 'live'" in src
    log = (WEB / "analysis.html").read_text()
    assert 'id="dvAgain"' in log and "ApexReturn.open('index.html?again=' + encodeURIComponent(id))" in log


def test_the_reminder_is_opt_in_and_asks_only_when_turned_on():
    src = cockpit_source()
    assert 'data-setting="nudge" data-title="Reminder"' in src and 'data-toggle="nudge"' in src
    assert "native.postMessage({ cmd: 'nudge', op: 'allow' })" in src
    # the permission is asked from the switch, nowhere else
    assert src.count("op: 'allow'") == 1
    assert "'nudge'" in (WEB / "garage_settings.js").read_text()
    app = (ROOT / "ApexNavApp.swift").read_text()
    assert "import UserNotifications" in app
    assert 'if cmd == "nudge", let dict = body as? [String: Any] {' in app and "ApexNudge.handle(dict, shell: shell)" in app
    assert 'static let id = "vetta-nudge"' in app and "removePendingNotificationRequests(withIdentifiers: [id])" in app
    assert app.count("requestAuthorization(") == 1                                  # ApexNudge's; the builds' lives in its own file
    assert "R-1" in (ROOT / "docs" / "APP_REVIEW.md").read_text()
