"""No answer from the server (design pass 5, 2026-11-10): People is a page, not a heading over an empty sheet. It says
which it is (the phone offline, or Vetta not answering), lists what works without a connection, keeps Try again at its
foot, and asks again by itself when the connection returns. The Garage says what is missing in its own corner."""
import re
from pathlib import Path

from tests.page_source import cockpit_source

ROOT = Path(__file__).resolve().parents[1]


def lost_branch() -> str:
    src = cockpit_source()
    a = src.index("if (!me) {")
    return src[a:src.index("const inviteFromLink", a)]


def test_the_page_says_which_it_is_and_never_blames_the_phone_for_the_server():
    b = lost_branch()
    assert "navigator.onLine === false" in b                       # unknown is not "offline": only a phone that says so
    assert "You’re offline." in b and "Can’t reach Vetta." in b
    assert "lost-page" in b and "join-page" in b                   # the People page's parts and layout rules
    for row in ("Driving and notes", "Your Log", "Saved routes"):
        assert row in b


def test_try_again_is_at_the_foot_and_shows_it_is_trying():
    b = lost_branch()
    assert re.search(r"className: 'join-sign' \}, again\(\)", b)
    assert "b.disabled = true" in b and "Trying…" in b and "redo()" in b


def test_both_sides_and_the_garage_say_so():
    b = lost_branch()
    assert "body.append(lost(" in b and "cbody.append(lost(" in b
    assert "gbody.append(el('h3', { textContent: 'Your cars' })" in b      # no empty band over Look and voice
    assert "join-page" not in b[b.index("gbody.append"):]                  # never the People page in the Garage (#336)


def test_the_page_follows_the_connection():
    src = cockpit_source()
    assert re.search(r"for \(const ev of \['online', 'offline'\]\) window\.addEventListener\(ev, \(\) => \{ if \(document\.querySelector\('\.lost-page'\)\) renderAccount\(\); \}\);", src)


def test_the_road_that_stops_is_drawn_in_the_pages_own_inks():
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    rule = re.search(r"\.join-art \.jr-ghost \{([^}]*)\}", html).group(1)
    assert "var(--panel-dim)" in rule and "stroke-dasharray" in rule and not re.search(r"#[0-9a-fA-F]{3,6}", rule)
