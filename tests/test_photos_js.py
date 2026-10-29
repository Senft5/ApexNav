"""web/photos.js pure helpers (REVIEW.md 5.2): the size a photo is redrawn at, and the initial shown without one."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


def run(js: str):
    src = f"const P = require({json.dumps(str(ROOT / 'web' / 'photos.js'))}); console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)


@pytest.mark.skipif(NODE is None, reason="needs node")
def test_fit_size_never_upscales_and_caps_the_long_side():
    assert run("P.fitSize(4032, 3024)") == {"w": 1600, "h": 1200}
    assert run("P.fitSize(3024, 4032)") == {"w": 1200, "h": 1600}
    assert run("P.fitSize(800, 600)") == {"w": 800, "h": 600}
    assert run("P.fitSize(10000, 3)") == {"w": 1600, "h": 1}
    assert run("[P.fitSize(0, 10), P.fitSize(NaN, 10), P.fitSize(-1, 5)]") == [None, None, None]


@pytest.mark.skipif(NODE is None, reason="needs node")
def test_initial_is_the_first_letter_or_digit():
    assert run("[P.initial('kit_r'), P.initial('_9lives'), P.initial('élan'), P.initial(''), P.initial(null), P.initial('__')]") == ["K", "9", "É", "?", "?", "?"]


def test_photos_stay_under_the_server_cap():
    src = (ROOT / "web" / "photos.js").read_text()
    server = (ROOT / "backend" / "src" / "photos.ts").read_text()
    assert "MAX_SIDE = 1600, MAX_BYTES = 650000" in src
    assert "MAX_BYTES = 700_000, MAX_SIDE = 2400" in server
