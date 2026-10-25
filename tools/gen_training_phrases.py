"""Training phrases for a fine-tuned co-driver voice (docs/VOICE.md, "Path to any phrase in your voice").

Real calls first (tools/call_corpus.json, 1,586 calls from real loops), then random calls drawn
from the pace-note grammar so every head/modifier/caution/link/distance appears in many contexts.
Output: tools/training_phrases.json -> [{"tokens": [...], "text": "Left four minus long, care."}]
  python tools/gen_training_phrases.py 4000
"""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voicebank as vb  # noqa: E402


def main(n: int) -> None:
    rnd = random.Random(11)
    v = vb.codriver_vocabulary()
    heads = [t for t in v if t.startswith("head:")]
    mods = [t for t in v if t.startswith("mod:")]
    dists = [t for t in v if t.startswith("dist:")]
    hazards = [t for t in v if t.startswith("hazard:")]
    out, seen = [], set()

    def add(toks):
        k = tuple(toks)
        if k not in seen and all(t in v for t in toks):
            seen.add(k)
            out.append({"tokens": list(toks), "text": vb.phrase_text(toks, v)})

    corpus = json.load(open(os.path.join(vb.ROOT, "tools", "call_corpus.json")))
    for c in corpus:
        add(c)
    while len(out) < n:
        toks = []
        for i in range(rnd.choice([1, 1, 1, 2, 2, 3])):
            if i:
                toks.append(rnd.choice(["link:into", "link:and"]))
            if rnd.random() < 0.15:
                toks.append(rnd.choice(hazards))
                continue
            toks.append(rnd.choice(heads))
            toks += rnd.sample(mods, rnd.choices([0, 1, 2], [4, 4, 1])[0])
            if rnd.random() < 0.35:
                toks.append(f"caution:{rnd.choices([1, 2, 3], [6, 3, 1])[0]}")
        if rnd.random() < 0.55:
            toks.append(rnd.choice(dists))
        add(toks)
    json.dump(out, open(os.path.join(vb.ROOT, "tools", "training_phrases.json"), "w"), indent=0)
    print(f"{len(out)} phrases ({len(set(map(tuple, corpus)))} distinct real calls first)")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 4000)
