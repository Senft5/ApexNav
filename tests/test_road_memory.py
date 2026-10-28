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
const hzRec = (id, spike, seen, g) => ({ ...road(id, '2026-10-0' + id.length), events: [{ type: 'bump', index: spike, lat: 35 + spike * 5 / 110540, lon: -83, seen, severity_g: g }] });
const hz = M.hazards([hzRec('a', 100, { hits: 2, passes: 2 }, 0.4), hzRec('bb', 102, { hits: 2, passes: 2 }, 0.6), hzRec('ccc', 150, { hits: 1, passes: 3 }, 0.9)]);
out.hz = hz.map((n) => [n.id, n.text, n.severity_g]);
out.hzUnknownG = M.hazards([hzRec('a', 100, { hits: 2, passes: 2 }, undefined)])[0].severity_g;
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
    assert r["hz"] == [["hz:a:100", "Bump ahead", 0.6]]     # one per spot, the hardest hit kept; a single pass is not called
    assert r["hzUnknownG"] is None                           # unmeasured severity stays unknown (quiet mode then skips it)
    assert r["hzSay"] == "hz:a:100" and r["hzFar"] is None


def test_break_cue_from_technique_or_time_since_the_last_stop():
    runner = r"""
const M = require(process.argv[1] + '/web/road_memory.js');
const fa = (cues) => ({ minutes: 70, early: {}, late: {}, cues });
const t = (c) => (c ? c.text : null);
// the rest clock: an hour after the start, a check every 10 min; a 15 min stop restarts it at the recorder's row then
const min = 60000;
let [w, due] = M.restTick(null, 0, true, 0);
const dues = [];
for (let m = 1; m <= 80; m++) { [w, due] = M.restTick(w, m * min, true, m * 100); if (due) dues.push(m); }
const before = w.since;
[w, due] = M.restTick(w, 90 * min, false, 8000);                      // parked: nothing changes while stopped
[w, due] = M.restTick(w, 96 * min, true, 8000);                       // 16 min since it last moved: a new stretch
const restarted = [w.since, w.row0, due];
[w, due] = M.restTick(w, 106 * min, true, 9000);                      // a 10 min fuel stop does not restart it
console.log(JSON.stringify({
  steer: t(M.breakCue(fa(['steering', 'braking']), 4000, null)), brake: t(M.breakCue(fa(['braking']), 4000, 3000)),
  fresh: M.breakCue(fa([]), 5000, null), unknown: M.breakCue(null, 5000, null), two: M.breakCue(null, 7300, null),
  three: t(M.breakCue(fa([]), 3 * 3600 + 60, 2800)), soon: M.breakCue(fa(['steering']), 9000, 600), stop: M.STOP_RESETS_S,
  dues, before, restarted, fuel: w.since,
  rebased: M.rebase([{ distance_m: 5000, lat: 1 }, { distance_m: 5005, lat: 2 }]),
}));
"""
    root = str(Path(__file__).resolve().parents[1])
    p = subprocess.run([NODE, "-e", runner, root], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout)
    assert r["steer"] == "Your steering is getting busier than earlier. Time for a break?"
    assert r["brake"] == "More braking past the apex than earlier. Time for a break?"
    assert r["fresh"] is None and r["unknown"] is None              # under two hours and no fade: nothing to say
    assert r["two"] == {"kind": "time", "text": "You've been on the road two hours. Time for a break?"}
    assert r["three"].startswith("You've been on the road three hours") and r["soon"] is None   # never again within 45 min
    assert r["stop"] == 900
    assert r["dues"] == [60, 70, 80] and r["before"] == 0           # an hour in, then every 10 min
    assert r["restarted"] == [96 * 60000, 8000, False] and r["fuel"] == 96 * 60000
    assert r["rebased"] == [{"distance_m": 0, "lat": 1}, {"distance_m": 5, "lat": 2}]   # corner indexes point into the slice
