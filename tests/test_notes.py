"""Per-PR note fragments (tools/collect_notes.py, docs/notes/): the format is checked, and folding puts the newest
entries on top of STATE.md and CALL_SHEET.md and deletes the fragments."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import collect_notes as cn  # noqa: E402


def test_the_fragments_in_the_repo_are_well_formed():
    assert cn.collect(check=True) >= 0


def _setup(tmp_path):
    notes = tmp_path / "notes"; notes.mkdir()
    state = tmp_path / "STATE.md"; state.write_text("# STATE\n\n## Session old\n- old\n")
    calls = tmp_path / "CALL_SHEET.md"; calls.write_text("# Call sheet\n\nIntro.\n\n## old call\nOld.\n")
    return notes, {"STATE": state, "CALL SHEET": calls}


def test_folding_puts_the_newest_on_top_and_deletes_the_fragments(tmp_path):
    notes, targets = _setup(tmp_path)
    (notes / "2026-11-11-a.md").write_text("# STATE\n## Session A\n- a\n\n# CALL SHEET\n## call A\nWhy A.\n")
    (notes / "2026-11-12-b.md").write_text("# STATE\n## Session B\n- b\n")
    (notes / "README.md").write_text("kept")
    assert cn.collect(notes, targets) == 2
    s = targets["STATE"].read_text()
    assert s.index("## Session B") < s.index("## Session A") < s.index("## Session old")
    c = targets["CALL SHEET"].read_text()
    assert c.startswith("# Call sheet\n\nIntro.\n\n## call A\nWhy A.\n\n## old call")
    assert [p.name for p in notes.iterdir()] == ["README.md"]


@pytest.mark.parametrize("name,text", [
    ("notes.md", "# STATE\n## S\n"),                       # no date in the name
    ("2026-11-12-x.md", "hello\n# STATE\n## S\n"),          # text before the first section
    ("2026-11-12-x.md", "# STATE\n- no entry heading\n"),
    ("2026-11-12-x.md", "just text\n"),
    ("2026-11-12-x.md", "# STATE\n## S\n# STATE\n## T\n"),
])
def test_a_malformed_fragment_stops_the_run_before_any_write(tmp_path, name, text):
    notes, targets = _setup(tmp_path)
    (notes / "2026-11-11-ok.md").write_text("# STATE\n## Session ok\n")
    (notes / name).write_text(text)
    before = targets["STATE"].read_text()
    with pytest.raises(ValueError):
        cn.collect(notes, targets)
    assert targets["STATE"].read_text() == before and (notes / "2026-11-11-ok.md").exists()
