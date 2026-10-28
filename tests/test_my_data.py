"""Your data (web/my_data.js, IDEAS Z-03/Z-04): drives as GPX, what the phone holds, which keys are erased."""
import json
import os
import shutil
import subprocess
import xml.etree.ElementTree as ET

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const M = require(process.argv[1] + '/web/my_data.js');
const store = { m: { 'apex.highlights': '[1,2]', 'apex.privacyZones': '[{}]', 'apex.session': 'tok', 'other.key': 'x', 'apex.recentPlaces': 'not json' },
  get length() { return Object.keys(this.m).length; }, key(i) { return Object.keys(this.m)[i]; }, getItem(k) { return this.m[k] ?? null; } };
const drives = [{ name: 'Dragon <& co>', date: '2026-10-20T15:00:00Z', lat: [35.6, 35.601, NaN], lon: [-83.9, -83.901, -83.9], elev: [300, null, 1], dist: [0, 1609.344 * 2] },
                { name: 'Empty', lat: [], lon: [], dist: [] }];
console.log(JSON.stringify({ gpx: M.toGpx(drives), sum: M.phoneSummary(drives, store), keys: M.keysToClear(store).sort() }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_gpx_is_valid_and_keeps_unknown_out(out):
    ns = {"g": "http://www.topografix.com/GPX/1/1"}
    root = ET.fromstring(out["gpx"])
    trks = root.findall("g:trk", ns)
    assert len(trks) == 1                                                        # the empty drive is skipped
    assert trks[0].find("g:name", ns).text == "Dragon <& co>"                    # escaped in the file, intact when read
    pts = trks[0].findall(".//g:trkpt", ns)
    assert [(p.get("lat"), p.get("lon")) for p in pts] == [("35.600000", "-83.900000"), ("35.601000", "-83.901000")]   # NaN point left out
    assert pts[0].find("g:ele", ns).text == "300.0" and pts[1].find("g:ele", ns) is None


def test_summary_and_keys(out):
    assert out["sum"] == {"drives": 2, "miles": 2.0, "spots": 2, "zones": 1, "places": 0, "signedIn": True}
    assert out["keys"] == ["apex.highlights", "apex.privacyZones", "apex.recentPlaces", "apex.session"]
