"""web/format.js: 12-hour times everywhere (owner 2026-10-26)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

SCRIPT = r"""
const F = require('./web/format.js');
console.log(JSON.stringify({
  clock: [[0, 5], [9, 0], [12, 0], [17, 3], [23, 59], [null, 1]].map(([h, m]) => F.clock12(h, m)),
  dateTime: ['2026-11-01T08:02', '2026-10-31T00:15:09', '2026-10-26T17:03', '2025-12-24T09:00', '2026-10-26', '', 'nonsense', null]
    .map((s) => F.dateTime(s, new Date(2026, 10, 1, 9, 30), 'en-GB')),
  dateTimeMapped: ['2026-10-26'].map(F.dateTime).length,
  scale: [17, 19, 23, 34, 53, 14, 0, NaN, undefined].map((x) => F.typeScale(x)),
  scales: [17, 21, 23, 53].map(F.typeScales),
  names: ['Drive 10/26/2026 17:03', 'Drive 10/26/2026 09:41', 'Dry Ridge', 'Drive 10/26/2026 5:03 PM', 'web_20261027_080000', 'web_20261027_1703', 'my web_20261027_080000'].map(F.driveName),
  plain: ['Same plan \u{1F697}\u{1F4A8} meet 6:15', 'Fog \u{2601}\u{FE0F} gone by 7', '\u{1F44D}\u{1F3FD}', 'no emoji here', null, 'Sticker \u00A9 2026, Bilstein\u00AE B6, GR86\u2122'].map(F.noEmoji),
}));
"""


def test_twelve_hour_formatting():
    root = Path(__file__).resolve().parents[1]
    p = subprocess.run([NODE, "-e", SCRIPT], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout)
    assert r["clock"] == ["12:05 AM", "9:00 AM", "12:00 PM", "5:03 PM", "11:59 PM", "--"]
    # U-126: the Log's dates said, not set like a database field
    assert r["dateTime"] == ["Today, 8:02 AM", "Yesterday, 12:15 AM", "26 Oct, 5:03 PM", "24 Dec 2025, 9:00 AM", "26 Oct", "--", "--", "--"]
    assert r["dateTimeMapped"] == 1
    assert r["names"] == ["Drive 10/26/2026 5:03 PM", "Drive 10/26/2026 9:41 AM", "Dry Ridge", "Drive 10/26/2026 5:03 PM", "Drive 10/27/2026 8:00 AM", "web_20261027_1703", "my web_20261027_080000"]


def test_type_scale_follows_phone_text_size():
    root = Path(__file__).resolve().parents[1]
    p = subprocess.run([NODE, "-e", SCRIPT], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert p.returncode == 0, p.stderr
    # default Large = 1; xxxLarge-ish 23 px = 1.35; accessibility sizes capped at 2 (IN-1, WCAG 1.4.4); smaller or unknown never shrinks
    r = json.loads(p.stdout)
    assert r["scale"] == [1, 1.1, 1.35, 2, 2, 1, 1, 1, 1]
    # the end card fits one screen: its own cap is 1.6; the route card changes shape from 1.4
    assert [(s["scale"], s["fit"], s["size"]) for s in r["scales"]] == [(1, 1, ""), (1.25, 1.25, "up"), (1.35, 1.35, "up"), (2, 1.6, "large")]


def test_chat_and_replies_render_emoji_as_text():
    """REVIEW.md "Not doing": no emoji anywhere, chat included (IDEAS U-46). The crew chat and build replies draw bodies through noEmoji."""
    root = Path(__file__).resolve().parents[1]
    p = subprocess.run([NODE, "-e", SCRIPT], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert p.returncode == 0, p.stderr
    assert json.loads(p.stdout)["plain"] == ["Same plan meet 6:15", "Fog gone by 7", "", "no emoji here", "", "Sticker \u00a9 2026, Bilstein\u00ae B6, GR86\u2122"]
    for f, needle in (("web/crew_page.js", "textContent: plain(m.body)"), ("web/builds.js", "textContent: plain(r.body)")):
        assert needle in (root / f).read_text(encoding="utf-8"), f


def test_a_chart_day_reads_as_a_day():
    """The Log's charts and records said "10-30" and "2026-10-30" beside list stamps that say "30 OCT" (2026-11-10)."""
    root = Path(__file__).resolve().parents[1]
    js = "const F=require('./web/format.js');console.log(JSON.stringify([['2026-10-30','2026-11-02T09:00:00','2026-02-30','10-30','',null].map((x)=>F.dayShort(x,'en-GB')),F.dayShort('2026-10-30','en-US')]))"
    gb, us = json.loads(subprocess.run([NODE, "-e", js], cwd=root, capture_output=True, text=True, encoding="utf-8", check=True, timeout=30).stdout)
    assert gb == ["30 Oct", "2 Nov", "", "", "", ""] and us == "Oct 30"      # a day that doesn't exist is no day
    page = (root / "web" / "analysis.html").read_text(encoding="utf-8") + (root / "web" / "analysis_page.js").read_text(encoding="utf-8")
    assert ".slice(5, 10)}</text>" not in page
    assert "ApexFormat.dateTime(d.date.slice(0, 10))" in page and page.count("ApexFormat.dayShort(") == 3   # the road chart, the records, a ghost duel's day
