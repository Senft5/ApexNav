"""The empty Log and Stages pages (design pass 2026-11-10): the page's own furniture in pencil, a head, one line and one
key, instead of a sentence on a blank sheet. Nothing drawn there may read as a result: unknown stays "--"."""
import re
from pathlib import Path

PAGE = (Path(__file__).resolve().parents[1] / "web" / "analysis.html").read_text()


def test_the_empty_log_is_a_first_page_with_one_thing_to_do():
    m = re.search(r'<div class="first-page" id="historyEmpty" hidden>(.*?)\n      </div>', PAGE, re.S)
    assert m, "the first page is there, hidden until the store has answered"
    page = m.group(1)
    ghost = re.search(r'<div class="fp-ghost" aria-hidden="true">(.*?)</div>\s*<h2', page, re.S).group(1)
    assert not re.search(r">\s*\d", ghost.replace("/1000", "")), "no figure in the pencil sketch: nothing reads as a score"
    assert '<span class="score">--</span>' in ghost and "<b>--</b>" in ghost
    assert '<a class="btn solid fp-go" href="index.html">Start a drive</a>' in page
    assert 'href="index.html?drive=dry_ridge&amp;play=1">Watch a replay first</a>' in page
    assert "$('historyEmpty').hidden = !drivesLoaded || drives.length > 0;" in PAGE      # never before the store answered


def test_the_empty_stages_page_says_what_a_stage_is_and_how_to_make_one():
    assert '<h2 class="fp-head">No stages yet.</h2>' in PAGE
    assert "Pick a drive to mark one from" in PAGE and "Mark one from a drive\\u2019s page." in PAGE
    assert 'class="fp-mark"' in PAGE and 'aria-hidden="true"' in PAGE


def test_the_logs_switch_uses_the_pages_typeface():
    # a <button> does not inherit font-family by itself: Drives / Stages were set in Arial beside Inter Tight
    assert ".switch > button { font-family: inherit; }" in PAGE
