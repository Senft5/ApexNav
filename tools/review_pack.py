"""Assemble the review pack from the app-review workflow's per-flow artifacts (.github/workflows/app-review.yml).

  python tools/review_pack.py flows review-pack

flows/flow-<name>/ holds what one job made: phone.mp4 (and car.mp4 for drives), transcript.txt (every line said),
app-log.txt, and shots/ (the test's photos exported from the result bundle, with manifest.json naming each). The pack has
one folder per flow with its steps renamed in order (phone/NN-step.png, car/NN-step.png), a contact sheet of each, the
videos, a clean transcript, and INDEX.md that walks the flows for the reviewer.

REVIEW4 §6: a phone photo taken on its side (a step named "landscape") is turned upright, and phone-start.txt /
car-start.txt (the wall-clock second each video started, written by the workflow) put the video second beside every
transcript line, so a line said maps to a frame.
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


def upright(path: str, step: str) -> None:
    """A phone photo taken on its side is saved in the phone's portrait pixels with the picture turned a quarter: turn it
    back so the contact sheet reads (REVIEW4 §6.6). The flows turn the phone to landscapeLeft (the top of the picture is
    the right edge of the pixels), so a quarter turn anticlockwise."""
    if "landscape" not in step:
        return
    im = Image.open(path)
    if im.height > im.width:
        im.rotate(90, expand=True).save(path)


def clock(t: str) -> int | None:
    """"HH:MM:SS" as seconds of the day, or None."""
    m = re.fullmatch(r"(\d\d):(\d\d):(\d\d)", t.strip())
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) if m else None


def video_start(flow_dir: str, video: str) -> str | None:
    """The wall-clock second the workflow saw this video start ("phone" or "car"), or None."""
    path = os.path.join(flow_dir, f"{video}-start.txt")
    if not os.path.exists(path):
        return None
    t = open(path, encoding="utf-8").read().strip()
    return t if clock(t) is not None else None


def at(said: str, start: str | None) -> str:
    """The video position of a line said at `said` ("HH:MM:SS"), as "@ MM:SS", or "" without a start."""
    a, b = clock(said), clock(start) if start else None
    if a is None or b is None:
        return ""
    d = (a - b) % 86400                                           # a recording that runs past midnight
    return f"@ {d // 60:02d}:{d % 60:02d}"


def transcript(path: str, start: str | None = None) -> list[str]:
    """The lines said, with their time and, when the video's start is known, the second of phone.mp4 they fall on:
    "12:01:33  @ 02:31  Left 3 tightens"."""
    lines = []
    if os.path.exists(path):
        for raw in open(path, encoding="utf-8", errors="replace"):
            m = re.search(r"(\d\d:\d\d:\d\d)\.\d+.*APEX-SAID (.*)$", raw.rstrip())
            if m:
                pos = at(m.group(1), start)
                lines.append(f"{m.group(1)}  {pos + '  ' if pos else ''}{m.group(2)}")
    return lines


def main(src: str, dst: str) -> int:
    os.makedirs(dst, exist_ok=True)
    index = ["# Vetta review recording", "",
             "Each flow below was run on an iPhone 16 Pro simulator (and its CarPlay window for the drives) by "
             "UITests/ReviewFlows. Drives replay a real recorded drive (Dry Ridge Rd, Cincinnati) through the app's own "
             "sensor handlers. Videos have no sound: the transcript lists every line the co-driver said, with its time and, after "
             "@, the minute and second of the flow's phone.mp4 it falls on (from the video's start time, beside each video "
             "below; the car's video starts within a second or two of the phone's).", ""]
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
            if screen == "phone":
                upright(target, step)
            steps[screen].append((target, f"{num} {step}"))
        for screen in steps:
            steps[screen].sort()
            sheet(steps[screen], os.path.join(out, f"sheet-{screen}.png"), width=260 if screen == "phone" else 360,
                  cols=6 if screen == "phone" else 3)
        for f in ("phone.mp4", "car.mp4", "app-log.txt"):
            if os.path.exists(os.path.join(flow_dir, f)):
                shutil.copyfile(os.path.join(flow_dir, f), os.path.join(out, f))
        starts = {v: video_start(flow_dir, v) for v in ("phone", "car")}
        said = transcript(os.path.join(flow_dir, "transcript.txt"), starts["phone"])
        with open(os.path.join(out, "transcript.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(said) + ("\n" if said else ""))
        index += [f"## {flow}", "",
                  f"- Steps: {len(steps['phone'])} phone photos" + (f", {len(steps['car'])} car photos" if steps["car"] else ""),
                  f"- Contact sheets: `{flow}/sheet-phone.png`" + (f", `{flow}/sheet-car.png`" if steps["car"] else ""),
                  "- Video: " + ", ".join(f"`{flow}/{v}.mp4`" + (f" (started {starts[v]})" if starts[v] else "")
                                          for v in ("phone", "car") if os.path.exists(os.path.join(out, f"{v}.mp4"))),
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
