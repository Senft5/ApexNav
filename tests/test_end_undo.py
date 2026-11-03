"""I-3 (panel round 1): End can't be a mis-tap. End sat 6 pt from Report and ended the drive at once; now it says so in the
status row and its key is Undo for a few seconds while the drive goes on, on the phone and from the car's End. The
behaviour itself is driven in e2e/smoke.js ("drive ended: Open in the Log ..." and the CarPlay flow)."""
import os
import re

from tests.page_source import cockpit_source

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = cockpit_source()
SWIFT = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()


def _fn(src, name):
    i = src.index(f"function {name}(")
    j = src.index("\n    }\n", i)
    return src[i:j]


def test_end_waits_for_the_undo_window():
    assert "$('driveEnd').addEventListener('click', askEnd);" in PAGE
    assert "$('driveEnd').addEventListener('click', () => leaveDrive(true));" not in PAGE, "End no longer ends at once"
    m = re.search(r"const END_UNDO_MS = (\d+);", PAGE)
    assert m and 1500 <= int(m.group(1)) <= 2000, "the owner, 2026-11-03: a third of the 5 s it was (long enough to tap Undo)"
    ask = _fn(PAGE, "askEnd")
    assert "setTimeout(commitEnd, END_UNDO_MS)" in ask
    assert "leaveDrive(" not in ask.replace("if (!driveActive) { leaveDrive(true); return; }", ""), "only a drive not yet live ends at once"
    assert "driveNote(" in ask, "the status row says the drive ended"
    assert "haptic(" in ask, "a mis-tap is felt"
    assert "carPost({ kind: 'ending'" in ask, "the car is told, for its own Undo"
    assert "if (pendingEnd) { undoEnd(); return; }" in ask, "the same key again is Undo"
    # no dialog while moving
    assert "confirm(" not in ask and "showModal" not in ask


def test_undo_resumes_and_a_lapse_saves():
    undo = _fn(PAGE, "undoEnd")
    assert "clearTimeout(pendingEnd.timer)" in undo and "leaveDrive" not in undo and "carPost({ kind: 'resumed' })" in undo
    commit = _fn(PAGE, "commitEnd")
    assert "leaveDrive(true)" in commit, "not undone, the drive is saved"
    assert "drive.rec.truncate(p.rows)" in commit, "as it stood at End"
    paint = _fn(PAGE, "paintEndUndo")
    assert "on ? 'Undo' : 'End'" in paint and "'End drive'" in paint, "the UI tests still find End drive by its label"
    # any other way out (Siri's go=end, the parked end, the car's End again) ends now and clears the window
    leave = PAGE[PAGE.index("async function leaveDrive(save, ended) {"):]
    assert leave.split("\n")[1].strip().startswith("if (pendingEnd) { clearTimeout(pendingEnd.timer); pendingEnd = null; paintEndUndo(); }")


def test_the_cars_end_has_the_window_too():
    assert "else if (m.action === 'end' && driveActive) { if (pendingEnd) commitEnd(); else askEnd(); }" in PAGE
    assert "else if (m.action === 'undo') undoEnd();" in PAGE
    assert 'case "ending":' in SWIFT and 'case "resumed":' in SWIFT
    show = SWIFT[SWIFT.index("@MainActor func showEnding(seconds: Double)"):SWIFT.index("@MainActor func endingUndone()")]
    assert 'CPAlertAction(title: "Undo", style: .default) { _ in ApexCar.shared.send("undo") }' in show
    assert "secondaryAction: nil" in show, "one action"
    assert "map.present(navigationAlert: alert, animated: true)" in show
    undone = SWIFT[SWIFT.index("@MainActor func endingUndone()"):]
    undone = undone[:undone.index("\n    }\n")]
    assert "map.dismissNavigationAlert(animated: true)" in undone
    # the bar's End still only asks the page; the page's `end` is what ends the session
    assert 'CPBarButton(title: "End") { _ in ApexCar.shared.send("end") }' in SWIFT


def test_end_stands_off_from_report_and_shows_its_undo():
    assert "#driveEnd { margin-left: 8px; }" in PAGE, "16 pt from Report with the bar's 8 px gap"
    assert "#app #driveEnd.undo {" in PAGE and "@keyframes end-undo" in PAGE
