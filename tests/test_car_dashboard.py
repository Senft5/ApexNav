"""The CarPlay Dashboard (the owner, 2026-11-01): Vetta's map in the Dashboard's map box, the guidance card from the
navigation session (short form first), and shortcut buttons when not navigating that open the main car screen."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
PROJECT = open(os.path.join(ROOT, "project.yml"), encoding="utf-8").read()


def test_dashboard_scene_is_declared():
    assert "CPSupportsDashboardNavigationScene: true" in PROJECT
    assert "ApexCarDashboardSceneDelegate" in PROJECT


def test_dashboard_has_shortcut_buttons_that_open_the_car_screen():
    assert "dashboardController.shortcutButtons" in SRC
    assert SRC.count("CPDashboardButton(") >= 1
    assert re.search(r"scene\?\.open\(url", SRC)
    for path in ("apexnav://car/where", "apexnav://car/loops"):
        assert path in SRC


def test_main_car_scene_handles_only_the_two_dashboard_links():
    assert "func scene(_ scene: UIScene, openURLContexts" in SRC
    assert 'url.host() == "car"' in SRC
    assert 'case "/where": return .whereTo' in SRC and 'case "/loops": return .loops' in SRC
    assert "default: return nil" in SRC


def test_dashboard_card_gets_the_short_instruction():
    assert "m.dashboardInstructionVariants" in SRC
