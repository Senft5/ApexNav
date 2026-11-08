"""Route context `photos` (web/route_ctx/photos.js): photo spots from a real Wikimedia Commons geosearch along Kellogg Avenue
by Riverbend (2026-11-03), and Mapillary in its documented answer shape (no token here, so no live answers; Flickr was
dropped 2026-11-08, its keys no longer offered to free accounts):
speed-limit signs fill a missing limit for 2 km in the direction they face, curve signs mark 250 m."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const root = process.argv[1];
const P = require(root + '/web/route_ctx/photos.js'), C = require(root + '/tests/fixtures/route_ctx/corridor.js'), U = require(root + '/web/route_ctx/ctx_util.js');
const F = (n) => require(root + '/tests/fixtures/route_ctx/' + n);
const nan = (a) => Array.from(a, (v) => (Number.isNaN(v) ? null : Math.round(v * 100) / 100));
const cm = P.parseCommons(F('commons_geosearch_riverbend.json'));
const line = [[39.0560, -84.4400], [39.0500, -84.4150], [39.0420, -84.4000]];
const c = C.corridor('k', line, { departAt: 0 });
const had = new Set(); for (let i = 0; i < c.lat.length; i++) had.add(U.cellOf(c.lat[i], c.lon[i], 0.02));
const some = new Set([...had].slice(0, 1));
const full = P.evaluate(c, { spots: cm.spots, cellsHad: had }), part = P.evaluate(c, { spots: cm.spots, cellsHad: some }), none = P.evaluate(c, { spots: null, signs: null, noToken: true });
// a busy overlook: 30 distinct spots by one sample, 30 more photos at one of them (a batch upload)
const busy = Array.from({ length: 30 }, (_, k) => [c.lat[20] + (k % 6) * 0.0002, c.lon[20] + Math.floor(k / 6) * 0.0002]);
const batch = P.parseCommons({ query: { geosearch: [...busy, ...Array(30).fill(busy[0])].map(([lat, lon]) => ({ lat, lon })) } });
const hot = P.evaluate(c, { spots: batch.spots, cellsHad: had });
// Flickr is gone: no URL builder, no parser, and a key left in the keys does nothing
const flickrGone = !('flickrUrl' in P) && !('parseFlickr' in P);
// Mapillary's documented map_features answer: a 45 mph sign facing eastbound traffic (it faces west), one facing the other
// way, a curve warning, and an unrelated sign
const h = c.heading[5] * 180 / Math.PI;
const signs = P.parseMapillary({ data: [
  { id: '1', object_value: 'regulatory--maximum-speed-limit-45--g3', geometry: { type: 'Point', coordinates: [c.lon[5], c.lat[5]] }, aligned_direction: (h + 180) % 360 },
  { id: '2', object_value: 'regulatory--maximum-speed-limit-25--g3', geometry: { type: 'Point', coordinates: [c.lon[40], c.lat[40]] }, aligned_direction: h },
  { id: '3', object_value: 'warning--curve-left--g1', geometry: { type: 'Point', coordinates: [c.lon[30], c.lat[30]] } },
  { id: '4', object_value: 'regulatory--no-parking--g2', geometry: { type: 'Point', coordinates: [c.lon[10], c.lat[10]] } },
  { id: '5', object_value: 'regulatory--maximum-speed-limit-130--g1', geometry: { type: 'Point', coordinates: [c.lon[12], c.lat[12]] } },
] });
const sg = P.evaluate(c, { spots: null, signs });
console.log(JSON.stringify({
  raw: F('commons_geosearch_riverbend.json').query.geosearch.length, spots: cm.spots.length, capped: cm.capped,
  full: { spots: nan(full.channels.photo_spots), score: Math.max(...nan(full.channels.photo_score)), status: full.status },
  partNull: nan(part.channels.photo_spots).filter((v) => v === null).length, n: c.lat.length,
  none: { status: none.status, note: none.note, spots: [...new Set(nan(none.channels.photo_spots))], sign: [...new Set(nan(none.channels.sign_maxspeed_mps))] },
  batch: batch.spots.length, hot: { max: Math.max(...nan(hot.channels.photo_spots)), score: Math.max(...nan(hot.channels.photo_score)), spans: hot.spans.map((s) => s.kind) },
  flickrGone, signs: signs.map((s) => [s.kind, s.mph || null]),
  sg: { limit: nan(sg.channels.sign_maxspeed_mps), curve: nan(sg.channels.curve_sign), points: sg.points.map((p) => [p.kind, p.label]) },
  urls: [P.commonsUrl([39.04, -84.44, 39.06, -84.42]), P.mapillaryUrl([39.0, -84.5, 39.05, -84.45], 'MLY|t')],
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_commons_spots_are_distinct_positions(out):
    assert out["raw"] == 9 and out["spots"] == 7 and out["capped"] is False   # two files share a spot with others
    f = out["full"]
    assert f["status"] == "partial" and max(f["spots"]) >= 1 and 0 < f["score"] < 0.3   # a quiet riverside road
    assert out["batch"] == 30                                      # 30 more photos at one spot don't count again


def test_unfetched_cells_stay_unknown(out):
    assert 0 < out["partNull"] < out["n"]
    n = out["none"]
    assert n["status"] == "unavailable" and n["spots"] == [None] and n["sign"] == [None] and "Mapillary token" in n["note"]


def test_a_photographed_spot_scores_high(out):
    h = out["hot"]
    assert h["max"] == 30 and h["score"] > 0.95 and h["spans"] == ["photo-spot"]


def test_flickr_is_not_a_source(out):
    assert out["flickrGone"] is True
    assert "Flickr" not in (out["none"]["note"] or "")


def test_mapillary_signs(out):
    assert out["signs"] == [["speed", 45], ["speed", 25], ["curve", None]]   # 130 mph and no-parking dropped
    s = out["sg"]
    lim = s["limit"]
    assert lim[0] is None and lim[5] == 20.12 and lim[60] == 20.12           # 45 mph from its sign on, for this direction
    assert lim[40] == 20.12                                                   # the 25 faces the other way: not ours
    assert s["curve"][29] == 0 and s["curve"][30] == 1 and s["curve"][39] == 1 and s["curve"][41] == 0
    assert ["speed-sign", "45 mph"] in s["points"] and ["curve-sign", "curve left"] in s["points"]


def test_requests_carry_only_a_cell(out):
    cmn, mp = out["urls"]
    assert "gsbbox=39.0600|-84.4400|39.0400|-84.4200" in cmn and "origin=*" in cmn
    assert "bbox=-84.5000,39.0000,-84.4500,39.0500" in mp
