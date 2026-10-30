"""The confirm sheet (web/confirm.js, docs/design/REVIEW.md 1.2 Settings): every destructive action asks on the app's own
sheet, red text for the action and Cancel as the default, never the system's confirm() box."""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
NATIVE = re.compile(r"(?<![\w.])confirm\(")


def test_no_system_confirm_left():
    hits = [f"{p.name}:{n}" for p in sorted(WEB.glob("*.js")) + sorted(WEB.glob("*.html"))
            for n, line in enumerate(p.read_text().splitlines(), 1) if NATIVE.search(line)]
    assert hits == [], hits


def test_loaded_where_it_is_used():
    for page in ("index.html", "analysis.html"):
        assert '<script src="confirm.js"' in (WEB / page).read_text(), page


def test_cancel_is_the_default_and_the_action_is_red():
    js = (WEB / "confirm.js").read_text()
    assert "no.focus();" in js and "e.key === 'Escape'" in js and "e.target === back" in js
    css = (WEB / "controls.css").read_text()
    assert ".confirm-sheet .cs-yes { border: 0; color: var(--accent); }" in css
