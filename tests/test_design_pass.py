"""Design pass 2 (2026-11-10): the route card's last row is a ruled strip of keys, and the map's credit sits on the
look's own tokens (IDEAS U-53) instead of MapLibre's stock white pill."""
import re
from pathlib import Path

PAGE = (Path(__file__).resolve().parents[1] / "web" / "index.html").read_text()


def test_the_route_cards_last_row_is_a_strip_of_keys():
    row = re.search(r'<div class="rc-links">(.*?)</div>', PAGE, re.S).group(1)
    assert re.findall(r'id="(\w+)"', row) == ["routeSaveBtn", "routeShareBtn", "etaShareBtn", "routeGpxBtn", "routePinBtn"]
    rule = re.search(r"\.rc-links \.linkbtn \{([^}]*)\}", PAGE).group(1)
    assert "text-decoration: none" in rule and "min-height: 48px" in rule and "border-left: 1px solid var(--rule)" in rule
    # pressed (Saved) is ink-filled; the id rule below outranks a class rule, so the pressed rule names the id too (it was ink on ink)
    assert '.rc-links .linkbtn[aria-pressed="true"], .rc-links #routeSaveBtn[aria-pressed="true"] { background: var(--panel-ink); color: var(--panel); }' in PAGE
    # REVIEW2's two weights stay: Save and Share in ink, the rest in pencil
    assert ".rc-links #routeSaveBtn, .rc-links #routeShareBtn { color: var(--panel-ink); font-weight: 700; }" in PAGE
    assert "html[data-type-size] .rc-links { display: grid; grid-template-columns: 1fr 1fr;" in PAGE


def test_the_maps_credit_is_on_the_looks_tokens():
    rule = re.search(r"#map \.maplibregl-ctrl-attrib\.maplibregl-compact \{([^}]*)\}", PAGE).group(1)
    assert "border-radius: 0" in rule and "background: var(--panel)" in rule and "border: 1.5px solid var(--panel-ink)" in rule
    assert '#map .maplibregl-ctrl-attrib-button::before { content: "i"; font: 700 15px/1 var(--font-num); color: var(--panel-ink); }' in PAGE
    assert not re.search(r"maplibregl-ctrl-attrib[^{]*\{[^}]*display:\s*none", PAGE), "the credit is restyled, never hidden"
