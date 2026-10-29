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


@needs_node
def test_livery_line_and_tiers():
    assert run("C.liveryLine({ decals: 0 })") == "Decals come from crew-mates with Vetta Pro."
    assert run("C.liveryLine({ decals: 14, supporters: [1, 2, 3, 4, 5], next: { tier: 'factory', at: 20 } })") == "14 Decals from 5 supporters · Factory at 20"
    assert run("C.liveryLine({ decals: 1, supporters: [1], next: { tier: 'club', at: 5 } })") == "1 Decal from 1 supporter · Club at 5"
    assert run("C.liveryLine({ decals: 22, supporters: [1, 2, 3, 4, 5, 6, 7, 8], next: null })") == "22 Decals from 8 supporters"
    assert run("[C.atLeast('club', 'club'), C.atLeast('plain', 'club'), C.atLeast('factory', 'works'), C.atLeast('works', 'factory')]") == [True, False, True, False]


@needs_node
def test_stripe_patterns_match_the_worker_and_never_inject():
    server = (ROOT / "backend" / "src" / "livery.ts").read_text()
    assert run("C.PATTERNS") == re.findall(r'"([a-z]+)"', re.search(r"PATTERNS = \[([^\]]+)\]", server).group(1))
    for p in run("C.PATTERNS") + ["unknown"]:
        css = run(f"C.stripeCss('{p}', '#c8102e', '#111111', '#c9a227')")
        assert "#c8102e" in css
    # anything that isn't a #rrggbb colour never reaches the CSS
    assert "red;" not in run("C.stripeCss('bands', 'red;background:url(x)', null, null)")


@needs_node
def test_a_crew_category_reads_its_own_word_on_every_plate():
    src = f"const H = require({json.dumps(str(ROOT / 'web' / 'hazard_reports.js'))});"
    js = src + " console.log(JSON.stringify([H.plate({ kind: 'debris', label: 'Cattle grid' }, null, 0).title, H.plate({ kind: 'debris' }, null, 0).title]));"
    assert json.loads(subprocess.run([NODE, "-e", js], capture_output=True, text=True, check=True).stdout) == ["Cattle grid", "Debris"]
