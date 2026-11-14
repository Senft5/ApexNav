"""A place's card (web/place_info.js): opening_hours read in its common forms and said as Apple Maps says it (open until,
opens tomorrow, opens Mon), anything else unknown rather than guessed; phone and website as keys."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/place_info.js');
const at = (d, h, m = 0) => new Date(2026, 10, 16 + d, h, m);       // Monday 16 November 2026, local time
const S = (spec, d, h, m) => { const s = P.status(P.read(spec), at(d, h, m)); return s && [s.open, s.text]; };
const shop = 'Mo-Fr 08:00-17:00; Sa 09:00-13:00';
console.log(JSON.stringify({
  open: S(shop, 0, 10), evening: S(shop, 0, 18), friday: S(shop, 4, 18), saturday: S(shop, 5, 14), early: S(shop, 2, 7, 30),
  always: S('24/7', 2, 3), allDays: S('Mo-Su 00:00-24:00', 3, 12),
  lateBar: S('Mo-Su 18:00-02:00', 1, 1), lateBarEve: S('Mo-Su 18:00-02:00', 1, 23), wrapDays: S('Fr-Mo 10:00-20:00', 2, 12),
  lunch: S('Tu-Su 11:00-14:00,17:00-22:00', 1, 15), monday: S('Tu-Su 11:00-14:00,17:00-22:00', 0, 12),
  override: S('Mo-Su 08:00-20:00; Su 10:00-16:00', 6, 17), off: S('Mo-Sa 09:00-17:00; Su off', 6, 12), halfHour: S('Mo-Su 06:30-21:30', 0, 21),
  unknown: [P.read('Jan-Mar Mo 10:00-12:00'), P.read('sunrise-sunset'), P.read(''), P.read(null), P.read('Mo 10:00+')],
  holidays: S('Mo-Fr 09:00-17:00; PH off', 0, 10),
  contact: P.contact({ phone: '+1 513-555-0101;+1 513 555 0199', website: 'www.skylinechili.com/menu' }, at(0, 9)),
  noContact: P.contact({ phone: 'call us', website: 'javascript:alert(1)' }, at(0, 9)),
  query: P.query('Joe\'s "Best" Diner', 39.1, -84.5),
  many: P.queryMany([{ name: 'A', lat: 39, lon: -84 }, { name: 'B "2"', lat: 39.1, lon: -84.1 }]),
  match: P.match([{ name: 'X', lat: 39, lon: -84 }, null, { name: 'Y', lat: 39, lon: -84 }, { name: 'Z', lat: 39, lon: -84 }],
    [{ tags: { name: 'X', k: 'far' }, lat: 39.0010, lon: -84 }, { tags: { name: 'X', k: 'near' }, lat: 39.0002, lon: -84 },
     { tags: { name: 'Y' }, lat: 39.01, lon: -84 }, { tags: { name: 'Z', k: 'way' }, center: { lat: 39.0001, lon: -84.0001 } }]),
}));
"""


def run():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_open_now_and_next_opening():
    r = run()
    assert r["open"] == [True, "Open · until 5 PM"]
    assert r["evening"] == [False, "Closed · opens tomorrow 8 AM"]
    assert r["friday"] == [False, "Closed · opens tomorrow 9 AM"]
    assert r["saturday"] == [False, "Closed · opens Mon 8 AM"]
    assert r["early"] == [False, "Closed · opens 8 AM"]
    assert r["halfHour"] == [True, "Open · until 9:30 PM"]


def test_all_day_and_past_midnight():
    r = run()
    assert r["always"] == [True, "Open 24 hours"]
    assert r["allDays"] == [True, "Open 24 hours"]
    assert r["lateBar"] == [True, "Open · until 2 AM"]          # Tuesday 1 AM: Monday night's hours
    assert r["lateBarEve"] == [True, "Open · until 2 AM"]
    assert r["wrapDays"] == [False, "Closed · opens Fri 10 AM"]  # Fr-Mo wraps over the weekend; Wednesday is closed


def test_split_hours_later_rules_and_days_off():
    r = run()
    assert r["lunch"] == [False, "Closed · opens 5 PM"]
    assert r["monday"] == [False, "Closed · opens tomorrow 11 AM"]
    assert r["override"] == [False, "Closed · opens tomorrow 8 AM"]   # Sunday's own rule replaces Mo-Su
    assert r["off"] == [False, "Closed · opens tomorrow 9 AM"]
    assert r["holidays"] == [True, "Open · until 5 PM"]


def test_forms_not_followed_stay_unknown():
    assert run()["unknown"] == [None, None, None, None, None]


def test_phone_and_website_keys():
    r = run()
    assert r["contact"]["phone"] == {"href": "tel:+15135550101", "text": "+1 513-555-0101"}
    assert r["contact"]["web"] == {"href": "https://www.skylinechili.com/menu", "text": "skylinechili.com"}
    assert r["contact"]["hours"] is None
    assert r["noContact"]["phone"] is None and r["noContact"]["web"] is None
    assert '["name"="Joe\'s \\"Best\\" Diner"]' in r["query"] and "around:60,39.100000,-84.500000" in r["query"]


def test_a_list_in_one_query_each_to_its_own():
    r = run()
    assert r["many"].count("nwr(around:60,") == 2 and '["name"="B \\"2\\""]' in r["many"] and r["many"].endswith("out tags center;")
    # the nearer of two by the name; a namesake 1 km off is not it; a way by its centre; a row with no name stays null
    assert r["match"] == [{"name": "X", "k": "near"}, None, None, {"name": "Z", "k": "way"}]


def test_our_server_first_then_overpass():
    """Inside the region a place's tags come from our server (GET /api/ctx/places, the weekly OSM build), one request for
    a list; a 404 (outside the region, not built) or no app API goes to Overpass exactly as before."""
    src = r"""
const P = require(process.argv[1] + '/web/place_info.js');
const asked = [], over = [];
globalThis.ApexCameras = { SERVERS: ['x'], fetchFirst: async (f, body) => { over.push(body); return { elements: [{ tags: { name: 'Far Cafe', opening_hours: '24/7' }, lat: 40, lon: -100 }] }; } };
(async () => {
  globalThis.ApexSync = { apiFetch: async (path) => { asked.push(path); return /Far/.test(decodeURIComponent(path)) ? { ok: false, status: 404 } : { ok: true, json: async () => ({ tags: decodeURIComponent(path).split('&').map((x) => (/Bean/.test(x) ? { name: 'Bean', phone: '+1 513 555 0100' } : null)) }) }; } };
  const one = await P.lookup('Bean', 39.1, -84.5, () => null);
  const many = await P.lookupMany([{ name: 'Bean', lat: 39.1, lon: -84.5 }, null, { name: 'Nope', lat: 39.11, lon: -84.5 }], () => null);
  const far = await P.lookup('Far Cafe', 40, -100, () => null);
  delete globalThis.ApexSync;
  const noApi = await P.lookupMany([{ name: 'Far Cafe', lat: 40, lon: -100 }], () => null);
  console.log(JSON.stringify({ one, many, far, noApi, asked, over: over.length, path: P.placesPath([{ name: 'A & B', lat: 39.1, lon: -84.5 }]) }));
})();
"""
    r = json.loads(subprocess.run([NODE, "-e", src, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["one"] == {"name": "Bean", "phone": "+1 513 555 0100"}
    assert r["many"] == [{"name": "Bean", "phone": "+1 513 555 0100"}, None, None], "in the places' order, the null kept"
    assert len(r["asked"]) == 3 and r["asked"][1].count("p=") == 2, "one request for the list"
    assert r["far"]["opening_hours"] == "24/7" and r["noApi"][0]["opening_hours"] == "24/7" and r["over"] == 2, "outside: Overpass as before"
    assert r["path"] == "/api/ctx/places?p=39.100000%2C-84.500000%2CA%20%26%20B"
