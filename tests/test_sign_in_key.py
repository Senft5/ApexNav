"""Something that needs an account used to say "Sign in (People) to …": a direction to go and find a tab. The message now
carries the key itself ("Sign in" opens People); in a drive it is only said, and no sheet opens over the road."""
from pathlib import Path

from tests.page_source import cockpit_source

ROOT = Path(__file__).resolve().parents[1]


def test_no_message_sends_the_driver_to_find_people():
    src = cockpit_source() + (ROOT / "web" / "friends_map.js").read_text(encoding="utf-8")
    assert "(People)" not in src
    for why in ("see measured roads", "share your ETA", "see friends on the map", "report hazards for others"):
        assert f"askSignIn('{why}')" in src


def test_the_message_carries_the_key_and_a_drive_only_hears_it():
    src = cockpit_source()
    fn = src[src.index("function askSignIn(why)"):src.index("function askSignIn(why)") + 400]
    assert "`Sign in to ${why}.`" in fn
    assert "{ label: 'Sign in', onClick: () => showView('friends') }" in fn
    assert fn.index("if (!$('driveBar').hidden) { driveNote(msg); return; }") < fn.index("toast(msg, {")
    assert "toast, askSignIn, apiCall" in src                       # the friends map is handed the same one


def test_sharing_a_route_with_nobody_to_share_with_says_so_like_the_convoy():
    src = cockpit_source()
    assert "'No friends or crews to share with yet. Add them in People.'" in src


def test_notifications_off_has_the_key_to_settings():
    src = cockpit_source()
    fn = src[src.index("function nudgeAnswered(granted)"):src.index("function nudgeAnswered(granted)") + 700]
    assert "{ label: 'Settings', onClick:" in fn and "postMessage({ cmd: 'openSettings' })" in fn
    assert 'if cmd == "openSettings"' in (ROOT / "ApexNavApp.swift").read_text(encoding="utf-8")
