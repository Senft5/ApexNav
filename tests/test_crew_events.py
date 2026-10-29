"""Crew drives in the app (web/crew_events.js, IDEAS S-06): the time label, when the planner can start the convoy, the
calendar file (escaped, at the meeting point), and turning the date and time inputs into a zoned time."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
process.env.TZ = 'America/New_York';
const E = require(process.argv[1] + '/web/crew_events.js');
const now = new Date('2026-10-30T14:00:00Z');                                   // 10:00 AM in New York
const out = {
  today: E.whenText('2026-10-30T20:30:00Z', now, 'en-US'), tomorrow: E.whenText('2026-10-31T13:00:00Z', now, 'en-US'),
  later: E.whenText('2026-11-03T14:00:00Z', now, 'en-US'), bad: E.whenText('nope', now, 'en-US'),
};
const e = { id: 'EVT1', mine: true, starts_at: '2026-10-31T13:00:00Z', title: 'Cherohala; Saturday, early', meet_name: 'Shell, Tellico', meet_lat: 35.36, meet_lon: -84.29,
  crew_name: 'Ridge Runners', notes: 'Full tank\nno stragglers' };
const t = Date.parse(e.starts_at);
out.convoy = [E.convoyOpen(e, t - 3 * 3600e3), E.convoyOpen(e, t - 3600e3), E.convoyOpen(e, t + 3 * 3600e3), E.convoyOpen(e, t + 5 * 3600e3), E.convoyOpen({ ...e, mine: false }, t)];
out.ics = E.icsFor(e, Date.parse('2026-10-30T14:00:00Z'));
out.iso = [E.isoFromInputs('2026-11-01', '09:00'), E.isoFromInputs('2026-11-01', ''), E.isoFromInputs('11/01/2026', '09:00')];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_when(out):
    assert out["today"] == "Today 4:30 PM"
    assert out["tomorrow"] == "Tomorrow 9:00 AM"
    assert out["later"] == "Tue, Nov 3 · 9:00 AM"
    assert out["bad"] == "--"


def test_convoy_window(out):
    assert out["convoy"] == [False, True, True, False, False]


def test_calendar_file(out):
    ics = out["ics"]
    assert ics.startswith("BEGIN:VCALENDAR\r\n") and ics.endswith("END:VCALENDAR\r\n")
    assert "DTSTART:20261031T130000Z\r\n" in ics and "DTEND:20261031T150000Z\r\n" in ics
    assert "SUMMARY:Cherohala\; Saturday\\, early\r\n" in ics
    assert "LOCATION:Shell\\, Tellico (35.36\\, -84.29)\r\n" in ics and "GEO:35.36;-84.29\r\n" in ics
    assert "DESCRIPTION:Crew drive with Ridge Runners. Full tank\\nno stragglers\r\n" in ics


def test_inputs_to_zoned_time(out):
    assert out["iso"] == ["2026-11-01T14:00:00.000Z", None, None]           # 9 AM EST (clocks went back Nov 1)


# Roadmap 21: roles and the cockpit's morning reminder.
def _ce(js: str):
    import json as _j, shutil as _s, subprocess as _sp
    from pathlib import Path as _P
    src = f"const C = require({_j.dumps(str(_P(__file__).resolve().parents[1] / 'web' / 'crew_events.js'))}); console.log(JSON.stringify({js}));"
    return _j.loads(_sp.run([_s.which("node"), "-e", src], capture_output=True, text=True, check=True, env={"TZ": "America/New_York"}).stdout)


def test_roles_line():
    assert _ce("C.rolesLine({ lead: 'bob', sweep: null })") == "Lead @bob · Sweep open"
    assert _ce("C.rolesLine({})") == "Lead open · Sweep open"


def test_today_drive_is_the_morning_of_a_drive_you_are_going_to():
    evs = ("[{ id: 'a', starts_at: '2026-11-02T11:30:00Z', my_rsvp: 'going' },"     # 6:30 AM Nov 2, New York
           " { id: 'b', starts_at: '2026-11-02T18:00:00Z', my_rsvp: 'going' },"     # 1 PM same day
           " { id: 'c', starts_at: '2026-11-02T10:00:00Z', my_rsvp: 'maybe' },"     # not going
           " { id: 'd', starts_at: '2026-11-03T11:30:00Z', my_rsvp: 'going' }]")    # tomorrow
    at = lambda iso: _ce(f"(C.todayDrive({evs}, new Date('{iso}')) || {{}}).id || null")
    assert at("2026-11-02T08:30:00Z") is None        # 3:30 AM: too early
    assert at("2026-11-02T09:30:00Z") == "a"         # 4:30 AM: the dawn run
    assert at("2026-11-02T12:45:00Z") == "b"         # 7:45 AM: the dawn run started over an hour ago
    assert at("2026-11-02T19:30:00Z") is None        # 2:30 PM: both are over
    assert _ce("C.todayDrive(null)") is None
