"""Launch scale (2026-11-15): no Worker query reads a whole growing table.

The schema is built from backend/migrations into a local SQLite, every `prepare(...)` in backend/src is asked for its
plan (EXPLAIN QUERY PLAN, parameters as NULL), and a full scan (SCAN t, or a scan of a whole index) fails the test unless
(file, table) is in ALLOWED below with its reason. A full scan costs rows read on every call (the usage guard's D1 budget,
src/usage.ts) and gets slower as the table grows, which a test database of a few rows never shows.
A query whose text is built from fragments (`${...}` holding SQL) can't be planned here; MIN_PLANNED keeps that share small.
"""
import glob
import os
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIN_PLANNED = 400

# (file, table): why reading the whole table is fine there
ALLOWED = {
    ("auth.ts", "app_auth_codes"): "daily sweep of expired codes; codes live minutes",
    ("auth.ts", "invites"): "counting one member's open invites, a few rows per member; on creating an invite only",
    ("backup.ts", "sqlite_sequence"): "the weekly backup, one row per table",
    ("contribute.ts", "upload_counts"): "daily sweep of old hourly buckets",
    ("cron_runs.ts", "cron_runs"): "two rows",
    ("feedback.ts", "feedback"): "the owner's feedback view, bounded",
    ("photos.ts", "crews"): "deleting a photo clears a crew cover or crest; crews are few",
    ("roadbooks.ts", "roadbook_roads"): "account deletion",
    ("roadbooks.ts", "roadbook_stamps"): "account deletion",
    ("safety.ts", "app_auth_codes"): "account deletion",
    ("safety.ts", "crew_invites"): "account deletion",
    ("safety.ts", "crews"): "account deletion",
    ("safety.ts", "invites"): "account deletion",
    ("social.ts", "grants"): "leaving or being removed from a crew",
    ("social.ts", "segments"): "leaving or being removed from a crew",
    ("social.ts", "shared_routes"): "leaving or being removed from a crew",
    ("social.ts", "segment_shares"): "the owner dissolving a crew (rare; members leaving use the segment index)",
    ("social.ts", "decal_optouts"): "the owner dissolving a crew: the foreign key's cascade; crews are few",
}

PREPARE = re.compile(r"prepare\(\s*(`(?:[^`\\]|\\.)*`|\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*')", re.S)


def schema() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    for f in sorted(glob.glob(str(ROOT / "backend" / "migrations" / "*.sql"))):
        db.executescript(Path(f).read_text())
    return db


def plans():
    db = schema()
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    planned, scans = 0, []
    for f in sorted(glob.glob(str(ROOT / "backend" / "src" / "*.ts"))):
        src = Path(f).read_text()
        for m in PREPARE.finditer(src):
            sql = re.sub(r"\$\{[^}]*\}", "?", m.group(1)[1:-1])
            try:
                rows = db.execute("EXPLAIN QUERY PLAN " + re.sub(r"\?\d*", "NULL", sql)).fetchall()
            except sqlite3.Error:
                continue
            planned += 1
            line = src[: m.start()].count("\n") + 1
            for r in rows:
                d = r[-1]
                if not d.startswith("SCAN ") or "INTEGER PRIMARY KEY" in d or ("USING" in d and "INDEX" not in d):
                    continue
                t = d.split()[1]
                if t in tables:
                    scans.append((os.path.basename(f), line, t, d, " ".join(sql.split())[:160]))
    return planned, scans


def test_no_query_reads_a_whole_growing_table():
    planned, scans = plans()
    assert planned >= MIN_PLANNED, f"only {planned} queries could be planned: the extraction broke"
    bad = [s for s in scans if (s[0], s[2]) not in ALLOWED]
    assert not bad, "full table scans (add an index, or an ALLOWED entry with its reason):\n" + "\n".join(
        f"  {f}:{line} {t}: {d} :: {sql}" for f, line, t, d, sql in bad)


def test_every_allowed_scan_still_happens():
    _, scans = plans()
    seen = {(s[0], s[2]) for s in scans}
    assert not set(ALLOWED) - seen, f"no longer scanned, drop from ALLOWED: {sorted(set(ALLOWED) - seen)}"


def test_the_hot_paths_use_their_indexes():
    db = schema()
    for sql, index in [
        ("SELECT COUNT(*) FROM crew_chat WHERE author = NULL AND created_at > datetime('now', '-1 hour')", "crew_chat_author"),
        ("SELECT COUNT(*) FROM build_chat WHERE author = NULL AND created_at > datetime('now', '-1 hour')", "build_chat_author"),
        ("SELECT COUNT(*) FROM build_replies WHERE author = NULL AND created_at > datetime('now', '-1 hour')", "build_replies_author"),
        ("SELECT name FROM segments WHERE COALESCE(origin_id, id) = NULL ORDER BY created_at LIMIT 1", "segments_canon"),
    ]:
        plan = " ".join(r[-1] for r in db.execute("EXPLAIN QUERY PLAN " + sql))
        assert index in plan, (sql, plan)
