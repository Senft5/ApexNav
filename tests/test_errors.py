"""Crash reports (web/errors.js): nothing personal leaves the phone, one report per error, at most 5 per page."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const E = require(process.argv[1]);
const out = {};
out.url = E.scrub('fetch failed https://valhalla1.openstreetmap.de/route?json={"lat":35.9606123} and apexnav://app/index.html#x');
out.email = E.scrub('no user nate.s+x@gmail.com here');
out.coords = E.scrub('bad point 35.960612,-83.920739 at index 12 of 1.5');
out.token = E.scrub('Bearer eyJhbGciOiJIUzI1NiJ9abc123defghijk and a_long_function_name_without_digits_here');
out.stack = E.scrub('at f (apexnav://app/index.html?x=1:120:7)');
out.cap = E.scrub('x'.repeat(5000), 300).length;
// listener: 7 distinct errors and 1 repeat -> 5 sent
const sent = [], listeners = {};
const target = { addEventListener: (t, f) => { listeners[t] = f; } };
E.install({ send: (r) => sent.push(r), target });
listeners.error({ error: new Error('boom at 35.9606123') });
listeners.error({ error: new Error('boom at 35.9606123') });
for (let i = 0; i < 6; i++) listeners.unhandledrejection({ reason: new Error('nope ' + i) });
listeners.error({ message: 'Script error.' });
out.sent = sent.map(r => [r.kind, r.message]);
out.keys = Object.keys(sent[0]).sort();
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    out = subprocess.run([NODE, "-e", RUNNER, os.path.abspath("web/errors.js")], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_scrub_removes_personal_data(r):
    assert r["url"].startswith("fetch failed https://valhalla1.openstreetmap.de/route")
    assert "json=" not in r["url"] and "35.96" not in r["url"] and r["url"].endswith("apexnav://app/index.html")
    assert r["email"] == "no user [email] here"
    assert r["coords"] == "bad point [num],[num] at index 12 of 1.5"
    assert "eyJ" not in r["token"] and "[token]" in r["token"]
    assert "a_long_function_name_without_digits_here" in r["token"], "plain identifiers in stacks survive"
    assert r["stack"] == "at f (apexnav://app/index.html:120:7)", "line and column survive"
    assert r["cap"] == 300


def test_one_report_per_error_and_five_per_page(r):
    assert r["sent"] == [["error", "boom at [num]"], ["rejection", "nope 0"], ["rejection", "nope 1"], ["rejection", "nope 2"], ["rejection", "nope 3"]]
    assert r["keys"] == ["app", "kind", "message", "page", "stack"], "no session, position or drive data in a report"
