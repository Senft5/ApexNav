"""App health counts (web/health.js, IDEAS Y-03): counted per local day, sent once per finished day, kept while offline,
dropped when too old, nothing counted or sent with the switch off; metrics match the Worker's list."""
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
process.env.TZ = 'America/New_York';
const H = require(process.argv[1] + '/web/health.js');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
(async () => {
  const out = {};
  let t = Date.parse('2026-10-27T23:00:00-04:00'), on = true, answer = 204; const sent = [];
  const st = mem();
  const h = H.createHealth(st, async (b) => { if (answer === 'offline') throw new Error('x'); sent.push(b); return answer; }, () => on, () => t);
  h.bump('route_ok'); h.bump('route_ok'); h.bump('calib_lock_s', 41.6); h.bump('nonsense'); h.bump('route_fail', -1);
  out.today = h.peek();
  out.sameDay = await h.flush('ios');                           // today isn't finished: nothing goes
  t += 2 * 3600e3;                                               // 1 AM the next day (local)
  h.bump('drives');
  answer = 'offline'; out.offline = [await h.flush('ios'), Object.keys(h.peek()).length];
  answer = 204; out.back = await h.flush('ios'); out.sent = sent.slice(); out.left = h.peek();
  // a day older than a week is dropped unsent
  st.setItem(H.KEY, JSON.stringify({ '2026-10-01': { drives: 3 } })); sent.length = 0;
  out.old = [await h.flush('web'), sent.length, h.peek()];
  // switched off: nothing counted, stored counts cleared, nothing sent
  h.bump('drives'); on = false; h.bump('route_ok');
  out.off = [await h.flush('web'), sent.length, h.peek()];
  out.metrics = H.METRICS;
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_counts_per_local_day(out):
    assert out["today"] == {"2026-10-27": {"route_ok": 2, "calib_lock_s": 42}}
    assert out["sameDay"] == 0


def test_sent_once_finished_and_kept_offline(out):
    assert out["offline"] == [0, 2]
    assert out["back"] == 1
    assert out["sent"] == [{"day": "2026-10-27", "app": "ios", "counts": {"route_ok": 2, "calib_lock_s": 42}}]
    assert out["left"] == {"2026-10-28": {"drives": 1}}         # today waits for tomorrow


def test_old_days_dropped_and_switch_off(out):
    assert out["old"] == [0, 0, {}]
    assert out["off"] == [0, 0, {}]


def test_metrics_match_the_worker():
    src = open(os.path.join(ROOT, "backend", "src", "health.ts"), encoding="utf-8").read()
    worker = re.findall(r'"([a-z_]+)"', src[src.index("export const METRICS"):src.index("as const")])
    js = json.loads(subprocess.run([NODE, "-e", "console.log(JSON.stringify(require(process.argv[1] + '/web/health.js').METRICS))", ROOT],
                                   capture_output=True, text=True, check=True).stdout)
    assert js == worker
