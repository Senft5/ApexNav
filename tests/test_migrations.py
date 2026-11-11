"""Migration numbering (IDEAS Y-08, the repo half of the drift check). Several threads add D1 migrations at once, and
each is applied by hand to both databases under its file name (d1_migrations), so two files sharing a number, a gap,
or a migration the backend tests never load all reach production unnoticed. After merging origin/main, a clash means
renumber yours to the next free number (and its d1_migrations row, if already applied to preview)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "backend" / "migrations"
HELPERS = ROOT / "backend" / "test" / "helpers.ts"
NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")


def files():
    return sorted(p.name for p in MIG.glob("*.sql"))


def test_every_migration_is_named_nnnn_words():
    bad = [f for f in files() if not NAME.match(f)]
    assert not bad, f"migration names must be NNNN_lower_words.sql: {bad}"


def test_numbers_are_unique_and_contiguous():
    nums = [int(NAME.match(f).group(1)) for f in files() if NAME.match(f)]
    dup = sorted({n for n in nums if nums.count(n) > 1})
    assert not dup, f"two migrations share a number {dup}: another thread took it; renumber yours to {max(nums) + 1:04d}"
    assert nums == list(range(1, len(nums) + 1)), f"gap in migration numbers: {sorted(set(range(1, max(nums) + 1)) - set(nums))}"


def test_the_backend_tests_load_every_migration_in_order():
    """backend/test/helpers.ts imports each file by hand and applies them in one batch: one left out means the Worker's
    tests run against a schema production doesn't have."""
    src = HELPERS.read_text()
    imported = re.findall(r'import (m\d+) from "\.\./migrations/([^"?]+)\?raw"', src)
    names = [f for _, f in imported]
    assert names == files(), f"helpers.ts imports {set(files()) ^ set(names) or 'them out of order'}"
    batch = re.findall(r"splitSql\((m\d+)\)", src)
    assert batch == [v for v, _ in imported], "helpers.ts applies the migrations out of order or misses one"
