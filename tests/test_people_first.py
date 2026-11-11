"""Signed in with nobody yet, People is a page like the signed-out one (round three, 2026-11-11): a drawing (your road
drawn, the friend's road or the crew's seats still pencil), what to do set large, one sentence, the one key full width."""
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
JS = (WEB / "cockpit.js").read_text()
SIG = (WEB / "signature.css").read_text()


def test_the_first_friend_and_the_first_crew_are_pages():
    assert "el('h3', { className: 'join-head', textContent: 'Bring a friend.' })" in JS
    assert "el('h3', { className: 'join-head', textContent: 'Start a crew.' })" in JS
    assert JS.count("el('div', { className: 'people-first' }") == 2
    # the people-lead sentence stays (e2e waits for it), inside the page
    assert "el('p', { className: 'people-lead', textContent: 'They sign in with your link" in JS


def test_pencil_is_what_is_still_to_come():
    assert 'class="jr-ghost" d="M92 140' in JS, "the friend's road, not yet drawn"
    assert 'class="jr-seat"' in JS and ".join-art .jr-seat {" in SIG


def test_the_key_is_full_width_under_the_page():
    assert ".people-first + .row > .ink-btn.solid { flex: 1 1 auto; min-height: 52px;" in SIG
