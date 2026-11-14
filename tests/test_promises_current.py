"""The promises say what the app does now: sharing with friends and private crews is on by default (2026-11-11), there
are time attack boards, and speed stays (Pace in the Score, live time gaps, the drive's own speed trace; owner
2026-11-10/14), so no page may still promise "no time leaderboards", "no top speeds" or that times are shown only to
whom you choose. The privacy policy says who sees Scores and times, and how to switch it off."""
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
PAGES = {n: (WEB / n).read_text(encoding="utf-8") for n in ("about.html", "index.html", "privacy.html")}


def test_no_stale_promises():
    for name, text in PAGES.items():
        for stale in ("No public races", "No speed or time leaderboards", "no public speed or time leaderboards", "Yours until you share it",
                      "No top speeds", "never your top speed", "Clean beats", "not a racing app", "how you drive stays yours"):
            assert stale not in text, f"{name} still says {stale!r}"


def test_the_new_promises():
    for name in ("about.html", "index.html"):
        assert "Shared with your people" in PAGES[name] and "Home stays home" in PAGES[name], name


def test_privacy_says_who_sees_scores_and_times():
    p = PAGES["privacy.html"]
    assert "<h2>Scores and times with friends and crews</h2>" in p
    assert "on from the start" in p and "Who sees what" in p and "A public crew sees them only if you say yes" in p
