"""One coaching sentence (docs/design/REVIEW5.md U-111): the end card and the Log say the same words for the same drive.
The sentence is written once, by drive_view.js plainCoach over the drive's score and the corner coach against your other
drives (analysis_client.js coachLineOf), in the job that scores the drive at End; the card shows it when the score lands."""
import json
import os
import shutil
import subprocess

import pytest

from tests.page_source import cockpit_source

NODE = shutil.which("node")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1];
globalThis.ApexCore = require(R + '/web/apex_core.js');
const Core = globalThis.ApexCore, Real = require(R + '/web/recording.js');
globalThis.ApexDriveView = require(R + '/web/drive_view.js');
const rec = (id, n, g, phase) => { const lat = [], lon = []; for (let i = 0; i < n; i++) { lat.push(35.36 + i * 5 / 110540); lon.push(-84.29 + Math.sin(i / 12) * 0.0012); }
  const d = { id, name: 'Cherohala Skyway', date: '2026-10-2' + id.length + 'T09:00', date_known: true, source: 'web-gps', lat, lon, dist: lat.map((_, i) => i * 5),
    speed_mps: lat.map((_, i) => 13 + 4 * Math.cos(i / 6 + phase)), lon_g: lat.map((_, i) => g * -0.25 * Math.sin(i / 6 + phase)), lat_g: lat.map((_, i) => g * 0.45 * Math.sin(i / 12)),
    g_known: null, elev: null, hz: 1 };
  const p = Core.profileRecording({ lat: d.lat, lon: d.lon, distance_m: d.dist, speed_mph: d.speed_mps.map((v) => v * 2.2369362921), lon_g: d.lon_g, lat_g: d.lat_g });
  return { ...d, events: p.events, envMps: p.envMps, sightM: p.sightM }; };
const db = new Map([['a', rec('a', 1200, 1, 0)], ['bb', rec('bb', 1200, 1, 0.4)]]);
globalThis.ApexRecording = { ...Real, get: async (id) => db.get(id) || null, summaries: async (C) => [...db.values()].map((d) => Real.summarize(C, d)) };
const A = require(R + '/web/analysis_client.js');
(async () => {
  const card = (await A.jobs.coachLine({ id: 'a' })).coach;
  // the Log: the drive finished as analysis.html does, and the drive job's coach
  const raw = db.get('a'), d = Real.repair(Core, raw), s = Real.scoreOf(Core, d);
  const info = await A.jobs.drive({ id: 'a' });
  const log = globalThis.ApexDriveView.plainCoach(s.ds, info.coach);
  const missing = (await A.jobs.coachLine({ id: 'nope' })).coach;
  console.log(JSON.stringify({ card, log, missing }));
  process.exit(0);
})();
"""


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_card_and_the_log_write_the_same_sentence():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["card"] and out["card"] == out["log"]
    assert "Next time" not in out["card"] and out["card"].count(":") <= 1
    assert out["missing"] is None, "a drive that is not stored has no sentence (unknown stays unknown)"


def test_the_card_takes_the_sentence_from_the_scoring_job():
    src = cockpit_source()
    scored = src[src.index("    function endCardScored("):src.index("    function showEndCard(")]
    assert "Next time" not in scored and "ApexWeekDigest.tip" not in scored
    assert "c.coach" in scored
    assert "coach: res.coach" in src
    worker = open(os.path.join(ROOT, "web", "analysis_worker.js"), encoding="utf-8").read()
    assert "'drive_view.js'" in worker, "the worker writes the sentence with the Log's own writer"


def test_the_end_card_keys_are_fixed_at_first_paint():
    """U-118: Share card solid and Open in the Log a link from the first frame; only a drive with no score changes them."""
    src = cockpit_source()
    opened = src[src.index("    function endCardOpen("):src.index("    function endCardScored(")]
    assert "$('endShare').hidden = false" in opened and "$('endLog').hidden = false" in opened
    assert "$('endLogKey').hidden = true" in opened
