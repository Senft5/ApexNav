"""The Garage as a garage (REVIEW5 §2, REVIEW3 Roadmap 3 item 1, U-49; web/garage_settings.js): the page leads with you and
your cars, Look and voice and the co-driver; every other setting is a row behind one gear, none lost on the way."""
import json
import pathlib
import re
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
NODE = shutil.which("node")
HTML = (WEB / "index.html").read_text()


def garage_sections():
    return re.findall(r'<section([^>]*data-panel="garage"[^>]*)>', HTML)


def test_the_page_is_cars_look_and_the_co_driver():
    on_page = [a for a in garage_sections() if "data-setting" not in a]
    assert len(on_page) == 4, on_page                                   # you and your cars, Look and voice, Co-driver, The words
    assert any('id="garageMe"' in a for a in on_page) and any('id="lookSection"' in a for a in on_page)
    # the page's order: you and your cars first, then Look and voice, then the co-driver
    i_me, i_look = HTML.index('id="garageMe"'), HTML.index('id="lookSection"')
    i_co = HTML.index("<h3>Co-driver</h3>", i_look)
    assert i_me < i_look < i_co


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_every_setting_is_a_row_behind_the_gear_and_none_is_lost():
    order = json.loads(subprocess.run([NODE, "-e", "process.stdout.write(JSON.stringify(require(process.argv[1]).ORDER))", str(WEB / "garage_settings.js")],
                                      capture_output=True, text=True, check=True, timeout=30).stdout)
    keys = [re.search(r'data-setting="([a-z]+)"', a).group(1) for a in garage_sections() if "data-setting" in a]
    assert set(keys) == set(order), (keys, order)                      # every setting has its row, every row its sheet
    for k in set(keys):                                                 # each sheet is named once
        titled = [a for a in garage_sections() if f'data-setting="{k}"' in a and "data-title=" in a]
        assert len(titled) == 1, k
    # what used to be on the Garage's scroll is still there, by id, in a sheet
    for i in ("zoneRadius", "crashName", "crashPhone", "unitsRow", "sideRow", "feedbackBox", "myDataNote", "myGpxBtn", "myEraseBtn",
              "detourList", "hlList", "camList", "aboutVersion", "ambientNote", "garageRoadFeelBody", "garageAccountBody"):
        assert f'id="{i}"' in HTML, i
    for t in ("health", "crash"):
        assert f'data-toggle="{t}"' in HTML, t


def test_the_gear_loads_at_launch_and_the_account_lives_behind_it():
    assert '<script src="garage_settings.js" defer></script>' in HTML
    js = (WEB / "cockpit.js").read_text()
    assert "accBody.append(asec)" in js and "rfBody.append(dsec)" in js
    assert "ApexGarageSettings.ui.reveal(t)" in js                        # Who sees what → privacy zones opens its sheet
    gs = (WEB / "garage_settings.js").read_text()
    assert "aria-label', 'Settings'" in gs


def test_no_browser_scrollbar_in_sheets():
    # U-132: the Garage, People and every sheet scroll without the browser's bar
    assert ".sheet .body, .side-pop { scrollbar-width: none; }" in HTML
    assert ".sheet .body::-webkit-scrollbar, .side-pop::-webkit-scrollbar { display: none; }" in HTML
    assert "html, body { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }" in (WEB / "analysis.html").read_text()   # the Log


def test_default_on_data_rows_say_anonymous_on_the_row():
    # U-135: what the default-on switches send is on the row, not behind the fold
    assert "<span>Share app health (anonymous counts)</span>" in HTML
    assert "Attach diagnostics (app version, device, language, error count; never your position)" in (WEB / "feedback.js").read_text()


def test_crash_check_says_what_it_does_without_a_contact():
    # U-117: on by default; with no contact it still asks and offers the call, and says so in the open
    js = (WEB / "cockpit.js").read_text()
    assert 'id="crashState" role="status"' in HTML
    assert "On, with no contact: after a hard impact and a stop it asks if you're OK, then offers to call ${num}." in js


def test_road_data_line_follows_the_account_state():
    # U-116: signed out, signed in with the switch off, or on: never "Sign in" to a member
    js = (WEB / "cockpit.js").read_text()
    assert "'Off. Turn on Share road feel above.' : 'Off. Sign in to share road feel.'" in js
    assert "Sign in and turn on Share road feel in the Garage" not in js
    assert "earns 3×" not in js                                         # U-126: no multiplier of nothing
