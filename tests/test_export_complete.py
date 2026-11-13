"""Download my data (GET /api/me/export, backend/src/account.ts exportMyData) names every table that holds a person's data.

A new table with a column pointing at a user must be added to the export, or to TECHNICAL below with the reason."""
import glob
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REF_COLS = {"user_id", "owner", "author", "author_id", "reported_by", "created_by", "holder", "reporter", "requested_by",
            "user_a", "user_b", "blocker", "giver_id", "owner_id", "used_by"}
# tables that hold an account id but nothing the person made or chose: sign-in plumbing, counters, short-lived queues
TECHNICAL = {
    "sessions": "sign-in sessions (hashes only)",
    "app_auth_codes": "a one-minute sign-in code",
    "upload_counts": "hourly upload caps",
    "ingest_pending": "road data waiting to be merged (anonymous once merged)",
    "rank_slots": "leaderboard slots, rebuilt from the boards",
    "road_hour_holders": "who first measured a road this hour (pioneer counting)",
    "road_floor": "keyed hashes of the first two established drivers of a road (the privacy floor); no id, unreadable without the server pepper",
}


def schema():
    db = sqlite3.connect(":memory:")
    for f in sorted(glob.glob(str(ROOT / "backend/migrations/*.sql"))):
        try:
            db.executescript(Path(f).read_text())
        except sqlite3.Error:
            pass
    return db


def test_every_table_with_a_person_is_exported_or_explained():
    db, src = schema(), (ROOT / "backend/src/account.ts").read_text()
    exp = src[src.index("export async function exportMyData"):src.index("export async function deleteAccount")]
    missing = []
    for (t,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations'"):
        cols = {r[1] for r in db.execute(f'PRAGMA table_info("{t}")')}
        fks = {r[3] for r in db.execute(f'PRAGMA foreign_key_list("{t}")') if r[2] == "users"}
        if (fks | (cols & REF_COLS)) and t not in TECHNICAL and t != "users" and not re.search(rf"\b{re.escape(t)}\b", exp):
            missing.append(t)
    assert missing == [], f"add these to exportMyData (or TECHNICAL with why): {missing}"


def test_recent_positions_and_kudos_are_in_it():
    src = (ROOT / "backend/src/account.ts").read_text()
    assert "sharing_on_map_positions" in src and "kudos_given" in src and "kudos_received" in src


def test_export_stays_inside_the_query_limit():
    """Workers Free allows 50 D1 queries per invocation; a batch counts as one. The lists go out in one batch, so the export
    makes a handful of queries however many tables it names (it failed once it passed 50 single queries)."""
    src = (ROOT / "backend/src/account.ts").read_text()
    exp = src[src.index("export async function exportMyData"):src.index("export async function deleteAccount")]
    assert "await q(" not in exp and "env.DB.batch(stmts)" in exp
    assert exp.count("await ") <= 5, "keep single awaited queries out of the export: add them to the batch with q()"
