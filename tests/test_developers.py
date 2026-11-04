"""Developers (backend/src/developers.ts): the server knows the co-developer by the same address fingerprint the feedback run
follows his notes by (tools/crash_logs.py CODEV), and no address is written anywhere in either file."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def test_the_backend_knows_the_co_developer_by_the_feedback_runs_fingerprint():
    codev = re.search(r'^CODEV = "([0-9a-f]{16})"', read("tools/crash_logs.py"), re.M).group(1)
    fps = re.search(r"DEV_FINGERPRINTS = \[([^\]]*)\]", read("backend/src/developers.ts")).group(1)
    assert codev in re.findall(r'"([0-9a-f]{16})"', fps)


def test_no_address_in_the_developer_files():
    for rel in ("backend/src/developers.ts", "tools/crash_logs.py"):
        assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", read(rel)), rel
