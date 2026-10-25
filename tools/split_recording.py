"""Cut a read-through of docs/VOICE_SCRIPT.md into whole-phrase clips.

The speaker runs lines together, so silence splitting fails. Instead: Whisper word timestamps
-> fuzzy-align every script line, in order, to a window of recognised words -> cut at the quietest
point between neighbouring lines. Lines that do not match well are skipped and left to the clone.

  python tools/split_recording.py segs.json full.wav outdir
(segs.json = word-level Whisper output: [{"w": [[word, start, end], ...]}, ...])
"""
from __future__ import annotations

import difflib
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voicebank as vb  # noqa: E402

ONES = "zero one two three four five six seven eight nine".split()
TEENS = "ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = {2: "twenty", 3: "thirty", 4: "forty", 5: "fifty", 6: "sixty", 7: "seventy", 8: "eighty", 9: "ninety"}


def say_number(n: int) -> list[str]:
    """Rally style: 120 -> one twenty, 450 -> four fifty, 500 -> five hundred, 30 -> thirty."""
    if n < 10:
        return [ONES[n]]
    if n < 20:
        return [TEENS[n - 10]]
    if n < 100:
        return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    h, r = divmod(n, 100)
    if r == 0:
        return [ONES[h], "hundred"]
    return [ONES[h]] + say_number(r)


def words_of(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[a-z]+|\d+", text.lower().replace("-", " ")):
        out += say_number(int(w)) if w.isdigit() else [w]
    return out


def main(segs_path, wav_path, outdir) -> int:
    import soundfile as sf
    segs = json.load(open(segs_path))
    asr = [(w.strip(), s, e) for seg in segs for w, s, e in seg["w"]]
    audio, sr = sf.read(wav_path)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    vocab = vb.codriver_vocabulary()
    lines = [(vb.phrase_key(c), vb.phrase_text(c, vocab)) for c in vb.route_phrases()]
    heads = [(vb.phrase_key([t]), vb.phrase_text([t], vocab)) for t in vocab if t.startswith("head:")]
    lines += heads
    known = sorted({w for _, t in lines for w in words_of(t)})
    canon = []
    ALIAS = {"write": "right", "ride": "right", "rite": "right", "titans": "tightens", "excuse": "excuse"}
    for w, s, e in asr:
        ws = [ALIAS.get(x, x) for x in (words_of(w) or [w.lower()])]
        for x in ws:
            if x in known:
                canon.append((x, s, e))
                continue
            m = difflib.get_close_matches(x, known, 1, 0.6)
            canon.append((m[0] if m else x, s, e))
    # Part B starts after the instructions: first "real calls" heading.
    start = next((i for i, (w, _, _) in enumerate(canon) if w == "real"), 0) + 2
    ptr, found = start, []
    for key, text in lines:
        exp = words_of(text)
        best = None
        for lo in range(ptr, min(len(canon), ptr + 30 + 3 * len(exp))):
            for n in range(max(1, len(exp) - 2), len(exp) + 3):
                win = [w for w, _, _ in canon[lo:lo + n]]
                if len(win) < n:
                    continue
                r = difflib.SequenceMatcher(None, exp, win, autojunk=False).ratio()
                if best is None or r > best[0] + 1e-9 or (abs(r - best[0]) < 1e-9 and lo < best[1]):
                    best = (r, lo, n)
        if best and best[0] >= 0.85:
            r, lo, n = best
            found.append((key, text, lo, lo + n - 1, r))
            ptr = lo + n
        else:
            print(f"  skip ({best[0] if best else 0:.2f}) {text}")
    os.makedirs(outdir, exist_ok=True)
    env = np.convolve(np.abs(audio), np.ones(int(0.01 * sr)) / int(0.01 * sr), mode="same")
    quiet = lambda a, b: int(a + np.argmin(env[int(a):max(int(a) + 1, int(b))]))   # quietest sample in [a, b)
    manifest = {}
    for k, (key, text, lo, hi, r) in enumerate(found):
        prev_end = canon[found[k - 1][3]][2] if k else canon[lo][1] - 0.3
        next_start = canon[found[k + 1][2]][1] if k + 1 < len(found) else canon[hi][2] + 0.3
        a_sec, b_sec = canon[lo][1], canon[hi][2]
        a = quiet(max(prev_end, a_sec - 0.25) * sr, a_sec * sr + 1) if prev_end < a_sec else int(a_sec * sr)
        b = quiet(b_sec * sr, min(next_start, b_sec + 0.25) * sr + 1) if next_start > b_sec else int(b_sec * sr)
        clip = audio[a:b].astype(np.float32)
        clip = vb.trim(np.interp(np.arange(0, len(clip), sr / vb.SR), np.arange(len(clip)), clip).astype(np.float32))
        fade = int(0.012 * vb.SR)
        clip[:fade] *= np.linspace(0, 1, fade); clip[-fade:] *= np.linspace(1, 0, fade)
        fname = "r_" + vb.hashlib.sha1(key.encode()).hexdigest()[:12] + ".m4a"
        vb.encode_m4a(clip, os.path.join(outdir, fname))
        manifest[key] = {"file": fname, "dur": round(len(clip) / vb.SR, 3), "text": text, "match": round(r, 2), "src": "recording"}
    json.dump(manifest, open(os.path.join(outdir, "recorded.json"), "w"), indent=1)
    print(f"cut {len(manifest)} of {len(lines)} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
