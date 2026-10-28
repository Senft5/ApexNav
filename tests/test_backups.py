"""Backups (docs/BACKUPS.md): the row-count check used to verify a restore must list every table the migrations create."""
import glob
import re


def test_rowcounts_cover_every_table():
    created = set()
    for f in glob.glob("backend/migrations/*.sql"):
        created |= set(re.findall(r"CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)", open(f).read(), re.I))
    counted = set(re.findall(r"COUNT\(\*\) FROM (\w+)\)", open("tools/d1_rowcounts.sql").read()))
    assert created, "no migrations found"
    assert created - counted == set(), "add these tables to tools/d1_rowcounts.sql"
    assert counted - created == set(), "tools/d1_rowcounts.sql counts a table no migration creates"
