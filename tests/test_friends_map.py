"""web/friends_map.js (REVIEW.md 5.4, roadmap 24): every puck's tag says how stale and how rough its position is; the
phone only sends while sharing, with a fix, outside home zones and (by default) while driving; the sheet's paragraph."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="needs node")
NOW = "Date.parse('2026-10-29T12:00:00Z')"


def run(js: str):
    src = f"const F = require({json.dumps(str(ROOT / 'web' / 'friends_map.js'))}); console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)


@needs_node
def test_tags_say_how_old_and_how_rough():
    t = lambda p: run(f"F.tag({p}, {NOW})")
    assert t("{ at: '2026-10-29T11:49:00Z', delay_s: 600, fuzz: true }") == "about 11 min ago · within a mile"
    assert t("{ at: '2026-10-29T11:59:30Z', delay_s: 0, fuzz: false, road: 'Cherohala Skyway' }") == "Driving · Cherohala Skyway"
    assert t("{ at: '2026-10-29T11:59:30Z', delay_s: 0, fuzz: false }") == "Driving · exact"
    assert t("{ at: '2026-10-29T11:55:00Z', delay_s: 0, fuzz: false, road: 'Skyway' }") == "about 5 min ago · exact"   # live but not fresh
    assert t("{ at: '2026-10-29T11:59:30Z', delay_s: 0, fuzz: true, road: 'Skyway' }") == "just now · within a mile"    # a road never with fuzz
    assert t("{ at: '2026-10-29T10:50:00Z', delay_s: 3600, fuzz: true }") == "about 1 h ago · within a mile"
    assert t("{ at: 'nope', delay_s: 0, fuzz: true }") == "--"


@needs_node
def test_should_send():
    base = "{ audience: 'friends', driving: true, onlyDriving: true, inZone: false, hasFix: true }"
    assert run(f"F.shouldSend({base})") is True
    for change in ["audience: 'nobody'", "driving: false", "inZone: true", "hasFix: false"]:
        assert run(f"F.shouldSend({{ ...{base}, {change} }})") is False, change
    assert run(f"F.shouldSend({{ ...{base}, driving: false, onlyDriving: false }})") is True


@needs_node
def test_explainer():
    assert "Nobody sees you until you choose" in run("F.explainer({ audience: 'nobody' })")
    assert run("F.explainer({ audience: 'crew', delay_s: 600, fuzz: true })").startswith("Your crews see you 10 minutes late, within a mile, only while you drive.")
    assert run("F.explainer({ audience: 'friends', delay_s: 0, fuzz: false, onlyDriving: false })").startswith("Your friends see you as you drive, where you are, whenever the app is open.")


@needs_node
def test_friend_state_in_the_people_list_is_measured_never_guessed():
    """The People list (the owner, 2026-10-30): a friend's line comes from what they share with you, or says they don't."""
    s = lambda p: run(f"F.friendState({p}, {NOW})")
    assert s("{ at: '2026-10-29T11:59:30Z', delay_s: 0, fuzz: false, road: 'Cherohala Skyway' }") == {"live": True, "text": "On the road · Cherohala Skyway"}
    assert s("{ at: '2026-10-29T11:59:30Z', delay_s: 0, fuzz: true, road: 'Skyway' }") == {"live": True, "text": "On the road"}   # a road never with fuzz
    assert s("{ at: '2026-10-29T11:55:00Z', delay_s: 0, fuzz: false }") == {"live": False, "text": "Seen 5 min ago"}   # live but not fresh
    assert s("{ at: '2026-10-29T11:49:00Z', delay_s: 600, fuzz: true }") == {"live": False, "text": "Seen 11 min ago"}   # delayed: never "on the road"
    assert s("{ at: '2026-10-29T10:50:00Z', delay_s: 3600, fuzz: true }") == {"live": False, "text": "Seen 1 h ago"}
    assert s("null") == {"live": False, "text": "Not sharing where they are"}
    assert s("{ at: 'nope', delay_s: 0 }") == {"live": False, "text": "--"}


def test_layer_is_off_by_default_and_nothing_is_shared_by_default():
    html = (ROOT / "web" / "index.html").read_text()
    assert re.search(r"toggles: \{[^}]*friends: false", html)
    src = (ROOT / "backend" / "src" / "presence.ts").read_text()
    assert 'audience: "nobody"' in src                      # no row means Nobody
