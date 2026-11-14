"""Get the app on an invite link's bar (web/cockpit.js): the App Store with a campaign tag, hidden until the owner sets the
app's id and provider token (docs/OWNER_TODO.md)."""
import re
from pathlib import Path

SRC = (Path(__file__).resolve().parents[1] / "web/cockpit.js").read_text(encoding="utf-8")
BLOCK = SRC[SRC.index("Have the app? Open it there") - 2000: SRC.index("Have the app? Open it there") + 2500]


def test_hidden_until_the_owner_sets_the_ids():
    assert "const APP_STORE_ID = null, APP_STORE_PT = null;" in BLOCK
    assert re.search(r"if \(/\^\\d\{6,12\}\$/\.test\(String\(APP_STORE_ID", BLOCK)


def test_link_carries_a_campaign_per_kind_of_link():
    assert "https://apps.apple.com/app/id${APP_STORE_ID}?pt=${APP_STORE_PT}&ct=${ct}" in BLOCK
    for ct in ("route-share", "crew", "convoy", "invite"):
        assert f"'{ct}'" in BLOCK
