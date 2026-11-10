"""What the app actually posts to /api/contribute (web/sync.js), and which drives' camber may go with it.

Production (2026-11-03) had 15,441 road bins but an empty road_ways: sync.js sent only way_id, dir, driven_on, drive_id and
bins, dropping the way's map line (shape) and road class (cls), so the server's open-road rule (roads.ts) never had a class
and no road driven once was shown. And 13,044 of 14,768 camber values were exactly 0: the old live pipeline decayed camber
to 0 on every straight. A drive carries cam_v 2 only when every camber in it is from the fixed pipeline (recording.js parse,
from the CSV's camber_v column); the server ignores camber from an upload without it."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const posted = [];
globalThis.fetch = async (url, init) => { posted.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 202, json: async () => ({}) }; };
const S = require(process.argv[1] + '/web/sync.js');
const R = require(process.argv[1] + '/web/recording.js'), Core = require(process.argv[1] + '/web/apex_core.js');
const chunk = { way_id: 77, dir: 0, driven_on: '2026-11-03', drive_id: 'd_payload_01', bins: [{ i: 1, cam: 2.5, rough: 0.1, crest: null, k: 0.01 }],
  shape: [[35, -83], [35.01, -83]], cls: 'secondary', cam_v: 2, extra: 'never sent' };
(async () => {
  const r = await S.contribute(chunk);
  const { cam_v, ...old } = chunk;
  await S.contribute({ ...old, shape: undefined, cls: undefined });            // an older chunk without them: null, not dropped silently
  await S.contribute({ ...chunk, rec: 1, hr: 7 });                              // a recorded drive, with a busy-time bucket
  await S.contribute({ ...chunk, rec: 0 });                                      // ambient sharing: no flag, no bucket
  // parse: a CSV with the camber_v column (the current app) carries cam_v 2; one without it (an older build), or a drive
  // whose camber rows are not all marked (kept across an update), does not
  const csv = (mark) => ['segment_index,distance_m,lat,lon,elevation_m,speed_mph,lon_g,lat_g,camber_deg,roughness_rms,source' + (mark ? ',camber_v' : '')]
    .concat(Array.from({ length: 200 }, (_, i) => [i, i * 5, (35 + i * 5 / 110540).toFixed(7), '-83.0000000', '', '30', '0', '0', i % 3 ? '1.50' : '', '0.1', 'web-gps']
      .concat(mark ? [mark === 'mixed' && i === 10 ? '' : i % 3 ? '2' : ''] : []).join(','))).join('\n') + '\n';
  const v = (m) => R.parse(Core, csv(m), 'x_20261103_120000.csv', { source: 'web-gps' }).cam_v;
  console.log(JSON.stringify({ r, posted, parsed: { marked: v('yes'), old: v(null), mixed: v('mixed') } }));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_upload_carries_the_ways_line_and_class(out):
    assert out["r"] is True
    first = out["posted"][0]
    assert first["url"].endswith("/api/contribute")
    assert first["body"] == {"way_id": 77, "dir": 0, "driven_on": "2026-11-03", "drive_id": "d_payload_01",
                             "bins": [{"i": 1, "cam": 2.5, "rough": 0.1, "crest": None, "k": 0.01}],
                             "shape": [[35, -83], [35.01, -83]], "cls": "secondary", "cam_v": 2}
    second = out["posted"][1]["body"]
    assert second["shape"] is None and second["cls"] is None and second["cam_v"] is None


def test_a_recorded_drive_says_so(out):
    """contributor.js built `rec` and `hr` and the server read them (loved roads: a member back on a road on another
    recorded drive), but sync.js dropped both until 2026-11-10, so every pass arrived as ambient and road_love stayed empty."""
    rec, ambient = out["posted"][2]["body"], out["posted"][3]["body"]
    assert rec["rec"] == 1 and rec["hr"] == 7
    assert "rec" not in ambient and "hr" not in ambient
    assert "extra" not in rec
    src = open(os.path.join(ROOT, "backend", "src", "contribute.ts"), encoding="utf-8").read()
    assert "rec: raw.rec === 1 || raw.rec === true" in src and "raw.hr" in src


def test_only_drives_from_the_fixed_pipeline_say_so(out):
    assert out["parsed"] == {"marked": 2, "old": None, "mixed": None}


def test_every_twin_names_the_same_camber_version():
    """The marker is one number everywhere: ApexKit writes it in every frame, journal frame and CSV row; the page records
    camber only from frames carrying it; the server keeps camber only from uploads carrying it."""
    read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()            # noqa: E731
    imu, app = read("ApexKit", "Sources", "ApexKit", "IMUPipeline.swift"), read("ApexNavApp.swift")
    assert "public static let camberVersion = 2" in imu and "public private(set) var camberRad: Double?" in imu
    assert 'camberV = "camber_v"' in app and "try c.encode(camberV, forKey: .camberV)" in app
    assert "camberV: IMUPipeline.camberVersion))" in app, "journal frames carry it"
    assert 'vert_peak_g,camber_v"' in app and "String(IMUPipeline.camberVersion)," in app, "the CSV carries it per row"
    assert "pipeline.camberRad * 180.0" not in app, "camber is optional: nil stays nil, never 0"
    assert "const CAMBER_V = 2;" in read("web", "sensors.js") and "const CAM_V = 2;" in read("web", "contributor.js")
    assert "export const CAM_V = 2;" in read("backend", "src", "contribute.ts")
