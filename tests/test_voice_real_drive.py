"""Nate's 11-16 drive review (docs/notes/2026-11-16-voice-on-real-drive.md): plate readers are not spoken, hidden
junctions are thinned and kept off route turns, the far turn rung is dropped with the notes awake, and a route that has
reached its destination never reroutes."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()


def test_plate_readers_silent_speed_cameras_spoken():
    assert "const spokenCamera = (e) => e.kind === 'speed';" in SRC
    assert "e.type === 'alpr' ? spokenCamera(e)" in SRC
    assert "noteworthyInCruise = (e) => e.type === 'alpr'" not in SRC


def test_hidden_junctions_thinned():
    assert "Math.abs(s.m - m) <= 150) || (jSaid[0] === track.id && m - jSaid[1] < 400)" in SRC
    assert "!junctionQuiet(e, steps) && (first" in SRC


def test_brief_turn_calls_when_awake_and_no_reroute_after_arrival():
    assert "{ brief: spirited }" in SRC
    assert "routeWatch.bestM >= track.dist[track.dist.length - 1] - 150)) reroute(track);" in SRC
