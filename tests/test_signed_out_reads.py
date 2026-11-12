"""Signed out, the member-only reads are not sent (web/sync.js apiFetch; Roamer B's first run, 2026-11-11): once the page
knows it is signed out, GET /api/convoy/invites, /api/points, /api/hazards and /api/roads answer 401 on the phone and
nothing goes to the Worker. Before /api/me answers they are still asked; a sign-in asks again; writes are never held."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const m = new Map();
globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
Object.defineProperty(globalThis, 'location', { value: { protocol: 'https:' } });
let me = { signed_in: false };
const sent = [];
globalThis.fetch = async (url, init) => {
  const path = String(url); sent.push(`${(init && init.method) || 'GET'} ${path}`);
  if (path === '/api/me') return new Response(JSON.stringify(me), { status: 200, headers: { 'content-type': 'application/json' } });
  if (/^\/api\/(points|hazards|roads|convoy)/.test(path) && !me.signed_in) return new Response('{"error":"sign_in_required"}', { status: 401 });
  return new Response('[]', { status: 200 });
};
const S = require(process.argv[1] + '/web/sync.js');
const tick = () => new Promise((r) => setTimeout(r, 0));
(async () => {
  const before = (await S.apiFetch('/api/points')).status;          // not known yet: asked
  const n0 = sent.length;
  await S.apiFetch('/api/me'); await tick();
  const held = [];
  for (const p of ['/api/convoy/invites', '/api/points', '/api/hazards?cells=a,b', '/api/roads?ways=1,2']) held.push((await S.apiFetch(p, { method: 'GET' })).status);
  const heldSent = sent.slice(n0 + 1);
  const other = (await S.apiFetch('/api/friends')).status;            // not a member read: still asked
  const write = (await S.apiFetch('/api/hazards', { method: 'POST', body: '{}' })).status;   // a write is never held here
  me = { signed_in: true };
  S.setSession(true);
  const after = (await S.apiFetch('/api/points')).status;
  // a 401 on its own also teaches it (a cookie that expired)
  me = { signed_in: false };
  const first = (await S.apiFetch('/api/roads?cells=x')).status, n1 = sent.length;
  const second = (await S.apiFetch('/api/roads?cells=y')).status;
  console.log(JSON.stringify({ before, held, heldSent, other, write, after, first, second, sentAfter401: sent.length - n1, sent }));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_unknown_still_asks(out):
    assert out["before"] == 401 and out["sent"][0] == "GET /api/points"


def test_signed_out_the_member_reads_are_not_sent(out):
    assert out["held"] == [401, 401, 401, 401]
    assert out["heldSent"] == []


def test_other_reads_and_every_write_still_go(out):
    assert out["other"] == 200 and "GET /api/friends" in out["sent"]
    assert "POST /api/hazards" in out["sent"], "the write reached the Worker (which answers it)"


def test_a_sign_in_asks_again_and_a_401_teaches_it(out):
    assert out["after"] == 200
    assert out["first"] == 401 and out["second"] == 401 and out["sentAfter401"] == 0
