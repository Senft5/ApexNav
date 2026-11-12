"""web/end_line.js (REVIEW.md 4.4): each pack's closing line around the Vetta Score, spoken from its own clips, and
"best on this road" only against your earlier drives on the same road."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="needs node")


def run(js: str):
    src = f"const E = require({json.dumps(str(ROOT / 'web' / 'end_line.js'))}); console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)


@needs_node
def test_score_tokens():
    assert run("E.scoreTokens(702)") == {"tokens": ["n:h7", "n:2"], "words": "seven hundred two"}
    assert run("E.scoreTokens(82)") == {"tokens": ["n:82"], "words": "eighty-two"}
    assert run("E.scoreTokens(900)") == {"tokens": ["n:h9"], "words": "nine hundred"}
    assert run("E.scoreTokens(0)") == {"tokens": ["n:0"], "words": "zero"}
    assert run("E.scoreTokens(1000)") == {"tokens": ["n:k1"], "words": "one thousand"}
    assert run("[E.scoreTokens(-1), E.scoreTokens(1001), E.scoreTokens(7.5), E.scoreTokens(null)]") == [None, None, None, None]


@needs_node
def test_each_pack_closes_in_its_own_order():
    assert run("E.endLine('marguerite', 702, true)") == {"tokens": ["sys:end", "end:score", "n:h7", "n:2", "end:best"],
                                                          "text": "That's the drive. Score seven hundred two, your best on this road."}
    assert run("E.endLine('kit', 82, true).text") == "Eighty-two. Best yet on this road. That's a wrap."
    assert run("E.endLine('hale', 811, false)") == {"tokens": ["sys:end", "end:score", "n:h8", "n:11"], "text": "Complete. Score, eight hundred eleven."}
    assert run("E.endLine('hale', null, true)") == {"tokens": ["sys:end"], "text": "Complete."}       # no score: no best either
    assert run("E.endLine('device', 82, false).tokens")[0] == "sys:end"                            # anything else reads as Marguerite


@needs_node
def test_best_on_this_road():
    d = "{ id: 'd3', name: 'Cherohala Skyway', score: 702 }"
    assert run(f"E.bestOnRoad({d}, [{{ id: 'd1', name: 'Cherohala Skyway', score: 640 }}, {{ id: 'd2', name: 'Tail of the Dragon', score: 900 }}])") is True
    assert run(f"E.bestOnRoad({d}, [{{ id: 'd1', name: 'Cherohala Skyway', score: 702 }}])") is False   # a tie isn't a best
    assert run(f"E.bestOnRoad({d}, [])") is False                                                      # a first drive isn't a best
    assert run(f"E.bestOnRoad({d}, [{{ id: 'd3', name: 'Cherohala Skyway', score: 100 }}])") is False   # not against itself
    assert run("E.bestOnRoad({ id: 'x', name: 'A', score: null }, [{ id: 'y', name: 'A', score: 1 }])") is False


def test_every_pack_has_the_clips_the_lines_need():
    sys.path.insert(0, str(ROOT / "tools"))
    import importlib.util
    spec = importlib.util.spec_from_file_location("voicebank_vocab", ROOT / "tools" / "voicebank.py")
    vb = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(vb)
    except ModuleNotFoundError as e:                 # numpy not installed here
        pytest.skip(str(e))
    for pack in ("marguerite", "kit", "hale"):
        v = vb.codriver_vocabulary(pack)
        for t in ["sys:end", "end:best", "n:h7", "n:2", "n:82", "n:99", "n:k1"]:
            assert t in v, (pack, t)
    assert "end:score" in vb.codriver_vocabulary("marguerite") and "end:score" not in vb.codriver_vocabulary("kit")


@needs_node
def test_the_score_against_your_usual():
    """Design pass 9: the card's number had nothing to stand against. "33 over your usual" is the median of your last ten
    scored drives before this one; with fewer than three the card says nothing (a usual is not two drives)."""
    assert run("E.usual(673, [640, 655, 612, 649, 630])") == {"usual": 640, "diff": 33, "text": "33 over your usual"}
    assert run("E.usual(600, [640, 655, 612, 649])")["text"] == "45 under your usual"       # an even count: the middle two, averaged (645)
    assert run("E.usual(644, [640, 655, 612, 649, 630])")["text"] == "About your usual"     # within five points
    assert run("[E.usual(673, [640, 655]), E.usual(673, []), E.usual(null, [1, 2, 3]), E.usual(673, null)]") == [None, None, None, None]
    # drives with no score are skipped, never counted as zero; only the last ten count
    assert run("E.usual(673, [640, null, 655, undefined, NaN, 612])")["usual"] == 640
    assert run("E.usual(700, [100, 100, 100, 100, 100].concat(Array(10).fill(650)))")["usual"] == 650
    page = (ROOT / "web" / "cockpit.js").read_text(encoding="utf-8")
    assert "ApexEndLine.usual(c.ds.score, before)" in page and "String(o.date || '') <= String(me.date || '')" in page   # only drives before this one


@needs_node
def test_a_new_best_run_this_month():
    """IDEAS D-30, part three: the card says a run of clean corners is this month's best only when it beats every other
    drive this month whose run is known. Never for the first drive of a month, a tie, an unknown month or date, or a drive
    whose run was never judged."""
    month = "(o) => (/^\\d{4}-\\d{2}/.test(o.date || '') ? o.date.slice(0, 7) : null)"
    me = "{ id: 'a', date: '2026-11-12T10:00', run: { corners: 9, len_m: 3400 } }"
    def best(others, m=me):
        return run(f"E.bestRunMonth({m}, [{m}].concat({others}), {month})")
    assert best("[{ id: 'b', date: '2026-11-02', run: { corners: 6, len_m: 900 } }, { id: 'c', date: '2026-11-03', run: null }]") == \
        "Your best run this month: 9 corners in a row, smooth and settled."
    assert best("[{ id: 'b', date: '2026-11-02', run: { corners: 9 } }]") is None             # a tie is not a new best
    assert best("[{ id: 'b', date: '2026-11-02', run: { corners: 12 } }]") is None            # beaten this month
    assert best("[{ id: 'b', date: '2026-10-30', run: { corners: 2 } }]") is None             # first of the month: nothing to beat
    assert best("[{ id: 'b', date: '2026-11-02' }]") is None                                  # a run never judged doesn't count
    assert best("[{ id: 'b', date: '2026-10-02', run: { corners: 30 } }, { id: 'c', date: '2026-11-01', run: null }]") is not None  # last month's 30 never counts
    assert best("[{ id: 'b', date: '2026-11-02', run: null }]", "{ id: 'a', date: '2026-11-12', run: null }") is None
    assert best("[{ id: 'b', date: '2026-11-02', run: null }]", "{ id: 'a', date: '', run: { corners: 9 } }") is None
    assert run(f"E.bestRunMonth(null, [], {month})") is None and run("E.bestRunMonth({ id: 'a', run: { corners: 9 } }, [], null)") is None
    page = (ROOT / "web" / "cockpit.js").read_text(encoding="utf-8")
    assert "ApexEndLine.bestRunMonth(me, all, ApexAnalysis.monthOf)" in page
    assert "$('endRun').textContent = ''; $('endRun').hidden = true;" in page                 # each card starts without it
    assert 'id="endRun" hidden' in (ROOT / "web" / "index.html").read_text(encoding="utf-8")
