"""Crew settings (the gear on a crew's page) in the Settings list's shape: a small-caps name over each part, the
explanation a line under its keys (it sat beside "Who can invite" and broke the label over two lines), keys that are a
line of text starting at the left, and an area field whose hint is not cut."""
import re
from pathlib import Path

from tests.page_source import cockpit_source

HTML = (Path(__file__).resolve().parents[1] / "web" / "index.html").read_text(encoding="utf-8")


def sheet() -> str:
    src = cockpit_source()
    a = src.index("const crewSettingsFor = (c) => {")
    return src[a:src.index("return box;", a)]


def test_each_part_has_its_name_in_the_lists_small_caps():
    s = sheet()
    for name in ("What it sees of yours", "Who can invite", "Who can find it"):
        assert f"el('h4', {{ className: 'nav-group', textContent: '{name}' }})" in s, name
    assert "className: 'ctl-label', textContent: 'Who can invite'" not in s                 # named once


def test_the_explanations_are_lines_of_their_own():
    s = sheet()
    assert "el('small', { textContent: 'whoever opens a crew link" not in s
    assert "el('p', { className: 'note', textContent: 'Whoever opens a crew link joins, and is friends with the sender.' })" in s
    # Nate 2026-11-12 (no walls of text): one line; what going public costs the members is asked on the Make public key
    assert "'Private: link only. Public: people near the area you name can find it.'" in s
    assert "stop showing until each says yes again.`, 'Make public')" in s
    assert "`Public: people near ${c.area_name} can find and join it.`" in s
    assert "sees nothing of yours yet.` })" in s and "el('p', { className: 'note', textContent: g.share_scores" in s


def test_the_area_field_says_what_fits_and_is_named_for_a_screen_reader():
    s = sheet()
    assert "placeholder: 'Area, like Robbinsville'" in s
    assert "areaIn.setAttribute('aria-label', 'Area people nearby will see')" in s


def test_text_keys_start_at_the_left_and_notes_are_pencil():
    assert re.search(r"\.crew-settings \.linkbtn, \.crew-settings \.danger-btn \{ justify-self: start; \}", HTML)
    assert re.search(r"\.crew-settings p\.note \{ font-size: 13px; color: var\(--panel-dim\)", HTML)
    assert re.search(r"\.crew-settings \.row > \.field \{ flex: 1 1 0; min-width: 0; \}", HTML)


def test_meeting_points_is_named_like_the_rest_of_the_crews_page():
    js = (Path(__file__).resolve().parents[1] / "web" / "crew_page.js").read_text(encoding="utf-8")
    assert "el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Meeting points' }))" in js
    for name in ("Members", "Vetta Score board"):   # Chat: its tab names it (no heading under the tab)
        assert re.search(r"className: 'cp-sec' \}, el\('h3', \{ textContent: '" + name + "'", js), name
