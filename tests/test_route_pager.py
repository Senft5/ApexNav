"""The route card's page marks (design pass, 2026-11-10): the routes found are marks under the level cards, the one on
screen inked, with the count; the swipe instruction is words beside them until the first swipe, never a second line."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from tests.page_source import cockpit_source

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="needs node")


def run(js: str):
    src = f"const R = require({json.dumps(str(ROOT / 'web' / 'route_card.js'))}); console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)


@needs_node
def test_pager_counts_the_routes_found_and_is_nothing_for_one():
    assert run("R.pager({ list: [{}, {}, {}], picked: 1 })") == {"n": 3, "at": 1, "label": "Route 2 of 3. Swipe the card for the next."}
    assert run("R.pager({ list: [{}, {}], picked: 9 })")["at"] == 1                # never past the last mark
    assert run("[R.pager({ list: [{}], picked: 0 }), R.pager(null), R.pager({ list: [{}, {}] })]") == [None, None, None]


@needs_node
def test_the_line_under_the_marks_keeps_only_what_marks_cannot_say():
    o = "{ list: [{}, {}, {}, {}], levels: { quick: 0, fun: 0, max: 1 }, picked: %d }"
    assert run(f"R.levelNote({o % 0}, true)") == "Quick and Fun pick the same route"
    assert run(f"R.levelNote({o % 1}, true)") == "Quick and Fun pick the same route"
    assert run(f"R.levelNote({o % 2}, true)") == "Quick and Fun pick the same route · another route found"
    assert run("R.levelNote({ list: [{}, {}], levels: { quick: 0, fun: 1, max: null }, picked: 1 }, true)") == ""
    # without the marks (any other caller) the sentence is whole, as before
    assert run("R.levelNote({ list: [{}, {}], levels: { quick: 0, fun: 1, max: null }, picked: 1 })") == "Swipe the card for the next route, 2\u00a0of\u00a02"


def test_the_card_draws_the_marks_and_drops_the_words_after_the_first_swipe():
    src, html = cockpit_source(), (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert html.index('id="routeCardFun"') < html.index('id="routeCardPager"') < html.index('id="routeCardLevelsNote"') < html.index('id="routeCardWhy"')
    assert "ApexRouteCard.pager(o)" in src and "ApexRouteCard.levelNote(o, true)" in src
    assert re.search(r"swipeLearned\(\) \? \[\] : \[.*Swipe the card for the next route", src)
    assert re.search(r"localStorage\.setItem\(SWIPED, '1'\).*pickOption\(i\)", src)   # learned by doing it, on a real swipe only
    assert re.search(r"\.rc-pager i\.on \{[^}]*background: var\(--panel-ink\)", html)
    assert "prefers-reduced-motion: reduce) { .rc-pager i { transition: none; } }" in html
