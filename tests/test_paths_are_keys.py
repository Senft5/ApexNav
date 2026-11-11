"""A note that named a path ("Garage → Settings → Spots") left the driver to walk it. Where a tap can take them, the note
carries the key; in the crash sheet, where nothing should lead away, it is a plain sentence."""
from pathlib import Path

from tests.page_source import cockpit_source

WEB = Path(__file__).resolve().parents[1] / "web"


def test_no_note_shows_an_arrow_path_in_the_spots_list_or_the_crash_sheet():
    for name in ("spots_feed.js", "incident.js"):
        src = (WEB / name).read_text(encoding="utf-8")
        assert "Garage → Settings" not in src, name


def test_no_spots_nearby_offers_the_key_that_opens_spots():
    feed = (WEB / "spots_feed.js").read_text(encoding="utf-8")
    assert "'No shared spots near here yet. ', page.addSpot ? btn('Add one', () => page.addSpot(), 'linkbtn')" in feed
    assert "addSpot: () => { showView('garage'); if (window.ApexGarageSettings && ApexGarageSettings.ui) ApexGarageSettings.ui.open('spots'); }" in cockpit_source()
    assert 'data-setting="spots"' in (WEB / "index.html").read_text(encoding="utf-8")


def test_the_crash_sheet_says_it_plainly_and_leads_nowhere():
    src = (WEB / "incident.js").read_text(encoding="utf-8")
    assert "'To text someone from here, add an emergency contact in Settings, under Crash check.'" in src
