"""Live coaching against your best pass on any road driven before (web/pass_coach.js): each remembered corner is
scored as you finish it and set against its best; a stretch of them gives a running delta. Technique, never time or
speed: no line ever urges more speed, and the wrong way or another road says nothing."""
import json
import os
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1];
const Core = require(R + '/web/apex_core.js'), Rec = require(R + '/web/recording.js'), P = require(R + '/web/pass_coach.js');
const MPH = 2.2369362921;
function road() {
  const lat = [], lon = []; let la = 35.6, lo = -83.9, h = 0;
  for (let i = 0; i < 1000; i++) {
    const inEsses = i > 100 && i < 700;
    h += inEsses ? 0.05 * Math.sin((i - 100) / 25) : 0;
    la += 5 * Math.cos(h) / 110540; lo += 5 * Math.sin(h) / (111320 * Math.cos(35.6 * Math.PI / 180));
    lat.push(la); lon.push(lo);
  }
  return { lat, lon };
}
function pass({ lat, lon }, jitter, seed = 1) {
  const { kappa } = Core.computeCurvature(lat, lon);
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const v = kappa.map((k) => Math.max(9, 22 - 300 * Math.abs(k)));
  const latG = v.map((x, i) => x * x * kappa[i] / 9.80665 + jitter * rnd());
  const lonG = v.map((x, i) => (i ? (x * x - v[i - 1] ** 2) / (2 * 5) / 9.80665 : 0));
  return { v, latG, lonG };
}
function drive(id, date, rd, p) {
  const prof = Core.profileRecording({ lat: rd.lat, lon: rd.lon, distance_m: rd.lat.map((_, i) => i * 5), speed_mph: p.v.map((x) => x * MPH), lon_g: p.lonG, lat_g: p.latG });
  return { id, date, lat: rd.lat, lon: rd.lon, dist: rd.lat.map((_, i) => i * 5), speed_mps: p.v, lon_g: p.lonG, lat_g: p.latG, events: prof.events, g_known: null };
}
const cornersOf = (d) => Rec.scorableCorners(d, Rec.cornersOf(d));
const rd = road();
const smoothD = drive('smooth', '2026-11-01', rd, pass(rd, 0.04, 7)), roughD = drive('rough', '2026-11-05', rd, pass(rd, 0.25, 3));
const both = P.build(Core, [roughD, smoothD], cornersOf), roughOnly = P.build(Core, [roughD], cornersOf);
const out = { corners: cornersOf(smoothD).length, refs: both.length, twice: both.filter((r) => r.n === 2).length,
              bestFrom: [...new Set(both.map((r) => r.driveId))] };
const rowsOf = (x, p) => x.lat.map((_, i) => ({ lat: x.lat[i], lon: x.lon[i], speed_mps: p.v[i], lat_g: p.latG[i], lon_g: p.lonG[i] }));
function live(rows, refs) {
  const c = P.createCoach(Core, refs), evs = [], views = [];
  for (let i = 0; i < rows.length; i += 4) { const r = c.update(rows.slice(0, i + 1)); evs.push(...r.events); if (r.view) views.push(r.view); }
  const corners = evs.filter((e) => e.kind === 'corner');
  return { corners: corners.length, deltas: corners.map((e) => e.delta), stretches: evs.filter((e) => e.kind === 'stretch').map((e) => ({ n: e.n, delta: e.delta })),
           lines: evs.map((e) => e.say).filter(Boolean), midView: views.filter((v) => v.delta != null).length };
}
out.same = live(rowsOf(rd, pass(rd, 0.04, 7)), both);
out.rough = live(rowsOf(rd, pass(rd, 0.3, 11)), both);
out.smoother = live(rowsOf(rd, pass(rd, 0.0, 5)), roughOnly);
const back = { lat: rd.lat.slice().reverse(), lon: rd.lon.slice().reverse() };
out.backwards = live(rowsOf(back, pass(back, 0.04, 7)), both);
const elsewhere = { lat: rd.lat.map((x) => x + 0.05), lon: rd.lon };
out.elsewhere = live(rowsOf(elsewhere, pass(elsewhere, 0.04, 7)), both);
out.labels = [P.label(12), P.label(-8), P.label(0), P.label(null)];
out.spoken = Object.values(P.SPOKEN);
out.say = [P.line({ kind: 'stretch', delta: 14 }), P.line({ kind: 'stretch', delta: -9 }), P.line({ kind: 'stretch', delta: 0 }), P.line({ kind: 'stretch', delta: null }),
           P.line({ kind: 'corner', delta: 5 })];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_each_corner_is_remembered_once_with_its_best_pass(out):
    assert out["corners"] >= 6
    assert out["refs"] == out["corners"] and out["twice"] == out["refs"]
    assert out["bestFrom"] == ["smooth"], "the smoother pass is the best, though the rough one is newer"


def test_the_same_pass_is_level_and_says_so_once_the_stretch_ends(out):
    s = out["same"]
    assert s["corners"] == out["corners"] and all(d == 0 for d in s["deltas"])
    assert s["stretches"] == [{"n": out["corners"], "delta": 0}]
    assert s["lines"] == ["Level with your best."]
    assert s["midView"] > 0, "the bar shows the delta during the stretch"


def test_smoother_says_best_rougher_names_what_was_cleaner(out):
    sm, ro = out["smoother"], out["rough"]
    assert sm["stretches"][0]["delta"] > 0 and "Best yet through there." in sm["lines"]
    assert sm["lines"][-1].startswith("Best stretch yet.")
    assert ro["stretches"][0]["delta"] < 0 and ro["lines"][-1].startswith("That stretch:")
    assert any(l in ("Smoother on your best.", "Brakes were cleaner on your best.") for l in ro["lines"])
    # sparse: each hint once a stretch, "best yet" at most every third corner
    assert len(set(ro["lines"])) == len(ro["lines"]) and len(ro["lines"]) <= 3
    assert sm["lines"].count("Best yet through there.") <= (sm["corners"] + 2) // 3


def test_wrong_way_or_another_road_says_nothing(out):
    assert out["backwards"]["corners"] == 0 and out["backwards"]["lines"] == []
    assert out["elsewhere"]["corners"] == 0


def test_technique_lines_never_urge_speed(out):
    """Where no clock is known the lines are technique: never "faster", never a grip-use push."""
    words = " ".join(out["smoother"]["lines"] + out["rough"]["lines"]).lower()
    assert not re.search(r"faster|speed|carry|push|mph|km", words), words


def test_lines_and_labels(out):
    assert out["say"] == ["Best stretch yet. 14 up.", "That stretch: 9 down on your best.", "Level with your best.", None, None]
    assert out["labels"] == ["+12 vs best", "−8 vs best", "level with best", "--"]


def test_the_fixed_lines_are_in_the_voice_table():
    import sys
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import voicebank
    lines = {v for k, v in voicebank.voice_lines().items() if k.startswith("line:")}
    src = open(os.path.join(ROOT, "web", "pass_coach.js"), encoding="utf-8").read()
    block = src[src.index("const SPOKEN"):src.index("};", src.index("const SPOKEN"))]
    for text in re.findall(r": '([^']+)'", block):
        assert text in lines, text


TIMED = r"""
const R = process.argv[1];
const Core = require(R + '/web/apex_core.js'), Rec = require(R + '/web/recording.js'), P = require(R + '/web/pass_coach.js');
const MPH = 2.2369362921, lat = [], lon = [];
let la = 35.6, lo = -83.9, h = 0;
for (let i = 0; i < 1000; i++) { if (i > 100 && i < 700) h += 0.05 * Math.sin((i - 100) / 25);
  la += 5 * Math.cos(h) / 110540; lo += 5 * Math.sin(h) / (111320 * Math.cos(35.6 * Math.PI / 180)); lat.push(la); lon.push(lo); }
const { kappa } = Core.computeCurvature(lat, lon);
const base = kappa.map((k) => Math.max(9, 22 - 300 * Math.abs(k)));
const prof0 = Core.profileRecording({ lat, lon, distance_m: lat.map((_, i) => i * 5), speed_mph: base.map((x) => x * MPH), lon_g: base.map(() => 0), lat_g: base.map((x, i) => x * x * kappa[i] / 9.80665) });
const shape = Rec.cornersOf({ lat, lon, speed_mps: base, lon_g: base.map(() => 0), lat_g: base.map(() => 0), events: prof0.events, g_known: null });
// a pass at k times the speed, braking `lead` samples before each corner's start (at -0.3 g) up to just before the apex
function pass(k, lead) {
  const v = base.map((x) => x * k), latG = v.map((x, i) => x * x * kappa[i] / 9.80665), lonG = v.map(() => 0);
  for (const c of shape) for (let q = Math.max(0, c.start - lead); q < c.apex - 1; q++) lonG[q] = -0.3;
  const t_s = [0]; for (let i = 1; i < v.length; i++) t_s.push(t_s[i - 1] + 5 / v[i]);
  return { v, latG, lonG, t_s };
}
function drive(id, date, p) {
  const prof = Core.profileRecording({ lat, lon, distance_m: lat.map((_, i) => i * 5), speed_mph: p.v.map((x) => x * MPH), lon_g: p.lonG, lat_g: p.latG });
  return { id, date, lat, lon, dist: lat.map((_, i) => i * 5), speed_mps: p.v, lon_g: p.lonG, lat_g: p.latG, t_s: p.t_s, events: prof.events, g_known: null };
}
const cornersOf = (d) => Rec.scorableCorners(d, Rec.cornersOf(d));
const fast = drive('fast', '2026-11-01', pass(1, 3)), slow = drive('slow', '2026-11-05', pass(0.9, 10));
const refs = P.build(Core, [slow, fast], cornersOf, { timesOf: (d) => d.t_s });
const rowsOf = (p) => lat.map((_, i) => ({ lat: lat[i], lon: lon[i], speed_mps: p.v[i], lat_g: p.latG[i], lon_g: p.lonG[i], t_s: p.t_s[i] }));
function live(p) {
  const c = P.createCoach(Core, refs), evs = [], views = [];
  for (let i = 0; i < 1000; i += 4) { const r = c.update(rowsOf(p).slice(0, i + 1)); evs.push(...r.events); if (r.view) views.push(r.view); }
  return { lines: evs.map((e) => e.say).filter(Boolean), gaps: evs.filter((e) => e.kind === 'corner').map((e) => e.gap),
           stretch: evs.filter((e) => e.kind === 'stretch').map((e) => e.gap), bar: views.length ? P.label(views[views.length - 1].delta, views[views.length - 1].gap) : null };
}
console.log(JSON.stringify({
  refs: refs.length, fastIds: [...new Set(refs.map((r) => r.fastId))], timed: refs.filter((r) => r.tBest > 0).length,
  notes: P.notes(refs).map((n) => n.text), noteN: P.notes(refs).length,
  same: live(pass(1, 3)), slow: live(pass(0.9, 10)), quick: live(pass(1.06, 3)),
  spoken: [P.spoken(0.3), P.spoken(-0.1), P.spoken(1.44), P.spoken(-0.86)],
}));
"""


@pytest.fixture(scope="module")
def timed():
    return json.loads(subprocess.run([NODE, "-e", TIMED, ROOT], capture_output=True, text=True, check=True).stdout)


def test_each_corner_keeps_its_fastest_pass(timed):
    assert timed["refs"] >= 6 and timed["timed"] == timed["refs"]
    assert timed["fastIds"] == ["fast"], "the quicker pass is the time to beat, though the slow one is newer"


def test_brake_later_here_where_the_latest_pass_braked_early_and_lost_time(timed):
    assert timed["noteN"] >= timed["refs"] // 2 and set(timed["notes"]) == {"Brake later here."}


def test_the_same_pass_is_level(timed):
    s = timed["same"]
    assert all(abs(g) < 0.05 for g in s["gaps"]) and s["lines"] == ["Level with your best."]


def test_slower_says_how_much_and_to_brake_later(timed):
    s = timed["slow"]
    assert s["stretch"][0] > 0.3 and s["lines"][-1].startswith("That stretch: ") and s["lines"][-1].endswith(" down on your best.")
    assert any(l.endswith("down. Brake later.") for l in s["lines"]), s["lines"]
    assert s["bar"].startswith("+") and s["bar"].endswith(" s vs best")


def test_quicker_says_best_yet(timed):
    q = timed["quick"]
    assert q["stretch"][0] < 0 and q["lines"][-1].startswith("Best stretch yet. ") and q["lines"][-1].endswith(" up.")
    assert any(l.startswith("Best yet. ") for l in q["lines"])
    assert q["bar"].startswith("−")


def test_gaps_are_said_in_tenths(timed):
    assert timed["spoken"] == ["Three tenths", "One tenth", "1.4 seconds", "Nine tenths"]
