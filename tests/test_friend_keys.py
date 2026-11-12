"""A friend's profile has two, three or four keys in two columns (a tap on the friend opens it, 2026-11-12). With three,
the third sat in half the row beside a hole; an odd last key takes the whole row."""
import re
from pathlib import Path

HTML = (Path(__file__).resolve().parents[1] / "web" / "index.html").read_text(encoding="utf-8")


def test_an_odd_last_key_spans_the_row():
    assert re.search(r"\.row\.profile-keys \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);", HTML)
    assert re.search(r"\.profile-keys > :last-child:nth-child\(odd\) \{ grid-column: 1 / -1; \}", HTML)
    assert "friend-keys" not in HTML
