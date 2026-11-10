"""A message (toast) is a sentence, on every screen: it starts with what happened and ends with a full stop, a question
mark or an ellipsis. Eight of 193 were label-style ("Spot saved · name", "Traffic ahead · 4 min"); the traffic ones now
read as the voice says them."""
import glob
import os
import re

WEB = os.path.join(os.path.dirname(__file__), '..', 'web')


def messages():
    """Every toast whose text is written where it is shown: (file, line, text)."""
    out = []
    for path in sorted(glob.glob(os.path.join(WEB, '*.js'))):
        s = open(path, encoding='utf-8').read()
        for m in re.finditer(r"\btoast\(\s*(['\"`])", s):
            q, i = m.group(1), m.end()
            j, depth = i, 0
            while j < len(s):
                c = s[j]
                if c == '\\':
                    j += 2
                    continue
                if q == '`' and s[j:j + 2] == '${':
                    depth += 1
                    j += 2
                    continue
                if depth and c == '}':
                    depth -= 1
                elif not depth and c == q:
                    break
                j += 1
            out.append((os.path.basename(path), s.count('\n', 0, i) + 1, s[i:j]))
    return out


def test_the_reader_finds_the_messages():
    assert len(messages()) > 150


def test_every_message_ends_as_a_sentence():
    loose = [m for m in messages() if not re.search(r"[.!?…]$", m[2])]
    assert not loose, loose


def test_no_message_is_two_labels_joined_by_a_dot():
    # a "·" joins facts on a row or a card; a message is said in words
    assert not [m for m in messages() if ' · ' in re.sub(r"\$\{.*?\}", '', m[2])]


def test_traffic_reads_as_the_voice_says_it():
    s = open(os.path.join(WEB, 'cockpit.js'), encoding='utf-8').read()
    assert "toast(`Traffic ahead. ${delayMin} min slower.`)" in s
    assert "toast(`Traffic ahead. Switching to ${road}${extraMin > 0 ? `, ${extraMin} min longer` : ''}.`" in s
