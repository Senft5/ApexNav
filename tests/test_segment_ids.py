"""Segment ids (web/sync.js, IDEAS Y-14): fresh ids don't collide; an old id someone else holds is replaced and sent again."""
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
globalThis.fetch = async (url, init) => {
  if (url.endsWith('/api/me')) return { ok: true, status: 200, json: async () => ({ signed_in: true, member: true }) };
  const b = JSON.parse(init.body); posted.push(b.id);
  if (b.id === 'seg_1700000000000') return { ok: false, status: 409, json: async () => ({ error: 'id_taken' }) };
  if (b.id === 'seg_bad') return { ok: false, status: 400, json: async () => ({ error: 'bad' }) };
  return { ok: true, status: 201, json: async () => ({ id: b.id }) };
};
const S = require(process.argv[1] + '/web/sync.js');
const seg = (id) => ({ id, name: 'X', length_m: 500, lat0: 35, lon0: -83, lat1: 35.01, lon1: -83 });
(async () => {
  const segs = [seg('seg_1700000000000'), seg('seg_bad'), { ...seg('seg_done'), synced: true }];
  const sent = await S.pushSegments(segs);
  const ids = new Set(Array.from({ length: 2000 }, () => S.newSegmentId()));
  console.log(JSON.stringify({ sent, segs, posted, unique: ids.size, sample: S.newSegmentId() }));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_taken_id_is_replaced_and_sent(out):
    assert out["sent"] == 1
    fresh = out["segs"][0]
    assert fresh["synced"] is True and fresh["id"] != "seg_1700000000000"
    assert out["posted"] == ["seg_1700000000000", fresh["id"], "seg_bad"]      # a bad segment is tried once, never re-id'd
    assert out["segs"][1] == {"id": "seg_bad", "name": "X", "length_m": 500, "lat0": 35, "lon0": -83, "lat1": 35.01, "lon1": -83}


def test_new_ids_are_unique_and_url_safe(out):
    import re
    assert out["unique"] == 2000
    assert re.fullmatch(r"seg_\d{13}_[0-9a-f]{12}", out["sample"])
