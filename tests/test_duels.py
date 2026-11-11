"""Duels (web/duels.js, docs/SOCIAL.md 2.7): what each card says, waiting, on, and over; Scores only, never a time."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const D = require(process.argv[1] + '/web/duels.js');
const base = { id: 'd', stage: 'Dry Ridge climb', canon_id: 'c', days: 7, with: 'bob', with_id: 'b', challenger: true, you_share: true, they_share: true, have_stage: true, today: '2026-11-10' };
const on = (o) => ({ ...base, status: 'on', starts_on: '2026-11-08', ends_on: '2026-11-14', ...o });
const over = (o) => ({ ...base, status: 'over', starts_on: '2026-11-01', ends_on: '2026-11-07', ...o });
const s = (n) => ({ score: n, on: '2026-11-09' });
const c = (d) => { const x = D.card(d); return [x.kind, x.head, x.line, x.note, x.keys]; };
console.log(JSON.stringify({
  ask: c({ ...base, status: 'pending', challenger: false }), sent: c({ ...base, status: 'pending' }),
  lead: c(on({ you: s(845), them: s(812) })), behind: c(on({ you: s(790), them: s(812), ends_on: '2026-11-10' })), none: c(on({})),
  gaps: c(on({ you_share: false, they_share: false, them: s(812) })),
  won: c(over({ you: s(845), them: s(812) })), lost: c(over({ you: null, them: s(812) })), draw: c(over({ you: s(800), them: s(800) })), nobody: c(over({})),
  declined: c({ ...base, status: 'declined' }), withdrawn: c({ ...base, status: 'withdrawn', challenger: false }),
  left: [D.daysLeft(on({})), D.daysLeft(on({ ends_on: '2026-11-10' })), D.daysLeft({})],
  shown: D.shown([over({ id: 'old', ends_on: '2026-11-01' }), on({ id: 'on' }), { ...base, id: 'ask', status: 'pending', challenger: false }, over({ id: 'recent', ends_on: '2026-11-08' }), { ...base, id: 'no', status: 'declined' }]).map((x) => x.d.id),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_waiting(out):
    assert out["ask"] == ["ask", "@bob challenged you", "Dry Ridge climb · 7 days. The higher Vetta Score on it wins.", "", ["accept", "decline"]]
    assert out["sent"] == ["sent", "You challenged @bob", "Dry Ridge climb · 7 days, from when they say yes", "", ["withdraw"]]


def test_on(out):
    assert out["lead"][2] == "You 845 · @bob 812 · You lead by 33 · 5 days left"
    assert out["behind"][2] == "You 790 · @bob 812 · @bob leads by 22 · last day"
    assert out["none"][2] == "You -- · @bob -- · No runs yet · 5 days left"
    assert out["lead"][4] == ["drive", "withdraw"]
    # Scores that don't reach the other side are said, and yours can be shown from the card
    assert "Your Scores don't reach @bob yet" in out["gaps"][3] and "@bob's Scores don't reach you yet" in out["gaps"][3]
    assert out["gaps"][4][0] == "share"


def test_over(out):
    assert out["won"][:3] == ["won", "Dry Ridge climb · @bob", "You won by 33 · You 845 · @bob 812"]
    assert out["lost"][2] == "@bob won · You -- · @bob 812"
    assert out["draw"][2] == "A draw at 800 · You 800 · @bob 800"
    assert out["nobody"][:3] == ["none", "Dry Ridge climb · @bob", "Neither of you drove it · You -- · @bob --"]
    assert out["won"][4] == ["rematch"]
    assert out["declined"][2] == "@bob said no thanks" and out["withdrawn"][2] == "Taken back"


def test_never_a_time(out):
    assert not any(w in json.dumps(out) for w in ("time", "sec", " s ", "mph", "km/h", "faster"))


def test_days_and_which_show(out):
    assert out["left"] == [5, 1, None]
    assert out["shown"] == ["ask", "on", "recent"]          # asks first; an old result and a declined one stay off People
