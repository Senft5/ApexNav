"""Assemble the review pack from the app-review workflow's per-flow artifacts (.github/workflows/app-review.yml).

  python tools/review_pack.py flows review-pack

flows/flow-<name>/ holds what one job made: phone.mp4 (and car.mp4 for drives), transcript.txt (every line said),
app-log.txt, and shots/ (the test's photos exported from the result bundle, with manifest.json naming each). The pack has
one folder per flow with its steps renamed in order (phone/NN-step.png, car/NN-step.png), a contact sheet of each, the
videos, a clean transcript, and INDEX.md that walks the flows for the reviewer.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys

from PIL import Image, ImageDraw

NAME = re.compile(r"^(phone|car)-([a-z0-9-]+)-(\d\d)-([^_]+?)(?:_\d+_[0-9A-Fa-f-]+)?(?:\.png)?$")


def attachments(shots_dir: str) -> list[tuple[str, str]]:
    """(exported file, attachment name) pairs from xcresulttool's manifest.json."""
    path = os.path.join(shots_dir, "manifest.json")
    if not os.path.exists(path):
        return []
    out: list[tuple[str, str]] = []

    def walk(o):
        if isinstance(o, dict):
            f, n = o.get("exportedFileName"), o.get("suggestedHumanReadableName") or o.get("name")
            if f and n:
                out.append((f, n))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    with open(path, encoding="utf-8") as fh:
        walk(json.load(fh))
    return out


def sheet(files: list[tuple[str, str]], out: str, width: int = 260, cols: int = 5) -> None:
    """A contact sheet: each photo scaled to `width`, labelled with its step."""
    if not files:
        return
    ims = []
    for path, label in files:
        im = Image.open(path).convert("RGB")
        im = im.resize((width, max(1, int(im.height * width / im.width))))
        ims.append((im, label))
    h = max(im.height for im, _ in ims) + 22
    rows = (len(ims) + cols - 1) // cols
    board = Image.new("RGB", (cols * (width + 8) + 8, rows * (h + 8) + 8), "white")
    draw = ImageDraw.Draw(board)
    for k, (im, label) in enumerate(ims):
        x, y = 8 + (k % cols) * (width + 8), 8 + (k // cols) * (h + 8)
        board.paste(im, (x, y + 20))
        draw.text((x, y + 4), label[:44], fill="black")
    board.save(out, optimize=True)


def transcript(path: str) -> list[str]:
    """The lines said, with their time: "12:01:33  Left 3 tightens"."""
    lines = []
    if os.path.exists(path):
        for raw in open(path, encoding="utf-8", errors="replace"):
            m = re.search(r"(\d\d:\d\d:\d\d)\.\d+.*APEX-SAID (.*)$", raw.rstrip())
            if m:
                lines.append(f"{m.group(1)}  {m.group(2)}")
    return lines


def main(src: str, dst: str) -> int:
    os.makedirs(dst, exist_ok=True)
    index = ["# Vetta review recording", "",
             "Each flow below was run on an iPhone 16 Pro simulator (and its CarPlay window for the drives) by "
             "UITests/ReviewFlows. Drives replay a real recorded drive (Dry Ridge Rd, Cincinnati) through the app's own "
             "sensor handlers. Videos have no sound: the transcript lists every line the co-driver said, with its time.", ""]
    for d in sorted(os.listdir(src)) if os.path.isdir(src) else []:
        flow_dir = os.path.join(src, d)
        if not os.path.isdir(flow_dir) or not d.startswith("flow-"):
            continue
        flow = d[len("flow-"):]
        out = os.path.join(dst, flow)
        os.makedirs(out, exist_ok=True)
        steps: dict[str, list[tuple[str, str]]] = {"phone": [], "car": []}
        shots = os.path.join(flow_dir, "shots")
        for f, n in attachments(shots):
            m = NAME.match(os.path.basename(n))
            src_file = os.path.join(shots, f)
            if not m or not os.path.exists(src_file):
                continue
            screen, _, num, step = m.groups()
            os.makedirs(os.path.join(out, screen), exist_ok=True)
            target = os.path.join(out, screen, f"{num}-{step}.png")
            shutil.copyfile(src_file, target)
            steps[screen].append((target, f"{num} {step}"))
        for screen in steps:
            steps[screen].sort()
            sheet(steps[screen], os.path.join(out, f"sheet-{screen}.png"), width=260 if screen == "phone" else 360,
                  cols=6 if screen == "phone" else 3)
        for f in ("phone.mp4", "car.mp4", "app-log.txt"):
            if os.path.exists(os.path.join(flow_dir, f)):
                shutil.copyfile(os.path.join(flow_dir, f), os.path.join(out, f))
        said = transcript(os.path.join(flow_dir, "transcript.txt"))
        with open(os.path.join(out, "transcript.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(said) + ("\n" if said else ""))
        index += [f"## {flow}", "",
                  f"- Steps: {len(steps['phone'])} phone photos" + (f", {len(steps['car'])} car photos" if steps["car"] else ""),
                  f"- Contact sheets: `{flow}/sheet-phone.png`" + (f", `{flow}/sheet-car.png`" if steps["car"] else ""),
                  "- Video: " + ", ".join(f"`{flow}/{v}`" for v in ("phone.mp4", "car.mp4") if os.path.exists(os.path.join(out, v))),
                  f"- Spoken lines: {len(said)} (`{flow}/transcript.txt`)", ""]
        index += ["  " + " · ".join(label.split(" ", 1)[1] for _, label in steps["phone"]), ""] if steps["phone"] else []
        if said:
            index += ["  First lines said:", ""] + [f"  - {l}" for l in said[:12]] + [""]
    with open(os.path.join(dst, "INDEX.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(index) + "\n")
    print(f"review pack: {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "flows", sys.argv[2] if len(sys.argv) > 2 else "review-pack"))
