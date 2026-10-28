"""Share your ETA page (web/eta_share.js, IDEAS S-19): who and when in plain words, freshness, the ended states, and
never anything about where."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
process.env.TZ = 'America/New_York';
const E = require(process.argv[1] + '/web/eta_share.js');
const now = Date.parse('2026-10-30T21:30:00Z');                     // 5:30 PM in New York
const v = (o) => ({ handle: 'nate', arrive_at: '2026-10-30T21:42:00Z', updated_at: '2026-10-30T21:29:30Z', ended: null, ...o });
console.log(JSON.stringify({
  live: E.viewText(v({}), now, 'en-US'), stale: E.viewText(v({ updated_at: '2026-10-30T21:20:00Z' }), now, 'en-US'),
  due: E.viewText(v({ arrive_at: '2026-10-30T21:30:30Z' }), now, 'en-US'),
  arrived: E.viewText(v({ ended: 'arrived' }), now), stopped: E.viewText(v({ ended: 'stopped' }), now), expired: E.viewText(v({ ended: 'expired' }), now),
  bad: E.viewText(null, now),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_live_and_stale(out):
    assert out["live"] == {"title": "@nate is about 12 min away", "sub": "Arriving around 5:42 PM", "note": "Updated just now"}
    assert out["stale"]["note"] == "Last update 10 min ago. Their phone may have no signal."
    assert out["due"]["title"] == "@nate should be there about now"


def test_ended_and_broken(out):
    assert out["arrived"]["title"] == "@nate has arrived"
    assert out["stopped"]["title"] == "@nate stopped sharing"
    assert out["expired"]["title"] == "This link has expired"
    assert out["bad"]["title"].startswith("This link isn")


def test_page_promises_no_position():
    page = open(os.path.join(ROOT, "web", "eta.html"), encoding="utf-8").read()
    assert "not where they are" in page and 'name="robots" content="noindex"' in page
