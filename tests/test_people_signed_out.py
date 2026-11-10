"""People, signed out, is a page (the owner, 2026-11-10: "designed by an artist not a programmer"): a drawing, the side's
name set large, three rows that say what each thing is, and the sign-in keys at the foot. Both sides are built by one
function, so Friends and Crews cannot drift apart."""
import re
from pathlib import Path

from tests.page_source import cockpit_source

ROOT = Path(__file__).resolve().parents[1]


def signed_out_block() -> str:
    src = (ROOT / "web" / "cockpit.js").read_text(encoding="utf-8")
    a = src.index("if (!me.signed_in) {\n        // Signed out is a page")
    return src[a:src.index("gbody.append(el('h3', { textContent: 'Your cars' })", a)]


def test_both_sides_are_the_same_page_with_their_own_drawing_and_name():
    block = signed_out_block()
    assert block.count("append(page(roads(") == 2                       # Friends and Crews, one builder
    assert "'Drive with friends.'" in block and "'Drive as a crew.'" in block
    assert "brand/logo.svg" not in block and "crew-gets" not in cockpit_source()
    # every promise has a name and a line that says what it is
    rows = re.findall(r"'((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\]", block)
    assert {r[0] for r in rows} == {"Who’s out driving", "Crew drives", "Shared routes", "Your crew’s page", "Convoys"}
    assert all(len(r[1]) > 20 and r[1].endswith(".") for r in rows)
    # one lead puck in each drawing, in the accent
    assert block.count(", true]") == 2


def test_sign_in_stands_at_the_foot_and_apple_matches_the_other_keys():
    block, html = signed_out_block(), (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    sign = block[block.index("const signIn"):block.index("const page")]
    assert sign.index("appleButton()") < sign.index("Sign in with Google") < sign.index("legalNote(")
    assert "style:" not in sign                                            # the key is styled by the sheet, not inline
    assert re.search(r"\.join-sign \{[^}]*margin-top: auto", html)
    assert re.search(r"\.join-sign \.apple-btn \{[^}]*min-height: 52px[^}]*border-radius: 0", html)
    assert re.search(r"\.join-sign a\.ink-btn \{[^}]*min-height: 52px", html)
    assert ".sheet .body:has(.join-page) { flex: 1 1 auto; }" in html     # only while this page is drawn


def test_the_drawing_is_ink_on_paper_with_one_accent():
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert re.search(r"\.jr-case \{ stroke: var\(--panel-ink\)", html) and re.search(r"\.jr-fill \{ stroke: var\(--panel\)", html)
    assert re.search(r"\.jr-puck\.lead \{ fill: var\(--accent\)", html)
