"""Shared states (screen inventory 2026-11-16) on a friend's profile and on Who sees what: loading is the real layout
(a skeleton), never a "Loading…" line; what didn't load says so and has Try again."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def test_who_sees_what_loads_as_a_skeleton():
    src = (WEB / "who_sees.js").read_text(encoding="utf-8")
    assert "'Loading…'" not in src and "className: 'who-skel', 'aria-busy': 'true'" in src
    assert "btn('Try again', async () => { data = await load(); paint(); }" in src


def test_a_friends_profile_opens_at_once_and_the_rest_can_be_tried_again():
    cockpit = (WEB / "cockpit.js").read_text(encoding="utf-8")
    fn = cockpit[cockpit.index("const openProfile = async (f) => {"):][:3000]
    assert "className: 'stack-8 profile-view skel', 'aria-busy': 'true'" in fn
    assert fn.index("profile-view skel") < fn.index("await apiCall('GET', `/api/friends/")   # drawn before the request
    assert "retry: () => openProfile(f)" in fn
    view = (WEB / "profile_view.js").read_text(encoding="utf-8")
    assert "'stack-8 pv-lost'" in view and "btn('Try again', retry, 'ink-btn')" in view
