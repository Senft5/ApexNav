"""U-91: the end card and the Log give the same Vetta Score for the same drive.

The end card scored the record ApexRecording.parse returns, which has no `corners` (the Log derives them with
cornersOf), so every drive ended on "-- /1000" while the Log gave 602. Both now call ApexRecording.scoreOf.
"""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The real recorded drive (web/data/dry_ridge.js) written out as the CSV the phone records, then parsed as End parses it.
RUNNER = r"""
const root = process.argv[1];
globalThis.window = globalThis;
const Core = globalThis.ApexCore = require(root + '/web/apex_core.js');
const R = require(root + '/web/recording.js');
require(root + '/web/data/dry_ridge.js');
const src = window.APEX_DRIVES[0], f = src.fields, col = (k) => f.indexOf(k);
const want = ['distance_m', 'lat', 'lon', 'elevation_m', 'speed_mph', 'lon_g', 'lat_g', 'camber_deg', 'roughness_rms', 'crest_vertical_g', 'vert_peak_g'];
const rows = src.rows;
const csv = [want.join(','), ...rows.map((r) => want.map((k) => (r[col(k)] == null ? '' : r[col(k)])).join(','))].join('\n');
const d = R.parse(Core, csv, 'web_20261030_070000.csv', { source: 'web-gps' });
let old = null;
try { old = Core.driverScore(d.speed_mps, d.lon_g, d.lat_g, R.scorableCorners(d, d.corners)).score; } catch (_) { old = 'threw'; }
const card = R.scoreOf(Core, d);
const stored = JSON.parse(JSON.stringify(d));       // the Log reads the stored record back
const log = R.scoreOf(Core, stored);
const withCar = R.scoreOf(Core, { ...d, car: { label: 'Tacoma', mu: 0.52 } });
console.log(JSON.stringify({ hadCorners: 'corners' in d, old: Number.isFinite(old) ? old : String(old), card: card.ds.score, log: log.ds.score,
  corners: card.corners.length, logCorners: log.corners.length, car: withCar.ds.score }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_parsed_drive_has_no_corners_so_the_old_card_had_no_score(out):
    assert out["hadCorners"] is False
    assert out["old"] in ("NaN", "threw", "null", "undefined"), "the bug this pins: scoring d.corners of a parsed record"


def test_end_card_and_log_agree(out):
    assert isinstance(out["card"], (int, float)) and 0 < out["card"] <= 1000, "a drive with corners has a score"
    assert out["card"] == out["log"]
    assert out["corners"] == out["logCorners"] > 0


def test_score_is_for_the_car(out):
    assert out["car"] is not None and out["car"] != out["card"]


def test_every_page_scores_through_score_of():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    log = open(os.path.join(ROOT, "web", "analysis.html"), encoding="utf-8").read()
    end = html[html.index("    function showEndCard("):html.index("    function showEndTrail(")]
    assert "ApexRecording.scoreOf(Core, d)" in end and "Core.driverScore(" not in end
    assert "Date.now() - startedAt" not in end, "the card's time is the recording's, as the Log's is"
    assert "Core.elapsedS(d.speed_mps)" in end
    assert "ApexRecording.scoreOf(Core, d)" in log
    tick = html[html.index("    function liveScoreTick("):html.index("    function noteRoads(")]
    assert "ApexRecording.scoreOf(Core, d)" in tick
