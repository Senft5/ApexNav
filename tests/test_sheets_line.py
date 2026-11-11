"""The sheets over a page in the Vetta Line (docs/design/SIGNATURE.md): every .side-pop (Settings and each setting, Options,
Best roads nearby, People's, a crew's, roadbooks, duels) rises on the deck's lift with a masthead title, and a mode switch
(controls.css .switch) is a well with the chosen key in ink, not a 2 px ink frame with a pressed-in thumb."""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
SIG = (WEB / "signature.css").read_text()
SHEETS = SIG[SIG.index("/* ================= the sheets over a page"):]


def test_a_sheet_rises_on_the_lift_not_a_rule():
    assert ".side-pop { border-top: 0; box-shadow: var(--lift-2); }" in SHEETS
    assert "box-shadow: 0 -12px 32px" in (WEB / "index.html").read_text(), "the rule this replaces is still index.html's"


def test_the_title_is_a_masthead_and_never_pushes_the_key_off():
    assert re.search(r"\.side-pop > \.side-pop-head h3 \{ font: 800 26px/1\.05 var\(--font-num\);[^}]*min-width: 0;", SHEETS)
    assert ".side-pop > .side-pop-head h3 + * { flex: none; }" in SHEETS
    # no rule under the head: the first row (a switch, a list) brings its own hairline
    head = re.search(r"\.side-pop > \.side-pop-head \{([^}]*)\}", SHEETS).group(1)
    assert "border" not in head


def test_a_mode_is_a_well_with_the_choice_in_ink():
    assert ".switch { border: 0; background: var(--well); }" in SHEETS
    on = re.search(r'\.switch > \.on, \.switch > \[aria-checked="true"\], \.switch > \[aria-pressed="true"\] \{([^}]*)\}', SHEETS).group(1)
    assert "box-shadow: none" in on and "background" not in on, "the chosen key keeps controls.css's ink fill"
    assert "background: var(--panel-ink)" in (WEB / "controls.css").read_text()


def test_the_desk_panel_matches_index_html_breakpoint():
    assert "@media (min-width: 1100px) and (min-height: 600px)" in (WEB / "index.html").read_text()
    assert "@media (min-width: 1100px) and (min-height: 600px) { .side-pop { border-left: 0; } }" in SHEETS


def test_the_deck_is_not_an_occluder_so_the_map_reaches_the_top():
    # an opaque deck over the WebGL canvas let Chromium cull the canvas's top (a blank band the deck's height)
    sig = SIG[SIG.index("/* ================= the map under the deck"):]
    assert ".binnacle { background: color-mix(in srgb, var(--panel) 99.6%, transparent); }" in sig


def test_a_crews_name_and_the_share_box():
    tail = SIG[SIG.index("/* ================= a crew's page"):]
    assert ".crew-head > b { font: 800 30px/1.05 var(--font-num);" in tail
    assert "body .cp-title h2 { font: 800 32px/1.02 var(--font-num);" in tail   # crew_page.js adds its CSS later
    assert "#routeSharePick .row .ink-btn:not(.solid):not(.on) { border-color: transparent; background: var(--well); }" in tail
