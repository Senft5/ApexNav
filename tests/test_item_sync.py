"""Saved routes and pinned places on your account (web/item_sync.js against a stand-in for backend/src/member_items.ts):
two phones on one account end up with the same routes and places; a removal on one reaches the other; the newest change of
an item wins; another account starts over; the switch off empties the account's copy and stops syncing."""
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
const R = require(root + '/web/saved_routes.js'), P = require(root + '/web/pinned_places.js'), S = require(root + '/web/item_sync.js');
const phone = () => { const m = {}; return { m, getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; } }; };
// the server as member_items.ts keeps it: per account, newest `at` wins, `seen` is the server's clock
let clock = 1_790_000_000_000;
const db = {};
const server = (uid) => async (method, path, body) => {
  const rows = (db[uid] = db[uid] || {});
  const res = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
  if (method === 'GET') {
    const since = Number(new URL('http://x' + path).searchParams.get('since'));
    const now = ++clock;
    return res({ now, more: false, items: Object.values(rows).filter((r) => r.seen >= since).map(({ kind, id, at, body }) => ({ kind, id, at, body: body && JSON.parse(JSON.stringify(body)) })) });
  }
  if (method === 'PUT') {
    const now = ++clock;
    for (const it of body.items) { const k = it.kind + ':' + it.id, have = rows[k]; if (!have || it.at > have.at) rows[k] = { ...it, seen: now }; }
    return res({ taken: body.items.length });
  }
  if (method === 'DELETE') { db[uid] = {}; return res(null, 204); }
};
const names = (st) => ({ routes: R.list(st).map((p) => p.name), places: P.list(st).map((p) => p.name + '@' + p.label) });
const route = (id, name, at) => ({ ...R.pack({ id, name, lat: [35, 35.01], lon: [-84, -84.01], dist: [0, 1400] }, at) });
(async () => {
  const out = {};
  const a = phone(), b = phone();
  R.save(a, route('r1', 'Dragon', 1_780_000_000_000)); P.pin(a, 'Home', { label: '12 Oak', lat: 39.1, lon: -84.5 }, 1_780_000_000_000);
  out.first = await S.sync(a, R, P, 'u1', server('u1'), clock);
  out.bFirst = await S.sync(b, R, P, 'u1', server('u1'), clock);
  out.b1 = names(b);
  // B unpins Home and saves a route; A learns both
  P.unpin(b, 'home'); R.save(b, route('r2', 'Skyway', 1_781_000_000_000));
  await S.sync(b, R, P, 'u1', server('u1'), clock);
  await S.sync(a, R, P, 'u1', server('u1'), clock);
  out.a2 = names(a);
  // the same name pinned on both: the newer pin wins on both phones, whichever syncs first
  P.pin(a, 'Gym', { label: 'Old gym', lat: 1, lon: 1 }, 1_782_000_000_000);
  P.pin(b, 'Gym', { label: 'New gym', lat: 2, lon: 2 }, 1_783_000_000_000);
  await S.sync(a, R, P, 'u1', server('u1'), clock); await S.sync(b, R, P, 'u1', server('u1'), clock); await S.sync(a, R, P, 'u1', server('u1'), clock);
  out.a3 = names(a); out.b3 = names(b);
  // nothing changed: a sync sends nothing
  out.quiet = await S.sync(a, R, P, 'u1', server('u1'), clock);
  // another account on phone A: it starts over, the phone's items go up to that account, u1 keeps its own
  out.other = await S.sync(a, R, P, 'u2', server('u2'), clock);
  out.u2 = Object.keys(db.u2).sort();
  // the switch off: the account's copy goes, the phone keeps its own, and no more syncing
  out.offOk = await S.setOn(b, 'u1', false, server('u1'));
  out.u1AfterOff = Object.keys(db.u1).length;
  out.offSync = await S.sync(b, R, P, 'u1', server('u1'), clock);
  out.bOff = names(b);
  out.isOff = S.isOff(b);
  // big routes go in more than one call
  const big = { kind: 'route', id: 'x', at: 1, body: { s: 'y'.repeat(500_000) } };
  out.batches = S.batches([big, big, { kind: 'place', id: 'p', at: 1, body: {} }]).map((b) => b.length);
  out.batches25 = S.batches(Array.from({ length: 30 }, () => ({ kind: 'place', id: 'p', at: 1, body: {} }))).map((b) => b.length);
  // no signal: nothing thrown, nothing lost
  const c = phone(); R.save(c, route('r9', 'Offline', 1_784_000_000_000));
  out.down = await S.sync(c, R, P, 'u3', async () => ({ ok: false, status: 0, json: async () => null }), clock);
  out.downThen = await S.sync(c, R, P, 'u3', server('u3'), clock);
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_a_second_phone_gets_the_first_ones_routes_and_places(out):
    assert out["first"] == {"pulled": False, "sent": 2}
    assert out["bFirst"]["pulled"] is True
    assert out["b1"] == {"routes": ["Dragon"], "places": ["Home@12 Oak"]}


def test_a_removal_and_a_new_route_reach_the_other_phone(out):
    assert out["a2"] == {"routes": ["Skyway", "Dragon"], "places": []}


def test_the_newer_pin_of_a_name_wins_on_both(out):
    assert out["a3"]["places"] == ["Gym@New gym"] and out["b3"]["places"] == ["Gym@New gym"]
    assert out["a3"]["routes"] == out["b3"]["routes"] == ["Skyway", "Dragon"]


def test_nothing_changed_sends_nothing(out):
    assert out["quiet"] == {"pulled": False, "sent": 0}


def test_another_account_starts_over(out):
    assert out["other"]["sent"] == 3
    assert out["u2"] == ["place:gym", "route:r1", "route:r2"]


def test_the_switch_off_empties_the_account_and_stops(out):
    assert out["offOk"] is True and out["u1AfterOff"] == 0
    assert out["offSync"] == {"off": True} and out["isOff"] is True
    assert out["bOff"]["routes"] == ["Skyway", "Dragon"]                      # the phone keeps its own


def test_big_routes_split_and_25_at_most_a_call(out):
    assert out["batches"] == [1, 2]
    assert out["batches25"] == [25, 5]


def test_no_signal_loses_nothing(out):
    assert out["down"]["sent"] == 0 and out["down"]["error"] == 0
    assert out["downThen"] == {"pulled": False, "sent": 1}


def test_the_page_loads_it_and_syncs_on_every_change():
    html = open(os.path.join(ROOT, "web", "index.html")).read()
    assert '<script src="item_sync.js" defer></script>' in html
    src = open(os.path.join(ROOT, "web", "cockpit.js")).read()
    assert src.count("itemsChanged();") >= 4, "save, remove, pin and unpin each sync"
    assert "syncItems(false);" in src and "Saved routes and places on my account" in src
