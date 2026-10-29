"""Plan presets (web/plan_presets.js, docs/design/REVIEW.md 3.3): a named setup of Roads, Avoid and corner mix, one tap
next time. On the phone only, at most six, cleaned on the way in."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/plan_presets.js');
const mem = {}, store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
const out = {};
out.first = P.save(store, { name: '  Sunday   loop ', fun: 'max', avoid: { highways: true, tolls: false }, prefs: { tight: 1, fast: 3 } });
out.bad = [P.save(store, { name: '   ' }), P.save(store, null)];
out.replace = P.save(store, { name: 'SUNDAY LOOP', fun: 'quick', avoid: {}, prefs: {} });
out.fill = []; for (let i = 0; i < 6; i++) out.fill.push(P.save(store, { name: `p${i}`, fun: 'fun' }));
out.full = P.save(store, { name: 'one too many' });
out.list = P.list(store).map((p) => p.name);
out.sunday = P.list(store).find((p) => p.name === 'SUNDAY LOOP');
out.match = P.matching(store, { fun: 'quick', avoid: { ferries: false }, prefs: { tight: 0, fast: 0 } });
out.noMatch = P.matching(store, { fun: 'max', avoid: { ferries: true }, prefs: {} });
P.remove(store, 'sunday loop');
out.afterRemove = P.list(store).map((p) => p.name);
mem[P.KEY] = 'not json';
out.corrupt = P.list(store);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_saves_cleaned_and_replaces_by_name(out):
    assert out["first"] == "saved" and out["bad"] == ["bad", "bad"] and out["replace"] == "saved"
    assert out["sunday"] == {"name": "SUNDAY LOOP", "fun": "quick", "avoid": {}, "prefs": {"tight": 0, "fast": 0}}


def test_at_most_six_newest_first(out):
    assert out["fill"] == ["saved"] * 5 + ["full"] and out["full"] == "full"
    assert out["list"] == ["p4", "p3", "p2", "p1", "p0", "SUNDAY LOOP"]


def test_matching_and_remove(out):
    assert out["match"]["name"] == "SUNDAY LOOP"                       # same level, nothing avoided, no corner preference
    assert out["noMatch"] is None
    assert "SUNDAY LOOP" not in out["afterRemove"] and out["corrupt"] == []
