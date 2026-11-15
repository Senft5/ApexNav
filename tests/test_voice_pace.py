"""Every voice pack speaks at one pace (the owner 2026-11-15: "rushed sometimes or too sluggish sometimes").

tools/voice_pace.py measures each clip's speaking rate (phonemes a second of voice) and brings it to its pack's target,
and writes the rate into the manifest as "pace" (null for a clip too short to measure). voicebank.py paces every new clip
the same way. These checks hold the packs to it without the audio tools: every clip has been through the pass, nearly all
sit in the band, and hardly any is far out of it (a clip Whisper only hears right at its own pace keeps it: being understood
comes first, tools/voice_pace.py paced_and_heard).
"""
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import voice_pace  # noqa: E402

PACKS = sorted(voice_pace.TARGETS)


def manifest(voice):
    with open(os.path.join(ROOT, "web", "voices", voice, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)["tokens"]


@pytest.mark.parametrize("voice", PACKS)
def test_every_clip_has_been_paced(voice):
    unpaced = [k for k, e in manifest(voice).items() if "pace" not in e]
    assert unpaced == [], f"{len(unpaced)} clips never went through tools/voice_pace.py: {unpaced[:10]}"


@pytest.mark.parametrize("voice", PACKS)
def test_the_pack_speaks_at_one_pace(voice):
    target = voice_pace.TARGETS[voice]
    rates = {k: e["pace"] for k, e in manifest(voice).items() if e.get("pace")}
    assert len(rates) > 500
    inside = [k for k, r in rates.items() if abs(r / target - 1) <= voice_pace.BAND + 0.02]
    assert len(inside) / len(rates) >= 0.9, f"only {len(inside)} of {len(rates)} clips near {target} phonemes a second"
    lo, hi = target * 0.72, target * 1.3
    far = sorted((r, k) for k, r in rates.items() if not lo <= r <= hi)
    assert len(far) <= len(rates) // 100, f"{len(far)} clips far off the pack's pace: {far[:10]}"


def test_the_packs_are_near_one_another():
    """Switching voice changes the voice, not how fast the co-driver talks."""
    t = voice_pace.TARGETS
    assert max(t.values()) / min(t.values()) <= 1.25
