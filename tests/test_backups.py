"""Backups (docs/BACKUPS.md): the row-count check used to verify a restore must list every table the migrations create."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_rowcounts_cover_every_table():
    created = set()
    for f in (ROOT / "backend" / "migrations").glob("*.sql"):
        created |= set(re.findall(r"CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)", f.read_text(encoding="utf-8"), re.I))
    counted = set(re.findall(r"COUNT\(\*\) FROM (\w+)\)", (ROOT / "tools" / "d1_rowcounts.sql").read_text(encoding="utf-8")))
    assert created, "no migrations found"
    assert created - counted == set(), "add these tables to tools/d1_rowcounts.sql"
    assert counted - created == {"d1_migrations"}, "tools/d1_rowcounts.sql counts a table no migration creates"
