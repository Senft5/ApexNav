"""An empty Garage is a page, like People's first friend and first crew (round three, 2026-11-11): a dashed bay with a road
pulling in, "Park your first car." set large, the sentence kept, and "Add a car" as the full-width solid key."""
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
JS = (WEB / "garage_ui.js").read_text()
SIG = (WEB / "signature.css").read_text()


def test_the_empty_garage_is_a_page():
    assert "el('div', { className: 'people-first garage-first' }" in JS
    assert "textContent: 'Park your first car.'" in JS
    assert '<rect class="jr-bay"' in JS and ".garage-first .join-art .jr-bay {" in SIG


def test_add_a_car_is_the_solid_key_only_when_empty():
    assert "btn('Add a car', () => { editing = 'new'; render(); }, first ? 'ink-btn solid' : undefined)" in JS


def test_the_drawing_is_a_well_not_a_bleed():
    assert ".garage-first .join-art { margin: 2px 0 0; border: 0; border-radius: 12px;" in SIG
