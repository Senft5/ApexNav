"""The Log in the Vetta Line (docs/design/SIGNATURE.md): the Log is its own page (analysis.html, shown in a frame over the
map), so it carried its own look: a red bar over the open tab where the map page draws the apex dot, a slide switch for
Drives and Stages, ink boxes round every row. It now loads the signature layer and its part is under body.log-page."""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
PAGE = (WEB / "analysis.html").read_text() + (WEB / "analysis_page.js").read_text()   # the page and its own script
SIG = (WEB / "signature.css").read_text()


def test_the_log_loads_the_signature_layer_last():
    controls, sig = PAGE.index('href="controls.css"'), PAGE.index('href="signature.css"')
    assert controls < sig < PAGE.index("</head>"), "signature.css comes after controls.css, as on the map page"
    assert '<body class="log-page">' in PAGE


def test_drives_and_stages_are_two_places_not_a_setting():
    heads = re.findall(r'<div class="log-seg log-tabs" role="tablist"[^>]*>(.*?)</div>', PAGE)
    assert len(heads) == 2, "the Drives page and the Stages page each have the head"
    for h in heads:
        assert h.count('role="tab"') == 2 and 'role="radio"' not in h
        assert 'data-seg="history"' in h and 'data-seg="segments"' in h
    assert "b.setAttribute('aria-selected', String(on))" in PAGE and "aria-checked', String(on)" not in PAGE
    assert '<h1 class="stages-h vh">Log</h1>' in PAGE, "the page keeps its name for screen readers"


def test_the_open_tab_is_the_apex_dot_on_both_pages():
    dot = re.search(r"\.log-page \.tabbar a\.on::before \{([^}]*)\}", SIG).group(1)
    assert "border-radius: 50%" in dot and "var(--accent)" in dot and "width: 6px" in dot
    assert re.search(r"\.tab\.on::before \{[^}]*border-radius: 50%", SIG), "the map page's tab bar draws the same dot"


def test_boxes_are_paper_and_rows_are_hairlines():
    assert re.search(r"\.log-page :is\([^)]*\.dp-card[^)]*\) \{ border: 0; background: var\(--face, var\(--panel\)\); box-shadow: var\(--lift-0\); \}", SIG)
    assert re.search(r"\.log-page \.stamp-d \{ border: 0;", SIG), "a drive's date is set, not stamped in a box"


def test_motion_is_cut_under_reduced_motion():
    block = SIG[SIG.index("/* ================= the Log"):]
    assert "animation: vl-ink" in block
    assert re.search(r"@media \(prefers-reduced-motion: reduce\) \{ \.log-page \.hero-score b, \.log-page \.dv-head \.score\.big \{ animation: none; \} \}", block)
