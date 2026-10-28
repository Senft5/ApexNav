"""The App Store listing draft (docs/LISTING.md, IDEAS O-09) fits Apple's field limits and never sells speed (guideline 1.4,
IDEAS guardrails) or features the build doesn't have (2.3.1)."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXT = open(os.path.join(ROOT, "docs", "LISTING.md"), encoding="utf-8").read()
LIMITS = {"Name": 30, "Subtitle": 30, "Promotional text": 170, "Keywords": 100, "Description": 4000}


def field(name):
    m = re.search(rf"^## {re.escape(name)}[^\n]*\n\n(.*?)(?=\n## |\Z)", TEXT, re.S | re.M)
    assert m, name
    return m.group(1).strip()


def test_fields_fit_apples_limits():
    for name, limit in LIMITS.items():
        assert 0 < len(field(name)) <= limit, (name, len(field(name)))
    assert " ," not in field("Keywords") and ", " not in field("Keywords")      # spaces after commas waste characters


def test_no_speed_selling_or_missing_features():
    copy = " ".join(field(n) for n in LIMITS).lower()
    for banned in ("fastest", "top speed", "race ", "racing", "lap time", "beat your time", "carplay", "android"):
        assert banned not in copy, banned
