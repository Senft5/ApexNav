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


def test_never_time_or_speed(out):
    words = " ".join(out["spoken"] + out["smoother"]["lines"] + out["rough"]["lines"]).lower()
    assert not re.search(r"faster|speed|later|sooner|carry|push|second|mph|km", words), words


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
