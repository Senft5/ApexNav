"""Pace notes are due at a corner's entry, not its apex (owner report 2026-10-28): the countdown, the spoken call, its
lead distance, staleness and the quiet-window checks all measure to `noteM(e)` (start_m, or dist_m for point hazards)."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
NOTES = HTML[HTML.index("function updateNotes("):HTML.index("// 7. RENDER LOOP")]


def test_note_position_is_the_entry():
    assert "const noteM = (e) => (Number.isFinite(e.start_m) && e.start_m <= e.dist_m ? e.start_m : e.dist_m);" in HTML


def test_every_timing_in_update_notes_uses_the_entry():
    # dist_m may still decide when a note is gone (after its apex) and place hazard memory; nothing else.
    leftovers = [m.group(0) for m in re.finditer(r"e\.dist_m - state\.cursorM", NOTES)]
    assert leftovers == ["e.dist_m - state.cursorM"]          # only calledBumps (a point hazard: entry == apex)
    for needle in ["const d = noteM(e) - state.cursorM;", "distLabel(Math.max(0, noteM(e) - state.cursorM))", "atM: noteM(e)",
                   ".sort((a, b) => noteM(a) - noteM(b))", "noteM(e) - state.cursorM < reach", "noteM(e) - state.cursorM < breakReach"]:
        assert needle in NOTES, needle


def test_route_and_recorded_corners_carry_an_entry():
    core = open(os.path.join(ROOT, "web", "apex_core.js"), encoding="utf-8").read()
    assert "start_m: dist[c.start]" in core and "start_m: dist[c.start]" in HTML
