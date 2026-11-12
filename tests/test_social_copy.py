"""Nate (2026-11-12): social features should feel as easy as any big social app; walls of text are banned.

Every fixed line of text the social screens set (textContent) stays short: at most MAX characters once the
${...} parts are taken out. A longer one is a paragraph; say it in a few words, or let a key say it."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOCIAL = ["crew_page.js", "crew_events.js", "crew_standings.js", "duels.js", "time_attack.js", "friends_map.js",
          "meets_map.js", "roadbooks.js"]
MAX = 80
LIT = re.compile(r"textContent:\s*(?:'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)")


def fixed(s):
    """The words a reader sees, without the ${...} parts (nested braces allowed) and with \\u escapes as one character."""
    out, depth, i = [], 0, 0
    while i < len(s):
        if s.startswith("${", i):
            depth += 1; i += 2; continue
        if depth:
            depth += s[i] == "{"; depth -= s[i] == "}"; i += 1; continue
        out.append(s[i]); i += 1
    return re.sub(r"\\u[0-9a-fA-F]{4}|\\.", "x", "".join(out))


def test_no_walls_of_text():
    long = []
    for name in SOCIAL:
        src = open(os.path.join(ROOT, "web", name), encoding="utf-8").read()
        for m in LIT.finditer(src):
            words = fixed(m.group(1) if m.group(1) is not None else m.group(2))
            if len(words) > MAX:
                long.append(f"{name}: {len(words)} chars: {words[:90]}")
    assert not long, "say it shorter:\n" + "\n".join(long)


def test_fixed_counts_only_the_words():
    assert fixed("A ${x ? 'b' : `${y}`} c") == "A  c"
    assert fixed("It\\u2019s") == "Itxs"
