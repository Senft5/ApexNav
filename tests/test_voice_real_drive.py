"""Nate's 11-16 drive review (docs/notes/2026-11-16-voice-on-real-drive.md): plate readers are not spoken, hidden
junctions are thinned and kept off route turns, the far turn rung is dropped with the notes awake, and a route that has
reached its destination never reroutes."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()


def test_plate_readers_silent_speed_cameras_spoken():
    assert "const spokenCamera = (e) => e.type === 'alpr' && e.kind === 'speed';" in SRC
    assert "e.type === 'alpr' ? spokenCamera(e)" in SRC
    assert "noteworthyInCruise = (e) => e.type === 'alpr'" not in SRC


def test_hidden_junctions_thinned():
    assert "JUNCTION_GAP_M = 400, JUNCTION_TURN_M = 150" in SRC
    assert "junctionQuiet(e, steps) ? false" in SRC


def test_brief_turn_calls_when_awake_and_no_reroute_after_arrival():
    assert "{ brief: spirited }" in SRC
    assert "if (r.request && !arrived) reroute(track);" in SRC
