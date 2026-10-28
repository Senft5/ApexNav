"""Spoken coaching on roads driven before (web/road_memory.js): technique tips only, the latest pass decides, said once ahead."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const M = require('./web/road_memory.js'), R = require('./web/recording.js'), Core = require('./web/apex_core.js');
const fs = require('fs');
const out = {};
// a straight road north: 200 samples, 5 m apart; reverse = driven south
const road = (id, date, reverse = false) => {
  const idx = Array.from({ length: 200 }, (_, k) => (reverse ? 199 - k : k));
  return { id, date, lat: idx.map((i) => 35 + i * 5 / 110540), lon: idx.map(() => -83), speed_mps: idx.map(() => 15),
           lon_g: idx.map(() => 0), lat_g: idx.map(() => 0), events: [] };
};
// stub coach: each record says which apex indices carry which tip (null = measured, no tip; 'x' = unmeasured)
const plan = {};
const StubCore = { coach: (d) => ({ corners: Object.entries(plan[d.id] || {}).map(([apex, kind]) =>
  ({ apex: +apex, m: kind === 'x' ? null : {}, tip: kind && kind !== 'x' ? { kind: kind.replace('_vs_best', ''), value: 1, vs_best: kind.endsWith('_vs_best') } : null })) }) };
const corners = () => [{}];
const old = road('old', '2026-10-01'), mid = road('mid', '2026-10-10'), now = road('now', '2026-10-20'), south = road('south', '2026-10-21', true);
plan.old = { 50: 'coast', 100: 'early_apex', 150: 'brake_after_apex' };
plan.mid = { 50: 'x' };                                  // unmeasured last time: the older tip still stands
plan.now = { 100: null, 150: 'min_speed', 30: 'coast_vs_best' };   // "less coasting than your faster pass" is a speed tip              // fixed corner 100; a speed tip is never spoken (and it decides corner 150)
plan.south = { 100: 'coast' };                           // apex 100 southbound is sample 99 northbound: other direction, its own note
const notes = M.build(StubCore, [old, south, now, mid], corners);
out.notes = notes.map((n) => [n.id, n.kind]);
out.text = notes.map((n) => n.text);
// approaching northbound from sample 0 at 15 m/s: the corner at sample 50 (250 m) is said between 120 and 320 m out
const fr = (i, course) => ({ lat: 35 + i * 5 / 110540, lon: -83, course_deg: course });
out.at0 = (M.upcoming(notes, fr(0, 0), 120, 320, new Set()) || {}).id || null;
out.at0South = (M.upcoming(notes, fr(0, 180), 120, 320, new Set()) || {}).id || null;
out.tooFar = M.upcoming(notes, fr(0, 0), 20, 200, new Set());
out.said = M.upcoming(notes, fr(0, 0), 120, 320, new Set(['old:50']));
out.noCourse = M.upcoming(notes, { lat: 35, lon: -83, course_deg: null }, 120, 320, new Set());
out.sideways = M.upcoming(notes, fr(0, 90), 120, 320, new Set());
// with the real coach on a shipped drive and a copy of it, only technique tips are ever spoken
const text = fs.readFileSync('web/data/dry_ridge.js', 'utf8');
const d = JSON.parse(text.slice(text.indexOf('push(') + 5, text.lastIndexOf(');')));
const f = Object.fromEntries(d.fields.map((k, i) => [k, i]));
const col = (k) => d.rows.map((r) => r[f[k]]);
const csv = (scale) => ['distance_m,lat,lon,speed_mph,lon_g,lat_g,camber_deg,roughness_rms',
  ...d.rows.map((r, i) => [r[f.distance_m], r[f.lat], r[f.lon], r[f.speed_mph] * scale, r[f.lon_g], r[f.lat_g], r[f.camber_deg], r[f.roughness_rms]].join(','))].join('\n');
const recs = [R.parse(Core, csv(1), 'a.csv', { id: 'a', date: '2026-10-02' }), R.parse(Core, csv(0.97), 'b.csv', { id: 'b', date: '2026-10-03' })];
const real = M.build(Core, recs, R.cornersOf);
out.realPair = real.length;
const solo = M.build(Core, [recs[0]], R.cornersOf);
out.realKinds = [...new Set(solo.map((n) => n.kind))];
out.realCount = solo.length;
out.longest = Math.max(...Object.values(M.SPOKEN).map((t) => t.length));
// confirmed bumps from your own drives become "Bump ahead" on any road; a bump seen once does not
const hzRec = (id, spike, seen) => ({ ...road(id, '2026-10-0' + id.length), events: [{ type: 'bump', index: spike, lat: 35 + spike * 5 / 110540, lon: -83, seen }] });
const hz = M.hazards([hzRec('a', 100, { hits: 2, passes: 2 }), hzRec('bb', 102, { hits: 2, passes: 2 }), hzRec('ccc', 150, { hits: 1, passes: 3 })]);
out.hz = hz.map((n) => [n.id, n.text]);
out.hzSay = (M.upcoming(hz, fr(85, 0), 25, 100, new Set()) || {}).id || null;      // 75 m before it, inside the call distance
out.hzFar = M.upcoming(hz, fr(0, 0), 25, 100, new Set());
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    root = Path(__file__).resolve().parents[1]
    p = subprocess.run([NODE, "-e", RUNNER], cwd=root, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_latest_pass_decides_and_only_technique_is_spoken(r):
    assert sorted(r["notes"]) == [["old:50", "coast"], ["south:100", "coast"]]
    assert all(t.startswith("Last time") for t in r["text"])


def test_said_once_ahead_and_the_same_way(r):
    assert r["at0"] == "old:50"
    assert r["at0South"] is None                     # driving away from it the other way
    assert r["tooFar"] is None and r["said"] is None and r["noCourse"] is None and r["sideways"] is None


def test_real_coach_never_speaks_a_speed_tip(r):
    assert r["realPair"] > 0                          # the coach's own judgement of the newest pass (vs-best tips: see the stub test)
    assert r["realCount"] > 0 and set(r["realKinds"]) <= {"coast", "brake_after_apex", "early_apex"}
    assert r["longest"] <= 50                        # said well inside the 5 s the cockpit allows


def test_confirmed_bumps_are_called_on_any_road(r):
    assert r["hz"] == [["hz:a:100", "Bump ahead"]]          # one per spot; the single-pass one is not called
    assert r["hzSay"] == "hz:a:100" and r["hzFar"] is None
