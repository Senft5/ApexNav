"""U-55 (REVIEW3.md §3.2): the binnacle's Road row says a road's type in a driver's words ("Sweepers", "Fast & open") and
never prints "Connector", an archetype name for a ramp or link road: with no road name, that row steps aside."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="needs node")
def test_road_kind_words():
    src = f"const I = require({json.dumps(str(ROOT / 'web' / 'instruments.js'))});" \
          "console.log(JSON.stringify(['Flowing sweepers', 'Fast open', 'Technical', 'Town', 'Connector', null, undefined, ''].map(I.roadKind)));"
    got = json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)
    assert got == ["Sweepers", "Fast & open", "Technical", "Town", None, None, None, None]


def test_both_binnacles_hide_a_connector_without_a_name():
    js = (ROOT / "web" / "instruments.js").read_text(encoding="utf-8")
    assert js.count("`Road: ${name || roadKind(type) || '--'}`") == 2
    assert js.count("|| (!name && type === 'Connector')") == 2
    assert "Connector'))}`" not in js and "(type || '--'))" not in js
