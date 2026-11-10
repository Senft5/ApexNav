"""A place pinned or tapped on the map goes by a name, never by its coordinates (2026-11-10): the field and the route say
the road's name when the lookup knew it, else "Dropped pin"; the exact point rides beside the field. The whole of it is driven
in e2e/smoke.js ("a pin has a name"); here, that the old wording and the coordinate strings cannot come back unnoticed."""
import pathlib
import re

WEB = pathlib.Path(__file__).resolve().parents[1] / "web"
JS = (WEB / "cockpit.js").read_text(encoding="utf-8")
HTML = (WEB / "index.html").read_text(encoding="utf-8")


def test_no_field_is_filled_with_coordinates():
    # the pin's keys and the map tap all go through setFieldPin; nothing writes "lat, lon" into Where to? or From
    assert not re.search(r"\$\('(?:destInput|fromInput)'\)\.value = `\$\{[^`]*toFixed", JS)
    assert not re.search(r"\.value = `\$\{e\.lngLat\.lat", JS)
    assert JS.count("setFieldPin(") >= 4          # its definition, Go here, Start from here, the map tap


def test_a_pin_is_named_and_an_unnamed_one_is_not_kept():
    assert "const PIN_WORD = 'Dropped pin'" in JS
    assert "label === PIN_WORD ? 'To a dropped pin'" in JS
    assert "p.label === PIN_WORD ||" in JS        # rememberPlace: an unnamed pin is never a recent place
    # the swap key takes the points with the words
    assert "[fieldPin.fromInput, fieldPin.destInput] = [fieldPin.destInput, fieldPin.fromInput]" in JS


def test_the_words_match_the_screen():
    assert "Save as highlight" not in HTML and ">Save as a spot<" in HTML      # the app calls them spots everywhere else
    assert "Press Go" not in JS                                                 # the key under the note says Search
    assert "Press Search to look everywhere." in JS and "Press Search to try." in JS


def test_a_rating_fills_its_stars():
    assert "b.classList.toggle('on', n <= value)" in JS
    assert "#hlRating button.on" in HTML
