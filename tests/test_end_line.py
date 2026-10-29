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
