"""Design pass 4 (2026-11-10): on a phone the Garage's looks stand on a shelf turned sideways (three stacked cards were
750 px of the page); a mouse or large text keeps the stack. Signed out, Your cars is an empty bay with a sign-in key."""
import re
from pathlib import Path

from tests.page_source import cockpit_source

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "web" / "index.html").read_text(encoding="utf-8")


def shelf_css() -> str:
    a = HTML.index("@media (hover: none) and (pointer: coarse) {\n      html:not([data-type-size]) .theme-cards")
    return HTML[a:HTML.index("\n    }\n", a)]


def test_the_shelf_is_for_touch_at_the_normal_text_size_only():
    css = shelf_css()
    rules = [l.strip() for l in css.splitlines()[1:] if l.strip() and not l.strip().startswith("overflow-x")]
    assert all(l.startswith("html:not([data-type-size]) ") for l in rules), rules   # large text keeps the stack
    assert "scroll-snap-type: x mandatory" in css and "scroll-snap-align: start" in css
    assert "overscroll-behavior-x: contain" in css                                   # the page behind never slides with it
    assert re.search(r"grid-auto-columns: (8\d)%", css)                              # the next look's edge shows


def test_a_sideways_drag_on_the_shelf_turns_it_and_never_closes_the_sheet():
    src = cockpit_source()
    assert "x0 = e.target.closest && e.target.closest('.theme-cards') ? null : e.touches[0].clientX" in src
    # it opens on the look in use, and only turns by itself when the look changed
    fn = src[src.index("function shelveLooks()"):src.index("function shelveLooks()") + 500]
    assert "box._at === state.theme" in fn and "cur.card.offsetLeft - box.firstElementChild.offsetLeft" in fn
    assert "shelveLooks();" in src[src.index("function renderThemePicker()"):src.index("function shelveLooks()")]


def test_your_cars_signed_out_is_an_empty_bay_with_the_key_to_sign_in():
    src = cockpit_source()
    assert "Sign in (People) to keep your cars" not in src                           # no "(People)" directions in prose
    bay = src[src.index("className: 'empty-bay'"):src.index("className: 'empty-bay'") + 900]
    assert "No car parked here yet" in bay and "btn('Sign in', () => showView('friends'), 'ink-btn')" in bay
    assert re.search(r"\.empty-bay \.eb-slot \{[^}]*dashed", HTML)
    assert "html[data-type-size] .empty-bay { grid-template-columns: minmax(0, 1fr); }" in HTML
