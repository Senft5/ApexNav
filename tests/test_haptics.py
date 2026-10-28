"""Haptics on notes and hazards (IDEAS U-09): the page asks the shell for a tap as a call starts; the shell plays it."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()


def test_wired():
    html, swift = read("web", "index.html"), read("ApexNavApp.swift")
    assert "haptic(item.kind === 'hazard' ? 'hazard' : 'note')" in html            # as each call starts
    assert "native.postMessage({ cmd: 'haptic', kind })" in html
    assert 'data-toggle="haptics"' in html and "haptics: true }" in html          # on by default, a switch to turn it off
    assert 'if cmd == "haptic"' in swift and "UINotificationFeedbackGenerator().notificationOccurred(.warning)" in swift
    assert "UIImpactFeedbackGenerator(style: .light).impactOccurred()" in swift
