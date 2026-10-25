"""Write docs/VOICE_SCRIPT.md: what to read aloud to give the app a real recording of your voice.

Part A is a clean reference passage (what a voice clone learns from). Part B is the call sheet:
the exact calls the app speaks on the shipped drives, plus the common building blocks, each as
one line to read in the real delivery. Lines come from the same lists tools/voicebank.py renders,
so a recording of the sheet can replace the cloned clips one-for-one.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voicebank as vb  # noqa: E402

OUT = os.path.join(vb.ROOT, "docs", "VOICE_SCRIPT.md")

REFERENCE = """\
Okay, stage mode, full notes. Right three long, into left four minus, care. Hold it, hold it, now \
open the wheel. Crest, then left hairpin, double caution, two hundred and fifty to the next. \
Square right, tightens, caution. Bump! Easy. Left five, opens, and right two over crest. \
Flat out for three hundred, then it all closes up again. Good. That's the section. Reset, breathe, \
and here comes another one: right four plus, long, into square left. Care.\
"""


def main() -> int:
    v = vb.codriver_vocabulary()
    calls = vb.route_phrases()
    call_lines = [vb.phrase_text(c, v) for c in calls]
    heads = [vb.phrase_text([t], v) for t in v if t.startswith("head:")]
    mods = [vb.phrase_text([t], v) for t in v if t.startswith("mod:")]
    extras = [vb.phrase_text([t], v) for t in v if t.startswith(("caution:", "hazard:"))]
    dists = [vb.phrase_text([t], v) for t in v if t.startswith("dist:")]
    system = [vb.phrase_text([t], v) for t in v if t.startswith("sys:")]
    links = ["Into.", "And."]

    out = ["# ApexNav voice script", "",
           "Read this in your normal voice as if you were navigating a friend down a fast road: "
           "calm, quick, a little urgent. Not an announcer voice.", "",
           "## Before you start", "",
           "- Quiet room, soft furnishings (a closet full of clothes is perfect). Fans, fridge and car noise off.",
           "- Phone 15–20 cm from your mouth, a bit to the side so breaths do not pop. Voice Memos is fine.",
           "- Same distance, same energy for the whole session. Take a sip of water first.",
           "- Leave about one second of silence between lines. If you fumble, stop, wait a beat, and read the "
           "line again; I will keep the best take.",
           "- Do not whisper or shout. Say each line the way you would say it mid-corner.", "",
           "## Part A: reference passage (about 25 s). Record this first, in one go, twice.", "", f"> {REFERENCE}", "",
           "## Part B: the call sheet. One recording, top to bottom.", "",
           f"Part B1 is the {len(call_lines)} calls the app speaks on your two shipped drives, word for word. "
           "Read commas as a small breath, not a stop.", ""]
    n = 1
    def block(title, lines):
        nonlocal n
        out.append(f"### {title}")
        out.append("")
        for line in lines:
            out.append(f"{n}. {line}")
            n += 1
        out.append("")
    block("B1. Real calls", call_lines)
    block("B2. Corner calls (every head)", heads)
    block("B3. Modifiers", [m[0].upper() + m[1:] for m in mods])
    block("B4. Warnings and hazards", extras)
    block("B5. Distances", dists)
    block("B6. Links", links)
    block("B7. System lines", system)
    out += ["## When you are done", "",
            "Send the recording(s) back (Part A and Part B, any format). I will split Part B by silence, "
            "check every line with speech recognition, and use your real takes wherever they exist. "
            "Anything you did not read is filled in by the voice clone, now built from your clean Part A.", ""]
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print(f"wrote {OUT}: {n - 1} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
