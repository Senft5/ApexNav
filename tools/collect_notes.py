#!/usr/bin/env python3
"""Fold the per-PR note fragments (docs/notes/*.md) into docs/STATE.md and docs/CALL_SHEET.md.

Why: every PR used to edit the top of STATE.md and CALL_SHEET.md, so parallel threads conflicted on every merge and
lost green CI. A PR now adds its own new file instead, which never conflicts:

    docs/notes/2026-11-12-cron-monitoring.md      (date first, then a short slug; any name that sorts by date)

    # STATE
    ## Session 2026-11-12 (cron monitoring): ... (branch)
    - what was done, what is broken, the exact next task

    # CALL SHEET
    ## 2026-11-12 (cron monitoring): what was decided (branch)
    Why, and how to undo.

Either section may be left out. Readers read docs/notes/ as the newest part of both files (CLAUDE.md section 4).
Now and then one small PR runs this script: each section goes on top of its file (the newest fragment ends up first),
and the fragments are deleted. Standard library only.

    python tools/collect_notes.py            # fold and delete
    python tools/collect_notes.py --check    # only validate the fragments (tests/test_notes.py runs this)
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOTES = ROOT / "docs" / "notes"
TARGETS = {"STATE": ROOT / "docs" / "STATE.md", "CALL SHEET": ROOT / "docs" / "CALL_SHEET.md"}
NAME = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$")
SECTION = re.compile(r"^# (STATE|CALL SHEET)\s*$", re.M)


def fragments(notes=NOTES):
    return sorted(p for p in notes.glob("*.md") if p.name != "README.md")


def parse(path):
    """{"STATE": text, "CALL SHEET": text} for one fragment. Raises ValueError on a malformed one."""
    if not NAME.match(path.name):
        raise ValueError(f"{path.name}: name it YYYY-MM-DD-slug.md (lower case)")
    text = path.read_text(encoding="utf-8")
    parts = SECTION.split(text)
    if parts[0].strip():
        raise ValueError(f"{path.name}: text before the first '# STATE' or '# CALL SHEET' heading")
    out = {}
    for head, body in zip(parts[1::2], parts[2::2]):
        if head in out:
            raise ValueError(f"{path.name}: '# {head}' twice")
        body = body.strip("\n")
        if not body.startswith("## "):
            raise ValueError(f"{path.name}: '# {head}' must start with a '## ' entry heading")
        out[head] = body
    if not out:
        raise ValueError(f"{path.name}: no '# STATE' or '# CALL SHEET' section")
    return out


def insert_top(doc, entries):
    """doc with entries (newest first) placed before its first '## ' heading."""
    i = doc.find("\n## ")
    i = len(doc) if i < 0 else i + 1
    block = "".join(e.rstrip("\n") + "\n\n" for e in entries)
    return doc[:i] + block + doc[i:]


def collect(notes=NOTES, targets=TARGETS, check=False):
    """Validates every fragment; unless check, folds them in and deletes them. Returns the fragment count."""
    frags = fragments(notes)
    parsed = [(p, parse(p)) for p in frags]          # all or nothing: one bad fragment stops the run before any write
    if check or not parsed:
        return len(parsed)
    newest_first = list(reversed(parsed))
    for head, target in targets.items():
        entries = [d[head] for _, d in newest_first if head in d]
        if entries:
            target.write_text(insert_top(target.read_text(encoding="utf-8"), entries), encoding="utf-8")
    for p, _ in parsed:
        p.unlink()
    return len(parsed)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="validate only")
    a = ap.parse_args(argv)
    try:
        n = collect(check=a.check)
    except ValueError as e:
        print(f"docs/notes: {e}", file=sys.stderr)
        return 1
    print(f"{n} note fragment(s) {'valid' if a.check else 'folded into STATE.md and CALL_SHEET.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
