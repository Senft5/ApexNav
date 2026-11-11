"""A message with a key (a toast with an action) is one row: the words on the left, the key whole on the right, in ink
and underlined like every other text key, a thumb tall to hit. It was an inline link in the red pen that dropped under
the words when they wrapped. And a message is as wide as its words: centred from left: 50%, it shrank to half the
screen and wrapped early."""
import re
from pathlib import Path

from tests.page_source import cockpit_source

HTML = (Path(__file__).resolve().parents[1] / "web" / "index.html").read_text(encoding="utf-8")


def test_the_key_is_a_class_not_an_inline_style():
    src = cockpit_source()
    fn = src[src.index("function toast(msg, action) {"):src.index("function toast(msg, action) {") + 1800]
    assert "a.className = 'toast-key'" in fn and "a.style.cssText" not in fn
    assert "t.classList.toggle('has-key', !!action);" in fn          # a plain message after one with a key is plain again


def test_one_row_in_ink_with_a_thumb_tall_key():
    assert re.search(r"\.toast\.show\.has-key \{ display: flex; align-items: center; gap: 14px; text-align: left; \}", HTML)
    key = re.search(r"\.toast \.toast-key \{([^}]*)\}", HTML).group(1)
    assert "color: var(--panel-ink)" in key and "text-decoration: underline" in key and "white-space: nowrap" in key
    assert "var(--accent)" not in key                                  # the red pen stays for what means slow down
    assert "padding: 15px 6px; margin: -15px -6px -15px auto;" in key  # 14 px of words + 30 = a thumb, the box no taller


def test_a_message_is_as_wide_as_its_words():
    assert re.search(r"\.toast\.show \{ display: block; width: max-content; \}", HTML)
    assert re.search(r"\.toast \{[^}]*max-width: calc\(100% - 32px\)", HTML)


def test_saved_for_offline_does_not_end_in_a_question_mark_and_a_full_stop():
    src = cockpit_source()
    assert "Where to?.`" not in src and "It's listed in Where to? now.`" in src
