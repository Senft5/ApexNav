"""Phone-side contributor (web/contributor.js): drive + way geometry -> bin summaries. Synthetic roads in the test only, never shipped."""
import json
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const C = require(process.argv[1] + '/web/contributor.js');
const lat0 = 35.0, lon0 = -83.0, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
// A straight east-west way of 6 km starting at lon0 (way node order = west to east).
const way = [[lat0, lon0], [lat0, lon0 + 6000 / mLon]];
const drive = (n, rev = false) => {
  const lat = [], lon = [];
  for (let i = 0; i < n; i++) { const x = (rev ? n - 1 - i : i) * 5; lat.push(lat0 + 3 / 110540); lon.push(lon0 + x / mLon); }
  return { lat, lon, camber: lat.map((_, i) => (i % 7 === 0 ? null : 4)), rough: lat.map(() => 0.2), crest: lat.map((_, i) => 0.1 + (i % 10) / 100), kappa: lat.map(() => 0.01) };
};
const run = (d, m, w = { 77: way }, extra = {}) => C.buildContributions({ drive: d, match: m, ways: w, drivenOn: '2026-10-20', ...extra });
const out = {};
const d = drive(1000);                                           // 5 km drive on a 6 km way
const m = d.lat.map(() => ({ way: 77, cls: 'tertiary' }));
const a = run(d, m);
out.fwd = a.map((c) => ({ way: c.way_id, dir: c.dir, bins: c.bins.length, first: c.bins[0].i, cams: [...new Set(c.bins.map((b) => b.cam))].sort() }));
const r = run(drive(1000, true), m);
out.rev = r.map((c) => ({ dir: c.dir, first: c.bins[0].i, last: c.bins[c.bins.length - 1].i }));
out.skipped = run(d, d.lat.map(() => ({ way: 77, cls: 'residential' }))).length;
out.unmatched = run(d, d.lat.map(() => null)).length;
out.noGeom = run(d, m, {}).length;
out.short = run(drive(300), drive(300).lat.map(() => ({ way: 77, cls: 'tertiary' })), { 77: way }, { trimM: 100 }).length;   // 100 samples inside trim -> 100-40 = 60 bins is ok
out.trimmed = a[0].bins.length;
out.offRoad = run({ ...d, lat: d.lat.map((v) => v + 200 / 110540) }, m).length;
out.noRough = run({ ...d, rough: d.rough.map(() => null) }, m).length;
out.eligible = [C.eligible({ rough: [1], kappa: [1], date: '2026-10-20T10:00' }, Date.parse('2026-10-25')), C.eligible({ rough: [1], kappa: [1], date: '2026-09-01T10:00' }, Date.parse('2026-10-25')), C.eligible({ date: '2026-10-24' }, Date.parse('2026-10-25'))];
// payload contains only the allowed keys
out.keys = Object.keys(a[0]).sort().join() + '|' + Object.keys(a[0].bins[0]).sort().join();
// network shell with a fake fetch: Valhalla trace_attributes + Overpass, then upload
(async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push(url);
    if (url.includes('trace_attributes')) {
      const shape = JSON.parse(init.body).shape;
      return { ok: true, json: async () => ({ edges: [{ way_id: 77, road_class: 'tertiary' }], matched_points: shape.map(() => ({ type: 'matched', edge_index: 0 })) }) };
    }
    return { ok: true, json: async () => ({ elements: [{ type: 'way', id: 77, geometry: way.map(([la, lo]) => ({ lat: la, lon: lo })) }] }) };
  };
  const posted = [];
  const dd = { ...drive(1000), date: '2026-10-22T09:00' };
  const res = await C.contributeDrive(dd, async (c) => { posted.push(c); return true; }, { fetch: fake, now: Date.parse('2026-10-25') });
  out.shell = { res, posted: posted.length, keys: Object.keys(posted[0]).sort().join(), valhalla: calls.filter((u) => u.includes('trace_attributes')).length, overpass: calls.filter((u) => u.includes('overpass')).length };
  const stopped = await C.contributeDrive(dd, async () => 'stop', { fetch: fake, now: Date.parse('2026-10-25') });
  out.stopped = stopped;
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def result():
    root = str(__import__("pathlib").Path(__file__).resolve().parents[1])
    p = subprocess.run([NODE, "-e", RUNNER, root], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_forward_drive_bins_from_way_start(result):
    (c,) = result["fwd"]
    assert c["way"] == 77 and c["dir"] == 0
    assert abs(c["first"] - 200) <= 1                       # 1 km trimmed from the start, bins count from the way's first node
    assert result["trimmed"] == 600                # 1000 samples - 2 * 200 trimmed
    assert c["cams"] == [4, None]   # unknown camber stays null, never filled in


def test_reverse_drive_is_other_direction(result):
    (c,) = result["rev"]
    assert c["dir"] == 1 and c["first"] < c["last"]


def test_private_roads_unmatched_and_missing_geometry_are_skipped(result):
    assert result["skipped"] == 0 and result["unmatched"] == 0 and result["noGeom"] == 0


def test_off_road_and_unknown_roughness_are_not_invented(result):
    assert result["offRoad"] == 0 and result["noRough"] == 0


def test_short_drive_after_trim(result):
    assert result["short"] == 1


def test_eligibility_window(result):
    assert result["eligible"] == [True, False, False]


def test_payload_has_no_coordinates_or_times(result):
    assert result["keys"] == "bins,dir,driven_on,way_id|cam,crest,i,k,rough"


def test_network_shell_matches_fetches_and_uploads_bins_only(result):
    sh = result["shell"]
    assert sh["res"] == {"built": 1, "sent": 1} and sh["posted"] == 1
    assert sh["valhalla"] == 1 and sh["overpass"] == 1
    assert sh["keys"] == "bins,dir,driven_on,way_id"


def test_server_refusal_stops_uploading(result):
    assert result["stopped"] == {"built": 1, "sent": 0}
