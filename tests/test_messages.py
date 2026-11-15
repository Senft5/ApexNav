"""Messages (web/messages.js, backend/src/messages.ts): a conversation's row line, and its short time."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const M = require(process.argv[1] + '/web/messages.js');
const now = Date.parse('2026-11-14T12:00:00Z');
console.log(JSON.stringify({
  line: [M.lastLine({ last: 'Skyway\n Saturday?', mine: true }), M.lastLine({ last: 'x'.repeat(70), mine: false }), M.lastLine(null), M.lastLine({ last: null })],
  stamp: ['2026-11-14 11:59:30', '2026-11-14 11:55:00', '2026-11-14 09:00:00', '2026-11-11 12:00:00', '2026-11-02 12:00:00', 'nope'].map((a) => M.stamp(a, now)),
}));
"""


def run():
    out = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_last_line():
    """The row says yours with "You: ", one line, and stops near 60 characters."""
    r = run()["line"]
    assert r[0] == "You: Skyway Saturday?"
    assert r[1] == "x" * 59 + "…"
    assert r[2:] == ["", ""]


def test_stamp():
    """now, minutes, hours, the weekday this week, then the date; nothing for a bad time."""
    assert run()["stamp"] == ["now", "5m", "3h", "Wed", "Nov 2", ""]
