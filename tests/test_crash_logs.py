"""tools/crash_logs.py: whose TestFlight notes are followed. Only the owner's and his co-developer's (2026-11-03);
any other tester's are counted, never printed or acted on. Addresses are matched by fingerprint, never stored."""
import hashlib
import importlib.util
import pathlib
import sys
import types

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load():
    sys.modules.setdefault("jwt", types.ModuleType("jwt"))   # the fetch needs PyJWT; the matching does not
    spec = importlib.util.spec_from_file_location("crash_logs", ROOT / "tools" / "crash_logs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_who_is_followed():
    m = load()
    fp = lambda e: hashlib.sha256(e.encode()).hexdigest()[:16]
    assert m.CODEV == fp("jalen.ranford@gmail.com")
    assert m.who({"email": " Jalen.Ranford@gmail.com "}) == "co-developer"
    assert m.who({"email": "someone.else@example.com"}) is None
    assert m.who({}) is None
    assert m.OWNER != m.CODEV


def test_no_address_in_the_tool():
    text = (ROOT / "tools" / "crash_logs.py").read_text(encoding="utf-8")
    assert "@gmail.com" not in text and "@icloud.com" not in text


def test_build_text():
    m = load()
    assert m.build_text("1.4", "212") == "build 1.4 (212)"
    assert m.build_text(None, 212) == "build ? (212)"
    assert m.build_text("1.4", "") == "build 1.4 (?)"
    assert m.build_text(None, None) == "build unknown"


def test_each_note_names_its_build():
    """The build relationship (include=build) gives the build number; its preReleaseVersion the app version, asked once."""
    m = load()
    asked = []

    def fake_get(path, tok):
        asked.append(path)
        return {"data": {"type": "preReleaseVersions", "id": "v1", "attributes": {"version": "1.4"}}}

    m.get = fake_get
    included = [{"type": "builds", "id": "b9", "attributes": {"version": "212"}}]
    sub = {"attributes": {}, "relationships": {"build": {"data": {"type": "builds", "id": "b9"}}}}
    cache = {}
    assert m.build_of(sub, included, "t", cache) == "build 1.4 (212)"
    assert m.build_of(sub, included, "t", cache) == "build 1.4 (212)"
    assert asked == ["/builds/b9/preReleaseVersion?fields[preReleaseVersions]=version"]

    def down(path, tok):
        raise OSError("offline")

    m.get = down
    assert m.build_of(sub, included, "t", {}) == "build ? (212)"          # the number alone still says which upload
    assert m.build_of({"attributes": {"appBuild": "77"}}, [], "t", {}) == "build ? (77)"
    assert m.build_of({"attributes": {}}, [], "t", {}) == "build unknown"


def test_the_requests_include_the_build():
    text = (ROOT / "tools" / "crash_logs.py").read_text(encoding="utf-8")
    assert "betaFeedbackScreenshotSubmissions?limit=20&sort=-createdDate&include=build" in text
    assert "betaFeedbackCrashSubmissions?limit=5&sort=-createdDate&include=build" in text
