"""Push notifications, the shell's side (ApexPush.swift, docs/SOCIAL.md 2.12): the file is built, the entitlement is
there, a push's tap link survives the link filter, and iOS is asked only from the page's switch."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_push_file_is_built_and_entitled():
    yml = (ROOT / "project.yml").read_text()
    assert "- path: ApexPush.swift" in yml
    assert re.search(r"aps-environment: (development|production)", yml)


def test_a_push_tap_link_keeps_its_keys():
    app = (ROOT / "ApexNavApp.swift").read_text()
    keys = re.search(r"static let linkKeys: Set<String> = \[([^\]]*)\]", app).group(1)
    for k in ("view", "friend", "post"):
        assert f'"{k}"' in keys, k
    assert "UIApplicationDelegateAdaptor(ApexAppDelegate.self)" in app
    assert 'cmd == "push"' in app


def test_permission_only_at_the_switch():
    push = (ROOT / "ApexPush.swift").read_text()
    # requestAuthorization appears once, under op "allow"
    assert push.count("requestAuthorization") == 1
    allow = push.index('case "allow"')
    assert allow < push.index("requestAuthorization") < push.index('case "token"')
    # the server's links use only keys the shell keeps
    srv = (ROOT / "backend/src/push.ts").read_text()
    used = set(re.findall(r"[?&]([a-z]+)=", srv))
    app = (ROOT / "ApexNavApp.swift").read_text()
    keys = set(re.findall(r'"([a-z]+)"', re.search(r"static let linkKeys: Set<String> = \[([^\]]*)\]", app).group(1)))
    assert used and used <= keys, used - keys
