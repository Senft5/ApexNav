"""web/crew_page.js (REVIEW.md roadmap 20): the date block, chat times, who's going, the Plain livery's stripe check,
and the stock crests matching the Worker's list (backend/src/crew_page.ts)."""
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
    src = (f"process.env.TZ = 'America/New_York'; const C = require({json.dumps(str(ROOT / 'web' / 'crew_page.js'))});"
           f" console.log(JSON.stringify({js}));")
    return json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True, env={"TZ": "America/New_York"}).stdout)


@needs_node
def test_date_block_is_local_day_and_month():
    assert run("C.dateBlock('2026-11-02T11:30:00Z')") == {"day": "2", "mon": "NOV"}
    assert run("C.dateBlock('2026-11-02T02:30:00Z')") == {"day": "1", "mon": "NOV"}   # 9:30 PM the night before in Tennessee
    assert run("C.dateBlock('nope')") == {"day": "--", "mon": ""}


@needs_node
def test_chat_times():
    now = "Date.parse('2026-10-29T12:00:00Z')"
    assert run(f"[C.ago('2026-10-29 11:59:30', {now}), C.ago('2026-10-29 11:48:00', {now}), C.ago('2026-10-29 09:00:00', {now}),"
               f" C.ago('2026-10-12 09:00:00', {now}), C.ago('', {now})]") == ["now", "12 min", "3 h", "Oct 12", ""]


@needs_node
def test_going_faces():
    assert run("C.goingFaces(['sam', 'jules', 'nate', 'dee'])") == {"faces": ["S", "J", "N"], "more": 1, "n": 4}
    assert run("C.goingFaces(['_x9'])") == {"faces": ["X"], "more": 0, "n": 1}
    assert run("C.goingFaces(null)") == {"faces": [], "more": 0, "n": 0}


@needs_node
def test_stripe_check():
    assert run("[C.stripeOk('#c8102e'), C.stripeOk('#C8102E'), C.stripeOk('red'), C.stripeOk('#c81'), C.stripeOk(null)]") == [True, True, False, False, False]
    assert all(run("C.STRIPES.map(C.stripeOk)"))


@needs_node
def test_crests_match_the_worker():
    server = (ROOT / "backend" / "src" / "crew_page.ts").read_text()
    ids = re.search(r"CRESTS = \[([^\]]+)\]", server).group(1)
    assert run("C.CRESTS") == re.findall(r'"([a-z]+)"', ids)


def test_no_emoji_and_typed_text_is_text():
    src = (ROOT / "web" / "crew_page.js").read_text()
    assert not re.search(r"[\U0001F300-\U0001FAFF☀-➿]", src)
    assert "innerHTML" not in src
