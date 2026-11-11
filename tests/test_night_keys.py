"""Red team UX-07 (2026-11-10): at night no key is the brightest thing on the drive screen.

End, Done and the chosen replay speed were solid cream slabs at night. At night they are outlined in the panel's ink
(web/index.html), with the same layout as by day.
"""
import os
import re

HTML = open(os.path.join(os.path.dirname(__file__), "..", "web", "index.html"), encoding="utf-8").read()


def rule(selector_part):
    m = re.search(r'html\[data-mode="night"\][^{]*' + re.escape(selector_part) + r'[^{]*\{([^}]*)\}', HTML)
    assert m, selector_part
    return m.group(1)


def test_end_and_done_are_outlined_at_night():
    for sel in ("#driveEnd:not(.undo)", "#replayDone"):
        body = rule(sel)
        assert "background: transparent" in body and "border: 1.5px solid var(--panel-ink)" in body, sel


def test_the_chosen_speed_is_outlined_at_night():
    body = rule('.detents > [aria-checked="true"]')
    assert "background: transparent" in body and "inset 0 0 0 2px var(--panel-ink)" in body
