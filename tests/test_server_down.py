"""Workers Free's daily limit (backend index.ts D1_DAILY): the API answers 503 service_unavailable until midnight UTC.
web/sync.js apiFetch notices it and fires 'apex:server-down' once per outage, with the time it ends; the cockpit says so
once instead of "Check signal" on every tap. Any other 503 (a passing Worker error) says nothing."""
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
let answer = null;
globalThis.fetch = async () => answer;
const et = new EventTarget(), events = [];
globalThis.addEventListener = et.addEventListener.bind(et); globalThis.dispatchEvent = et.dispatchEvent.bind(et);
globalThis.addEventListener('apex:server-down', (e) => events.push(e.detail.until));
const S = require(process.argv[1] + '/web/sync.js');
const tick = () => new Promise((r) => setTimeout(r, 0));
(async () => {
  answer = new Response('{"error":"internal"}', { status: 503 });
  await S.apiFetch('/api/friends'); await tick();
  const otherError = events.length;
  answer = new Response('{"error":"service_unavailable"}', { status: 503 });
  await S.apiFetch('/api/friends'); await tick();
  await S.apiFetch('/api/hazards', { method: 'POST', body: '{}' }); await tick();
  const until = S.serverDownUntil();
  console.log(JSON.stringify({ otherError, events, until, now: Date.now(),
    midnight: S.nextMidnightUtc(Date.UTC(2026, 10, 13, 20, 30)), endOfMonth: S.nextMidnightUtc(Date.UTC(2026, 10, 30, 23, 59)) }));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_a_passing_503_says_nothing(out):
    assert out["otherError"] == 0


def test_the_daily_limit_is_said_once_with_its_end(out):
    assert len(out["events"]) == 1
    assert out["events"][0] == out["until"] > out["now"]
    assert out["until"] - out["now"] <= 86400_000


def test_it_ends_at_the_next_midnight_utc(out):
    assert out["midnight"] == 1794614400000  # 2026-11-14T00:00:00Z
    assert out["endOfMonth"] == 1796083200000  # 2026-12-01T00:00:00Z


def test_the_cockpit_says_it():
    src = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "addEventListener('apex:server-down'" in src
