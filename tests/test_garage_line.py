"""The Garage in the Vetta Line (docs/design/SIGNATURE.md): the title a masthead, the gear a key laid on the page, a car a
card of paper (its keys wells, the daily car marked with the apex dot), the look in use the one card ringed in ink."""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
SIG = (WEB / "signature.css").read_text()
GARAGE = SIG[SIG.index("/* ================= the Garage"):]


def test_the_garage_is_paper_not_ink_boxes():
    assert re.search(r"\.garage-cards \.car-card \{ border: 0; background: var\(--face, var\(--panel\)\); box-shadow: var\(--lift-0\);", GARAGE)
    assert re.search(r"\.theme-card \{ border: 0; background: var\(--face, var\(--panel\)\); box-shadow: var\(--lift-0\);", GARAGE)
    assert re.search(r"\.gear-key \{ border: 0;[^}]*box-shadow: var\(--lift-1\)", GARAGE)


def test_car_rules_outrank_the_ones_garage_ui_adds_later():
    # garage_ui.js appends its <style> after signature.css; a plain .car-card rule here would lose to it
    for rule in re.findall(r"^([^\n{]*\.car-card[^\n{]*)\{", GARAGE, re.M):
        assert rule.strip().startswith(".garage-cards .car-card"), rule
    assert ".car-card {" in (WEB / "garage_ui.js").read_text()


def test_one_look_is_ringed_and_the_shelf_does_not_clip_it():
    assert re.search(r"\.theme-card\.in-use \{[^}]*box-shadow: 0 0 0 2px var\(--panel-ink\)", GARAGE)
    assert "html:not([data-type-size]) .theme-cards { padding-top: 4px; padding-bottom: 8px; }" in GARAGE


def test_the_title_is_a_masthead():
    assert re.search(r'\.sheet\[data-view="garage"\] #sheetTitle \{ font: 800 30px/1 var\(--font-num\)', GARAGE)


def test_people_has_the_same_head_as_the_log_and_cards_are_paper():
    people = SIG[SIG.index("/* ================= People"):]
    assert ".people-tabs > button { font: 800 26px var(--font-num);" in people
    assert re.search(r"\.log-tabs > button \{[^}]*font: 800 26px/1 var\(--font-num\)", SIG), "the Log's head is the same size"
    assert ".sheet .card:not(.sample-crew) { border: 0; background: var(--face, var(--panel)); box-shadow: var(--lift-0); }" in people
