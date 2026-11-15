"""valhalla/v1/index.json for our router's tile tar (.github/workflows/valhalla-tiles.yml): which build, how many parts,
their total size and the tar's sha256, which router/start.sh checks and backend/src/data_store.ts requires.

    python tools/valhalla/index.py --tar tiles.tar --parts DIR --build BUILD [--source TEXT] > index.json
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys

PART = re.compile(r"^part-\d{3}$")
BUILD = re.compile(r"^[\w.:-]{1,64}$")


def index(tar: str, parts_dir: str, build: str, source: str = "") -> dict:
    if not BUILD.match(build):
        raise ValueError(f"bad build name {build!r}")
    names = sorted(os.listdir(parts_dir))
    if not names or any(not PART.match(n) for n in names) or names != [f"part-{i:03d}" for i in range(len(names))]:
        raise ValueError(f"parts must be part-000..part-NNN, got {names[:3]}..")
    size = sum(os.path.getsize(os.path.join(parts_dir, n)) for n in names)
    if size != os.path.getsize(tar):
        raise ValueError("the parts don't add up to the tar")
    h = hashlib.sha256()
    for n in names:
        with open(os.path.join(parts_dir, n), "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
    return {"build": build, "parts": len(names), "bytes": size, "sha256": h.hexdigest(),
            "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"), "source": source}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tar", required=True)
    ap.add_argument("--parts", required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--source", default="")
    a = ap.parse_args()
    json.dump(index(a.tar, a.parts, a.build, a.source), sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
