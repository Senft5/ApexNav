"""Sends that waited for signal (web/outbox.js, IDEAS F-05): kept with no connection, sent in order once it's back with
their age, dropped once taken or refused for good, kept while the server is busy, and capped in count and age."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const O = require(process.argv[1] + '/web/outbox.js');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
(async () => {
  const out = {};
  let t = 1e12, answer = null; const sent = [];
  const store = mem();
  const box = O.createOutbox(store, async (path, body) => { if (answer === 'throw') throw new Error('offline'); sent.push([path, body]); return answer; }, () => t);
  box.add('/api/hazards', { kind: 'gravel' }, true);
  t += 90e3; box.add('/api/hazards/h1/vote', { still: true });
  answer = 'throw'; out.offline = [await box.flush(), box.size()];
  answer = 503; out.busy = [await box.flush(), box.size(), sent.length];        // tried the first, kept both
  sent.length = 0; t += 30e3; answer = 201;
  out.back = [await box.flush(), box.size()]; out.sent = sent.slice();
  // refused for good (a hazard that has gone): dropped, not retried forever
  box.add('/api/hazards/gone/vote', { still: false }); answer = 404;
  out.refused = [await box.flush(), box.size()];
  // capped: only the newest MAX_ITEMS kept; a day old is dropped
  for (let i = 0; i < O.MAX_ITEMS + 5; i++) box.add('/api/hazards', { i });
  out.capped = [box.size(), JSON.parse(store.getItem(O.KEY))[0].body.i];
  t += O.MAX_AGE_MS + 1; out.aged = box.size();
  // two flushes at once send each item once
  const store2 = mem(); let n2 = 0;
  const b2 = O.createOutbox(store2, async () => { n2++; await new Promise(r => setTimeout(r, 10)); return 200; }, () => t);
  b2.add('/x', {}); b2.add('/y', {});
  await Promise.all([b2.flush(), b2.flush()]); out.once = n2;
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_kept_with_no_connection_or_a_busy_server(out):
    assert out["offline"] == [0, 2]
    assert out["busy"] == [0, 2, 1]


def test_sent_in_order_with_their_age_when_back(out):
    assert out["back"] == [2, 0]
    (p1, b1), (p2, b2) = out["sent"]
    assert p1 == "/api/hazards" and b1 == {"kind": "gravel", "age_s": 120}          # made 2 minutes before it went
    assert p2 == "/api/hazards/h1/vote" and b2 == {"still": True}                   # votes carry no age


def test_refused_for_good_is_dropped(out):
    assert out["refused"] == [0, 0]


def test_capped_in_count_and_age(out):
    assert out["capped"] == [20, 5]
    assert out["aged"] == 0


def test_concurrent_flushes_send_once(out):
    assert out["once"] == 2


def test_wired():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert '<script src="outbox.js"></script>' in html
    assert "outbox.add('/api/hazards', body, true)" in html and "outbox.add(path, { still })" in html
    assert "window.addEventListener('online', flushOutbox)" in html
