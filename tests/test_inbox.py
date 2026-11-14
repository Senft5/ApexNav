"""For you (web/inbox.js, docs/SOCIAL.md 2.10): each kind said in a sentence with at most one key, unknown kinds left out, and a badge that counts only what's new or waiting."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const I = require(process.argv[1] + '/web/inbox.js');
const at = '2026-11-11 12:00:00';
const items = [
  { kind: 'topped', at, handle: 'bob', stage: 'Dry Ridge climb', canon_id: 'c', score: 850, yours: 800 },
  { kind: 'passed', at, handle: 'bob', stage: 'Tail of the Dragon', gap_s: 9, place: 2 },
  { kind: 'passed', at, handle: 'sam', stage: null, gap_s: 75, place: 11 },
  { kind: 'kudos', at, handle: 'cara', stage: 'Dry Ridge climb' },
  { kind: 'duel_on', at, handle: 'bob', stage: 'Dry Ridge climb', have_stage: false },
  { kind: 'duel_over', at, handle: 'bob', stage: 'Dry Ridge climb', result: 'won' },
  { kind: 'duel_over', at, handle: 'bob', stage: 'Dry Ridge climb', result: 'lost' },
  { kind: 'follows', at, book: 'Smokies classics', book_id: 'b', n: 1 },
  { kind: 'follows', at, book: 'Smokies classics', book_id: 'b', n: 3 },
  { kind: 'crew_drive', at, crew: 'Ridge Runners', title: 'Cherohala Saturday', starts_at: '2026-11-14 14:00:00' },
  { kind: 'request', at, handle: 'cara', waiting: true },
  { kind: 'post_kudos', at, handle: 'bob', title: 'Tellico climb', post_id: 'p1', yours: true, others: 2 },
  { kind: 'post_comment', at, handle: 'bob', title: 'Tellico climb', post_id: 'p1', yours: true, others: 0 },
  { kind: 'post_comment', at, handle: 'sam', title: 'Cherohala dawn', post_id: 'p2', yours: false, owner: 'cara', others: 1 },
  { kind: 'post_mention', at, handle: 'sam', title: 'Cherohala dawn', post_id: 'p2', yours: false, owner: 'cara', others: 0 },
  { kind: 'something_new', at },
];
const now = Date.parse('2026-11-11T12:00:00Z');
console.log(JSON.stringify({
  lines: items.map((i) => { const l = I.line(i); return l && [l.kicker, l.text, l.key && l.key.act]; }),
  ago: ['2026-11-11 11:59:30', '2026-11-11 11:48:00', '2026-11-11 09:00:00', '2026-11-10 10:00:00', '2026-11-07 12:00:00', 'nonsense'].map((a) => I.ago(a, now)),
  freshAll: I.fresh({ items }, ''),
  freshSeen: I.fresh({ items: [...items, { kind: 'kudos', at: '2026-11-11 13:00:00', handle: 'x' }] }, '2026-11-11 12:30:00'),
  freshNone: [I.fresh(null, ''), I.fresh({ items: 'x' }, '')],
  carded: [...I.CARDED].sort(),
}));
"""


def _run():
    out = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_every_kind_is_a_sentence_with_one_key_at_most():
    r = _run()
    lines = r["lines"]
    assert lines[0] == ["Topped", "@bob scored 850 on Dry Ridge climb, over your best of 800.", "stage"]
    assert lines[1] == ["Time attack", "@bob went 9 s quicker than you on Tail of the Dragon. You're 2nd now.", "board"]
    assert lines[2][1] == "@sam went 1:15 quicker than you on this week’s loop. You're 11th now."
    assert lines[3] == ["Kudos", "@cara gave you kudos for Dry Ridge climb.", None]
    assert lines[4] == ["Duel on", "@bob took your duel on Dry Ridge climb.", None]    # no stage yet: no key to drive it
    assert lines[5][:2] == ["Duel won", "You beat @bob on Dry Ridge climb."]
    assert lines[6][:2] == ["Duel over", "@bob won your duel on Dry Ridge climb."]
    assert lines[7][1] == "Someone new follows Smokies classics."
    assert lines[8][1] == "3 new people follow Smokies classics."
    assert lines[9][0] == "Crew drive" and lines[9][1].startswith("Ridge Runners: Cherohala Saturday, ") and lines[9][1].endswith("Are you going?")
    assert lines[10][0] == "Friend request"
    assert lines[11] == ["Kudos", "@bob and 2 others gave kudos to Tellico climb.", "post"]
    assert lines[12] == ["Comment", "@bob commented on Tellico climb.", "post"]
    assert lines[13] == ["Comment", "@sam and 1 other also commented on @cara’s Cherohala dawn.", "post"]
    assert lines[14] == ["Mention", "@sam mentioned you on @cara’s Cherohala dawn.", "post"]
    assert lines[15] is None                                                              # an unknown kind says nothing
    for l in lines:
        if l:
            assert l[1].endswith((".", "?")), l                                          # BRAND: every message is a sentence


def test_ago_in_plain_words():
    assert _run()["ago"] == ["just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", ""]


def test_badge_counts_what_is_new_or_waiting():
    r = _run()
    assert r["freshAll"] == 15                      # everything but the unknown kind
    assert r["freshSeen"] == 2                      # the request still waits, and the one newer than seen
    assert r["freshNone"] == [0, 0]
    assert r["carded"] == ["duel_ask", "request"]   # People shows these as cards; the list doesn't repeat them
