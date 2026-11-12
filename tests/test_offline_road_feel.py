"""Members' road feel offline (IDEAS F-02, the rest of the row): a saved map area also keeps the members' road data for
its 0.1-degree cells (web/own_routing.js holdArea) until the area is deleted, so a plan with no signal still knows the
measured roads; the phone never passes part of an answer off as the whole (keptFor: all the cells or nothing), and the
kept data leaves the phone on sign-out, Erase everything and Delete offline data (clearCrowd)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COCKPIT = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()

RUNNER = r"""
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const R = require(process.argv[1] + '/web/own_routing.js');
(async () => {
  const out = {};
  const cells = R.cellsNear(35.63, -83.47, 25);
  out.cells = cells.length; out.first = cells[0]; out.unique = new Set(cells).size === cells.length;
  // a server that knows one way in 356_-836 and answers every ask but 357_-834's
  const asks = [];
  const way = { 0: { i: [0, 1], n: [3, 3], cam: [0.02, 0.03], cn: [3, 3], rough: [0.1, 0.2] } };
  const lookup = async (part) => { asks.push(part.length); if (part.includes('357_-834')) return null; return part.includes('356_-836') ? { ways: { 77: way }, lines: { 77: [[35.61, -83.55], [35.62, -83.54]] } } : { ways: {}, lines: {} }; };
  const held = await R.holdArea(lookup, cells, 'aX');
  out.held = held; out.maxAsk = Math.max(...asks); out.heldKey = JSON.parse(localStorage.getItem(R.HELD_KEY) || '{}');
  // kept past a day while held
  for (const c of cells) { const m = R._cells.get(c); if (m) m.at -= 3 * 24 * 3600e3; }
  const k1 = await R.keptFor(['356_-836', '355_-836']);
  out.keptWays = k1 ? Object.keys(k1.ways) : null;
  out.partial = await R.keptFor(['356_-836', '357_-834']);
  out.unknownCell = await R.keptFor(['999_999']);
  // the area deleted: back to the day's keep, so three days old is gone
  R.releaseArea('aX');
  out.afterRelease = await R.keptFor(['356_-836']);
  out.heldAfter = localStorage.getItem(R.HELD_KEY);
  // held again, then cleared (sign-out)
  await R.holdArea(lookup, ['356_-836'], 'aY');
  out.again = !!(await R.keptFor(['356_-836']));
  await R.clearCrowd();
  out.afterClear = await R.keptFor(['356_-836']); out.heldCleared = localStorage.getItem(R.HELD_KEY);
  out.noLookup = await R.holdArea(undefined, ['356_-836'], 'aZ');
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def run():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_an_area_is_every_cell_round_it_nearest_first(run):
    assert run["unique"] and run["first"] == "356_-835"
    assert 30 <= run["cells"] <= 60      # 25 km round: about 5 or 6 rows by 7 or 8 columns of 0.1 degrees


def test_it_asks_in_small_parts_and_holds_only_cells_that_answered(run):
    assert run["maxAsk"] <= 2, "the server caps ways per answer, so a busy area is asked two cells at a time"
    h = run["held"]
    assert h["cells"] == run["cells"] and h["held"] == run["cells"] - 2 and h["ways"] == 1
    assert "357_-834" not in run["heldKey"], "a cell that never answered is not held: unknown stays unknown"
    assert run["heldKey"]["356_-836"] == ["aX"]


def test_held_cells_outlast_the_day_and_never_pass_off_part_as_all(run):
    assert run["keptWays"] == ["77"]
    assert run["partial"] is None and run["unknownCell"] is None


def test_deleting_the_area_or_signing_out_lets_it_go(run):
    assert run["afterRelease"] is None and run["heldAfter"] is None
    assert run["again"] and run["afterClear"] is None and run["heldCleared"] is None
    assert run["noLookup"] == {"cells": 1, "held": 0, "ways": 0}


def test_the_cockpit_wires_it():
    # a plan with no signal falls back to the kept cells; a server that says no (signed out) is final
    assert "if (r && r.status < 500) return null;" in COCKPIT and "ApexOwnRouting.keptFor(cells)" in COCKPIT
    # Save the map here asks for the area's road data as a member, and Delete lets the area's cells go
    assert "ApexOwnRouting.holdArea(routeCtxOpts().lookupCells, ApexOwnRouting.cellsNear(c.lat, c.lng, a.radiusKm), a.id)" in COCKPIT
    assert "ApexOwnRouting.releaseArea(a.id)" in COCKPIT
    # sign-out (both keys) and account deletion, Erase everything and Delete offline data clear it
    assert COCKPIT.count("ApexSync.setSession(null); clearCarry(); clearCrowd();") == 4   # sign out, delete account (2), and Apple sign-in turned off in Settings
    assert COCKPIT.count("await ApexOwnRouting.clearCrowd()") == 2
