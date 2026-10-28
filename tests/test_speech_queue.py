"""What the co-driver says next (web/speech_queue.js, IDEAS V-03): hazards first, never stale, never duplicated."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const Q = require(process.argv[1] + '/web/speech_queue.js');
const out = {};
const texts = (q, now, m) => { const r = []; let it; while ((it = q.take(now, m))) r.push(it.text); return r; };

// A hazard goes ahead of waiting corner notes, behind an earlier hazard.
let q = Q.createSpeechQueue();
q.push({ text: 'Left 4', atM: 300 }, 0);
q.push({ text: 'Right 3', atM: 400 }, 0);
q.push({ text: 'Bump', kind: 'hazard', atM: 350 }, 0);
q.push({ text: 'Camera', kind: 'hazard', atM: 500 }, 0);
out.order = texts(q, 0, 100);

// Ordinary lines keep the newest two; hazards are never trimmed to make room.
q = Q.createSpeechQueue();
q.push({ text: 'Pothole', kind: 'hazard' }, 0);
for (const t of ['a', 'b', 'c', 'd']) q.push({ text: t }, 0);
out.trim = texts(q, 0);

// Stale: a line for a place already passed, or older than its shelf life, is dropped unsaid.
q = Q.createSpeechQueue();
q.push({ text: 'passed', atM: 200 }, 0);
q.push({ text: 'ahead', atM: 600 }, 0);
q.push({ text: 'note' }, 0);
q.push({ text: 'hazard', kind: 'hazard' }, 0);
out.passed = texts(q, 1000, 198);
q.push({ text: 'late note' }, 0);
q.push({ text: 'late hazard', kind: 'hazard' }, 0);
out.aged = texts(q, Q.ORDINARY_AGE_MS + 1);
q.push({ text: 'late hazard', kind: 'hazard' }, 0);
out.agedHazard = texts(q, Q.HAZARD_AGE_MS + 1);

// Duplicates: the same key while waiting, or within its repeat window after it was said, is refused.
q = Q.createSpeechQueue();
out.dup = [q.push({ text: 'Bump', kind: 'hazard', key: 'b1' }, 0), q.push({ text: 'Bump', kind: 'hazard', key: 'b1' }, 10)];
texts(q, 20);
out.repeat = [q.push({ text: 'Bump', kind: 'hazard', key: 'b1' }, 1000), q.push({ text: 'Bump', kind: 'hazard', key: 'b1' }, 20 + Q.REPEAT_MS + 1)];
out.ownWindow = [q.push({ text: 'x', key: 'k', repeatMs: 100 }, 0), (texts(q, 0), q.push({ text: 'x', key: 'k', repeatMs: 100 }, 101))];
out.empty = [q.push({ text: '' }, 0), q.push(null, 0)];

// A hazard waiting cuts off an ordinary line playing, never another hazard.
out.preempt = [Q.preempts({ kind: 'ordinary' }, { kind: 'hazard' }), Q.preempts({ kind: 'hazard' }, { kind: 'hazard' }),
               Q.preempts({ kind: 'ordinary' }, { kind: 'ordinary' }), Q.preempts(null, { kind: 'hazard' })];
q = Q.createSpeechQueue();
q.push({ text: 'note' }, 0);
out.waiting = [q.hazardWaiting(0), (q.push({ text: 'bump', kind: 'hazard', atM: 50 }, 0), q.hazardWaiting(0, 10)), q.hazardWaiting(0, 60)];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    res = subprocess.run([NODE, "-e", RUNNER, root], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_hazards_go_first_in_their_own_order(out):
    assert out["order"] == ["Bump", "Camera", "Left 4", "Right 3"]


def test_ordinary_lines_trimmed_to_newest_two_hazards_never(out):
    assert out["trim"] == ["Pothole", "c", "d"]


def test_stale_lines_dropped(out):
    assert out["passed"] == ["hazard", "ahead", "note"]  # 200 m is within 5 m of the car at 198 m: passed, dropped
    assert out["aged"] == ["late hazard"]                # an ordinary line lasts 8 s, a hazard 15 s
    assert out["agedHazard"] == []


def test_duplicates_refused(out):
    assert out["dup"] == [True, False]
    assert out["repeat"] == [False, True]
    assert out["ownWindow"] == [True, True]
    assert out["empty"] == [False, False]


def test_preemption(out):
    assert out["preempt"] == [True, False, False, False]
    assert out["waiting"] == [False, True, False]        # a hazard for a spot already passed no longer counts


def test_page_routes_hazards_through_the_queue():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    html = open(os.path.join(root, "web", "index.html"), encoding="utf-8").read()
    assert '<script src="speech_queue.js"></script>' in html
    assert "kind: e.type === 'corner' ? 'ordinary' : 'hazard'" in html     # route bumps and cameras are hazards
    assert "kind: 'hazard', key: `mem:${hz.id}`" in html                  # remembered bumps too
    assert "speech.queue.length" not in html                               # the old array queue is gone
