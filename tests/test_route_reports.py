"""Reported hazards kept with a saved route (web/route_reports.js, IDEAS F-03): kept per cell with the time they were
asked, read back with the expired ones dropped and each report once, capped, and gone with the route."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = require(process.argv[1] + '/web/route_reports.js');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const S = mem(), t0 = Date.parse('2026-11-13T14:00:00Z'), H = 3600e3;
const a = { id: 1, kind: 'police', expires_at: new Date(t0 + 2 * H).toISOString() }, b = { id: 2, kind: 'debris', expires_at: new Date(t0 + 10 * H).toISOString() }, c = { id: 3, kind: 'closure' };
R.save(S, 'r1', { '356_-839': [a, b], '357_-839': [b, c], bad: 'x' }, t0);
const early = R.load(S, 'r1', t0 + H), late = R.load(S, 'r1', t0 + 3 * H);
for (let i = 0; i < 12; i++) R.save(S, 'x' + i, { k: [a] }, t0 + i);
const capped = Object.keys(JSON.parse(S.getItem(R.KEY))).length, firstGone = R.load(S, 'r1', t0) === null;
R.save(S, 'gone', { k: [b] }, t0 + 100); const removed = R.remove(S, 'gone') && R.load(S, 'gone', t0) === null;
const junk = mem(); junk.setItem(R.KEY, '[1,2]');
const many = R.save(mem(), 'm', { k: Array.from({ length: 80 }, (_, i) => ({ id: i })) }, t0);
const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
console.log(JSON.stringify({ early: { at: early.at, ids: early.rows.map((h) => h.id).sort(), cells: Object.keys(early.cells).sort() }, late: late.rows.map((h) => h.id).sort(),
  capped, firstGone, removed, junk: R.load(junk, 'r1', t0), many, full: R.save(full, 'f', { k: [a] }, t0), noId: R.save(mem(), '', { k: [] }) }));
"""


def test_route_reports():
    r = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["early"]["at"] == 1794578400000 and r["early"]["ids"] == [1, 2, 3], "each report once, with when it was asked"
    assert r["early"]["cells"] == ["356_-839", "357_-839"], "a cell that wasn't a list is not kept"
    assert r["late"] == [2, 3], "an expired report drops out as it is read; one with no expiry stays"
    assert r["capped"] == 10 and r["firstGone"] is True, "the newest ten routes, the oldest goes"
    assert r["removed"] is True and r["junk"] is None
    assert r["many"] is True and r["full"] is False and r["noId"] is False


def test_the_cockpit_keeps_and_reads_them():
    src = open(os.path.join(ROOT, "web", "cockpit.js")).read()
    assert "keepMapAlong(t); keepReportsAlong(t);" in src, "saving a route keeps its reports"
    assert "ApexRouteReports.remove(localStorage, String(t.id))" in src, "unsaving drops them"
    assert "localStorage.removeItem(ApexRouteReports.KEY)" in src, "Delete offline data clears them"
    assert "if (kept) list = kept.rows;\n      else try { list = await hazardsAround(pts); }" in src and "(as of ${" in src, "the card with no signal: the kept ones, with their age"
