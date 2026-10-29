"""web/builds.js (REVIEW.md 5.3, roadmap 23): the stage bar, parts typed as one line, the car's name, dates."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="needs node")


def run(js: str):
    src = f"const B = require({json.dumps(str(ROOT / 'web' / 'builds.js'))}); console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True, env={"TZ": "UTC"}).stdout)


@needs_node
def test_stage_bar_reaches_the_highest_stage_posted():
    stages = "['Wheels', 'Brakes', 'Seats', 'Suspension', 'Power', 'Aero']"
    assert run(f"B.stageBar({stages}, [{{ stage: 0 }}, {{ stage: 3 }}, {{ stage: null }}])") == {"n": 6, "reached": 4, "label": "Stage 4 of 6 · Suspension"}
    assert run(f"B.stageBar({stages}, [])") == {"n": 6, "reached": 0, "label": "6 stages planned"}
    assert run("B.stageBar([], [{ stage: 2 }])") == {"n": 0, "reached": 0, "label": ""}
    assert run("B.stageBar(['A'], [{ stage: 7 }])")["reached"] == 0          # a stage that was removed doesn't count


@needs_node
def test_parts_of_a_line():
    assert run("B.partsOf('Ohlins DFV R&T, 7k / 5k springs,, \\n -2.2 / -1.8 camber ')") == ["Ohlins DFV R&T", "7k / 5k springs", "-2.2 / -1.8 camber"]
    assert len(run("B.partsOf(Array(20).fill('x').join(','))")) == 12
    assert run("B.partsOf('y'.repeat(60))") == ["y" * 40]
    assert run("B.partsOf(null)") == []


@needs_node
def test_car_name_and_day():
    assert run("B.carName({ nickname: \"Nate's NB Miata\", year: 2004, make: 'Mazda', model: 'Miata' })") == "Nate's NB Miata"
    assert run("B.carName({ year: 2004, make: 'Mazda', model: 'Miata' })") == "2004 Mazda Miata"
    assert run("[B.day('2026-10-27 14:00:00'), B.day('')]") == ["Oct 27", ""]


def test_no_emoji_and_text_stays_text():
    src = (ROOT / "web" / "builds.js").read_text()
    assert not re.search(r"[\U0001F300-\U0001FAFF☀-➿]", src)
    assert "innerHTML" not in src
