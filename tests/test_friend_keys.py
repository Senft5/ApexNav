"""A friend's row has two, three or four keys in two columns. With three, the third sat in half the row beside a hole;
an odd last key takes the whole row."""
import re
from pathlib import Path

HTML = (Path(__file__).resolve().parents[1] / "web" / "index.html").read_text(encoding="utf-8")


def test_an_odd_last_key_spans_the_row():
    assert re.search(r"\.row\.friend-keys \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);", HTML)
    assert re.search(r"\.friend-keys > :last-child:nth-child\(odd\) \{ grid-column: 1 / -1; \}", HTML)
