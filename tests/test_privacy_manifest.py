"""Apple's privacy manifest (PrivacyInfo.xcprivacy): it ships in the app, says no tracking, declares a reason for every
required-reason API the app's own Swift calls, and lists what the App Privacy answers in docs/LISTING.md say is collected."""
import plistlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = plistlib.loads((ROOT / "PrivacyInfo.xcprivacy").read_bytes())

# Apple's required-reason API categories, the Swift that reaches them, and the reasons that fit this app
CATEGORIES = {
    "NSPrivacyAccessedAPICategoryUserDefaults": (r"\bUserDefaults\b", {"CA92.1"}),
    "NSPrivacyAccessedAPICategorySystemBootTime": (r"\bsystemUptime\b|\bmach_absolute_time\b|\bCACurrentMediaTime\b", {"35F9.1"}),
    "NSPrivacyAccessedAPICategoryFileTimestamp": (r"\bcreationDate\b|\bmodificationDate\b|contentModificationDate|attributesOfItem|\bstat\(", None),
    "NSPrivacyAccessedAPICategoryDiskSpace": (r"volumeAvailableCapacity|systemFreeSize|systemSize\b|\bstatfs\b", None),
    "NSPrivacyAccessedAPICategoryActiveKeyboards": (r"activeInputModes", None),
}


def app_swift():
    """The Swift that ships in the app and its extension (not tests, not the UI tests)."""
    for p in ROOT.rglob("*.swift"):
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(("UITests/", "ApexKit/Tests/", "node_modules/", ".build/")) or "/.build/" in rel:
            continue
        yield rel, p.read_text(encoding="utf-8", errors="replace")


def declared():
    return {a["NSPrivacyAccessedAPIType"]: set(a["NSPrivacyAccessedAPITypeReasons"]) for a in MANIFEST["NSPrivacyAccessedAPITypes"]}


def test_no_tracking():
    assert MANIFEST["NSPrivacyTracking"] is False
    assert MANIFEST.get("NSPrivacyTrackingDomains", []) == []
    assert all(t["NSPrivacyCollectedDataTypeTracking"] is False for t in MANIFEST["NSPrivacyCollectedDataTypes"])


def test_every_required_reason_api_used_is_declared():
    have = declared()
    for cat, (pattern, reasons) in CATEGORIES.items():
        users = [rel for rel, src in app_swift() if re.search(pattern, src)]
        if users:
            assert cat in have, f"{cat} is used by {users} but not declared in PrivacyInfo.xcprivacy"
            if reasons:
                assert have[cat] & reasons, f"{cat}: reasons {have[cat]} should include one of {reasons}"


def test_declared_categories_are_used():
    """A category declared but never used is a stale claim: drop it when the code stops calling it."""
    swift = "\n".join(src for _, src in app_swift())
    for cat in declared():
        assert re.search(CATEGORIES[cat][0], swift), f"{cat} is declared but no app Swift uses it"


def test_collected_types_match_the_app_privacy_answers():
    listing = (ROOT / "docs" / "LISTING.md").read_text(encoding="utf-8")
    rows = {m.group(1).strip(): m.group(2).strip() for m in re.finditer(r"^\| ([^|]+) \| ([^|]*) \|", listing, re.M)}
    keys = {t["NSPrivacyCollectedDataType"].removeprefix("NSPrivacyCollectedDataType") for t in MANIFEST["NSPrivacyCollectedDataTypes"]}
    label = {"Precise location": "PreciseLocation", "Coarse location": "CoarseLocation", "Name": "Name", "Email address": "EmailAddress",
             "User ID": "UserID", "Other user content": "OtherUserContent", "Photos or videos": "PhotosorVideos", "Crash data": "CrashData",
             "Other diagnostic data": "OtherDiagnosticData", "Customer support": "CustomerSupport", "Contacts": "Contacts"}
    for name, key in label.items():
        assert name in rows, f"docs/LISTING.md has no App Privacy row for {name}"
        collected = rows[name].startswith("Yes")
        assert (key in keys) == collected, f"{name}: LISTING.md says {'collected' if collected else 'not collected'}, the manifest {'lists' if key in keys else 'omits'} it"


def test_the_app_target_ships_it():
    yml = (ROOT / "project.yml").read_text(encoding="utf-8")
    app = yml.split("\n  ApexNavLive:")[0]
    assert re.search(r"- path: PrivacyInfo\.xcprivacy\n\s+buildPhase: resources", app)
