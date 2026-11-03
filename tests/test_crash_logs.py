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
