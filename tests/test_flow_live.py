"""web/flow_live.js (IDEAS D-30, part four): the co-driver counts corners driven smooth and settled in a row while you drive,
judged by the same rule as the drive page's best run (flow.js) on the live 5 m rows, and says it at five, ten and every ten
after. The real Dry Ridge geometry driven gently (steady speed, lateral g from the road's own curvature, no braking) gives
the same run live as the whole drive gives afterwards."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="needs node")

DRIVE = r"""
const R = process.argv[1];
const C = require(R + '/web/apex_core.js'), F = require(R + '/web/flow.js'), L = require(R + '/web/flow_live.js');
const text = require('fs').readFileSync(R + '/web/data/dry_ridge.js', 'utf8');
const d = JSON.parse(text.slice(text.indexOf('push(') + 5, text.lastIndexOf(');')));
const f = Object.fromEntries(d.fields.map((k, i) => [k, i]));
const lat = d.rows.map((r) => r[f.lat]), lon = d.rows.map((r) => r[f.lon]);
const { kappa } = C.computeCurvature(lat, lon);
const live = (v0, g = true, opts = {}) => {
  const rows = lat.map((_, i) => ({ distance_m: i * 5, lat: lat[i], lon: lon[i], speed_mps: v0, lon_g: g ? 0 : null,
    lat_g: g ? Math.round(v0 * v0 * kappa[i] / 9.80665 * 1e4) / 1e4 : null }));
  const w = L.createWatch(C, F, opts), said = [], seen = [];
  if (opts.best != null) w.setBest(opts.best);
  let best = 0;
  for (let i = 1; i <= rows.length; i++) { const r = w.update(rows.slice(0, i)); if (r) { best = Math.max(best, r.run); if (r.say) said.push(r.say); } }
  const V = rows.map((r) => r.speed_mps), LO = rows.map((r) => (r.lon_g == null ? NaN : r.lon_g)), LA = rows.map((r) => (r.lat_g == null ? NaN : r.lat_g));
  const prof = C.profileRecording({ lat, lon, distance_m: rows.map((r) => r.distance_m), speed_mph: V.map((v) => v * 2.2369362920544), lon_g: LO, lat_g: LA });
  let cs = prof.events.filter((e) => e.type === 'corner').map((e) => ({ start: Math.round(e.start_m / 5), end: Math.round(e.end_m / 5), apex: e.index, apex_mps: e.apex_mph / 2.2369362920544 }));
  if (opts.mu) cs = C.cornersForCar(cs, opts.mu);
  const after = F.longest(C, V, LO, LA, cs, rows.map((r) => r.distance_m));
  return { best, said, after: after ? after.corners : 0 };
};
console.log(JSON.stringify(JSON.parse(process.argv[2]).map((a) => live(...a))));
"""


def drive(*cases):
    out = subprocess.run([NODE, "-e", DRIVE, str(ROOT), json.dumps(cases)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


@needs_node
def test_live_count_matches_the_drive_afterwards():
    gentle, brisk, blind, heavy = drive([6], [10], [6, False], [6, True, {"mu": 0.35}])
    # gently: an 18-corner run live, as afterwards; said at five and ten (twenty never came), and again on a later run
    assert gentle["best"] == gentle["after"] == 18
    assert gentle["said"] == ["Five clean in a row.", "Ten clean in a row.", "Five clean in a row.", "Ten clean in a row."]
    assert brisk["best"] == brisk["after"] == 7 and brisk["said"] == ["Five clean in a row."]
    # no g (a mount that never calibrated): no corner can be judged, so nothing is ever said
    assert blind["best"] == blind["after"] == 0 and blind["said"] == []
    # a car with less grip lowers each corner's limit, as the saved drive is scored: live agrees with afterwards
    assert heavy["best"] == heavy["after"]


@needs_node
def test_milestones_and_words():
    src = f"const L = require({json.dumps(str(ROOT / 'web' / 'flow_live.js'))});" \
          "console.log(JSON.stringify([[1,4,5,6,9,10,11,15,20,30,47].filter(L.milestone), L.text(5), L.text(20), L.text(42), L.text(120)]));"
    got = json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)
    assert got == [[5, 10, 20, 30], "Five clean in a row.", "Twenty clean in a row.", "Forty-two clean in a row.", "120 clean in a row."]


def test_wiring():
    page = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert page.index('src="flow.js"') < page.index('src="flow_live.js"')
    js = (ROOT / "web" / "cockpit.js").read_text(encoding="utf-8")
    assert "ApexFlowLive.createWatch(Core, ApexFlow" in js
    assert "const quiet = limitSay || brakeSay || sunSay || breakSay || flowSay;" in js     # the lowest of the quiet slots
    assert "drive.flow = null" in js                                    # every drive starts its count again


@needs_node
def test_passing_the_months_best_run_is_said_once():
    """Passing this month's best run (the Log's summaries, read after Start) is said once a drive, in place of a
    milestone on the same corner; a month's best under five is no record to speak of."""
    seven, four, ten = drive([6, True, {"best": 7}], [6, True, {"best": 4}], [6, True, {"best": 9}])
    assert seven["said"] == ["Five clean in a row.", "Eight clean in a row, your best this month.", "Ten clean in a row.",
                             "Five clean in a row.", "Ten clean in a row."]
    assert four["said"] == ["Five clean in a row.", "Ten clean in a row.", "Five clean in a row.", "Ten clean in a row."]
    assert ten["said"] == ["Five clean in a row.", "Ten clean in a row, your best this month.", "Five clean in a row.", "Ten clean in a row."]
    src = f"const L = require({json.dumps(str(ROOT / 'web' / 'flow_live.js'))});" \
          "const m = (o) => (/^\\d{4}-\\d{2}/.test(o.date || '') ? o.date.slice(0, 7) : null);" \
          "console.log(JSON.stringify([L.monthBest([{ date: '2026-11-02', run: { corners: 6 } }, { date: '2026-11-09', run: { corners: 11 } }," \
          " { date: '2026-10-30', run: { corners: 30 } }, { date: '2026-11-03', run: null }, { date: '', run: { corners: 40 } }, { date: '2026-11-04' }], m, '2026-11')," \
          " L.monthBest([], m, '2026-11'), L.monthBest([{ date: '2026-11-02', run: { corners: 6 } }], null, '2026-11')]));"
    got = json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)
    assert got == [11, None, None]
