"""The CarPlay Dashboard (the owner, 2026-11-01): Vetta's map in the Dashboard's map box, the guidance card from the
navigation session (short form first), and shortcut buttons when not navigating that open the main car screen."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
PROJECT = open(os.path.join(ROOT, "project.yml"), encoding="utf-8").read()


def test_dashboard_scene_is_declared_inside_the_scene_manifest():
    # Apple reads CPSupportsDashboardNavigationScene (and the cluster's key) inside UIApplicationSceneManifest; at the
    # Info.plist's top level the car never offered Vetta on the Dashboard (the owner, 2026-11-01)
    lines = PROJECT.splitlines()
    m = next(i for i, l in enumerate(lines) if l.strip() == "UIApplicationSceneManifest:")
    indent = len(lines[m]) - len(lines[m].lstrip())
    block = []
    for l in lines[m + 1:]:
        if l.strip() and not l.strip().startswith("#") and len(l) - len(l.lstrip()) <= indent:
            break
        block.append(l.strip())
    assert "CPSupportsDashboardNavigationScene: true" in block
    assert "CPSupportsInstrumentClusterNavigationScene: true" in block
    assert PROJECT.count("CPSupportsDashboardNavigationScene") == 1
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
    """T-1/I-4: the Dashboard's card takes the longest variant that fits too, so it gets the same glance forms as the main
    card (each at most glanceMax), never the whole call."""
    changed = SRC[SRC.index("@MainActor func guideChanged()"):SRC.index("@MainActor func driveEnded()")]
    assert "m.dashboardInstructionVariants = variants" in changed
    assert "dashboardInstructionVariants = g.short.isEmpty ? variants" not in changed
    assert "+ variants" not in changed, "nothing longer is appended after the glance forms"
    built = changed[:changed.index("m.instructionVariants = variants")]
    assert "v.count <= ApexCar.glanceMax" in built
