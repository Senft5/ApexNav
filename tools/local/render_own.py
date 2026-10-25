"""Render the owner's voice bank (and training data) on a local GPU. Resumable: rerun to continue.

  python tools/local/render_own.py            # word bank + exact calls + mined phrases + all units
  python tools/local/render_own.py --train    # also 4,000 training phrases -> train_own/ (wav + metadata.csv)

Outputs web/voices/own/ (the playable bank) and, with --train, train_own/ for fine-tuning Kokoro.
"""
import argparse
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import voicebank as vb  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", action="store_true", help="also render tools/training_phrases.json")
    ap.add_argument("--train-count", type=int, default=4000)
    ap.add_argument("--device", default=None)
    args = ap.parse_args()
    ref = os.path.join(HERE, "ref_partA.wav")
    recorded = os.path.join(HERE, "recorded")
    own = os.path.join(vb.OUT, "own", "manifest.json")

    if not os.path.exists(own):
        print("== word bank ==", flush=True)
        vb.build("own", ref)
    for tier in ("calls", "mined", "units"):
        print(f"== phrases: {tier} ==", flush=True)
        vb.build_phrases("own", ref, tier, recorded)
    vb.write_index()

    if args.train:
        import soundfile as sf
        print("== training phrases ==", flush=True)
        out = os.path.join(ROOT, "train_own")
        os.makedirs(os.path.join(out, "wavs"), exist_ok=True)
        phrases = json.load(open(os.path.join(ROOT, "tools", "training_phrases.json"), encoding="utf-8"))[: args.train_count]
        meta = os.path.join(out, "metadata.csv")
        done = set()
        if os.path.exists(meta):
            done = {row[0] for row in csv.reader(open(meta, encoding="utf-8"), delimiter="|")}
        engine = vb.ChatterboxEngine(ref, args.device)
        with open(meta, "a", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter="|")
            for n, p in enumerate(phrases):
                name = f"{n:05d}"
                if name in done:
                    continue
                audio = engine.render(p["text"])
                sf.write(os.path.join(out, "wavs", name + ".wav"), vb.trim(audio), vb.SR)
                w.writerow([name, p["text"]])
                f.flush()
                if n % 25 == 0:
                    print(f"  train {n}/{len(phrases)}  {p['text']}", flush=True)
    print("done. Next: git add web/voices/own web/voices/index.json && git commit && git push")
    return 0


if __name__ == "__main__":
    sys.exit(main())
