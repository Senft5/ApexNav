#!/usr/bin/env python3
"""Even out how fast the voice packs speak (the owner 2026-11-15: "rushed sometimes or too sluggish sometimes").

Kokoro speaks each clip at its own pace: one word rendered alone comes out quick, a long call slower, a line with a comma
holds a long breath at it, and a take rendered 12 % slower to be heard right (voicebank.py rebuild_checked) stays slower.
Joined into one call, those clips change speed mid-sentence. This pass measures every clip and brings it into one band:

  1. a pause inside a clip (a comma, a full stop) is held to at most MAX_PAUSE_S;
  2. the speaking rate, in phonemes (misaki, the same G2P Kokoro reads) per second of voice, is stretched to the pack's
     TARGETS rate (pitch kept, ffmpeg atempo) when it lies outside it +/- BAND, by at most STRETCH either way.

Clips under MIN_PHONES (a bare "Left") are too short to measure and keep their pace. The result is written into the
manifest as "pace" (phonemes a second, after) so tests/test_voice_pace.py can hold every pack to the band, and a new
clip from voicebank.py is paced the same way (it calls pace_clip). A clip with a "pace" is skipped, so none is stretched twice.

  /opt/tts12/bin/python tools/voice_pace.py --all          # every pack
  /opt/tts12/bin/python tools/voice_pace.py --voice kit --only keys.txt
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "voices")
SR = 24000
# phonemes a second of voice for each pack: near each voice's own pace for its corner calls (Kit's bm_fable speaks slowly
# at any setting, 9 a second; Marguerite quickly, 13), Kit brought up and Marguerite down a little, so no pack drags or rushes
TARGETS = {"marguerite": 12.5, "kit": 10.5, "hale": 11.5}
TARGET = 11.5
BAND = 0.06            # inside TARGET +/- 6 % a clip is left as it is
STRETCH = (0.75, 1.35)  # never stretched further than this (rubberband tempo; > 1 is faster)
MAX_PAUSE_S = 0.24     # the longest silence kept inside a clip
MIN_PHONES = 6
SHORT_PHONES, SHORT_STRETCH = 8, (0.88, 1.18)   # a rate over so few phonemes is rough: such a clip is stretched less
FRAME_S = 0.02
LANG = {"marguerite": "a", "kit": "b", "hale": "b"}

_g2p = {}


def phonemes(text: str, lang: str) -> int:
    """How many phonemes Kokoro says for this text (stress marks, spaces and punctuation not counted)."""
    if lang not in _g2p:
        import warnings
        warnings.filterwarnings("ignore")
        from misaki import en
        _g2p[lang] = en.G2P(trf=False, british=lang == "b", fallback=None)
    ps, _ = _g2p[lang](text or "")
    return len(re.sub(r"[ˈˌ\s,.!?;:—\-'\"()]", "", ps or ""))


def decode(path: str) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").copy()


def voiced_frames(audio: np.ndarray) -> np.ndarray:
    f = int(FRAME_S * SR)
    n = len(audio) // f
    if n == 0:
        return np.zeros(0, dtype=bool)
    e = np.sqrt(np.mean(audio[:n * f].reshape(n, f) ** 2, axis=1))
    return e > max(float(e.max()), 1e-6) * 10 ** (-35 / 20)


def voiced_s(audio: np.ndarray) -> float:
    return float(voiced_frames(audio).sum()) * FRAME_S


def cap_pauses(audio: np.ndarray, max_s: float = MAX_PAUSE_S) -> np.ndarray:
    """Shortens every silence inside the clip (between its first and last voiced frame) to max_s, cut at its middle."""
    v = voiced_frames(audio)
    idx = np.flatnonzero(v)
    if len(idx) < 2:
        return audio
    f, keep = int(FRAME_S * SR), int(max_s / FRAME_S)
    out, i, start = [], idx[0], 0
    while i <= idx[-1]:
        if v[i]:
            i += 1
            continue
        j = i
        while j <= idx[-1] and not v[j]:
            j += 1
        if j - i > keep:                                  # frames i..j-1 are silent: keep keep/2 at each side
            a, b = i + keep // 2, j - (keep - keep // 2)
            out.append(audio[start:a * f])
            start = b * f
        i = j
    out.append(audio[start:])
    return np.concatenate(out)


def stretch(audio: np.ndarray, tempo: float) -> np.ndarray:
    """Time-stretch with the pitch kept (ffmpeg's atempo, WSOLA); tempo > 1 speaks faster. Rubberband was tried: Whisper
    heard "Limit ten ahead" as "Limit town ahead" and "Long into" as "Long and two" after it, atempo kept every word."""
    if abs(tempo - 1) < 1e-3:
        return audio
    pcm = audio.astype("<f4").tobytes()
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                          "-af", f"atempo={tempo:.4f}", "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         input=pcm, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").copy()


def pace_clip(audio: np.ndarray, text: str, lang: str, target: float = TARGET, aim: float | None = None,
              stretch_ok: bool = True) -> tuple[np.ndarray, float | None, bool]:
    """(audio, phonemes a second after, changed). A clip too short to measure comes back as it is, pace None. A clip
    outside target +/- BAND is stretched to `aim` (the target itself unless told otherwise); stretch_ok False only caps its pauses."""
    aim = aim or target
    n = phonemes(text, lang)
    if n < MIN_PHONES:
        return audio, None, False
    capped = cap_pauses(audio)
    changed = len(capped) != len(audio)
    v = voiced_s(capped)
    if v <= 0:
        return audio, None, False
    rate = n / v
    if stretch_ok and abs(rate / target - 1) > BAND:
        src, tempo = capped, 1.0
        lim = STRETCH if n >= SHORT_PHONES else SHORT_STRETCH
        for _ in range(3):                                # the voiced time doesn't scale exactly with tempo: aim again
            tempo = min(max(tempo * aim / rate, lim[0]), lim[1])
            capped = stretch(src, tempo)
            v = voiced_s(capped) or v
            rate = n / v
            if abs(rate / aim - 1) <= BAND / 2 or tempo in lim:
                break
        changed = True
    return capped, (round(n / v, 2) if n >= SHORT_PHONES else None), changed


def edge_aim(audio: np.ndarray, text: str, lang: str, target: float, part: float = 1.0) -> float:
    """The near edge of the band, a little inside it (the smallest stretch that brings a clip into the band), or `part` of
    the way there from the clip's own pace."""
    n, v = phonemes(text, lang), voiced_s(cap_pauses(audio))
    edge = target * (1 - BAND * 0.6) if v and n / v < target else target * (1 + BAND * 0.6)
    return (n / v) * (edge / (n / v)) ** part if v else edge


def paced_and_heard(audio: np.ndarray, text: str, lang: str, target: float, ear, before: float):
    """The best pacing Whisper still hears as well as before (within 0.05): to the target, else just into the band, else
    half way there, else only the pauses capped, else the clip as it was. Returns (audio, pace, changed, note)."""
    tries = [{}, {"aim": edge_aim(audio, text, lang, target)}, {"aim": edge_aim(audio, text, lang, target, 0.5)}, {"stretch_ok": False}]
    note = ""
    for kw in tries:
        paced, rate, changed = pace_clip(audio, text, lang, target, **kw)
        if not changed:
            return paced, rate, False, note
        if ear is None:
            return paced, rate, True, note
        after, heard = ear.score(paced, text)
        if after >= before - 0.05:
            return paced, rate, True, note
        note += f" {heard!r} ({after:.2f} < {before:.2f})"
    v, n_ph = voiced_s(audio), phonemes(text, lang)
    return audio, (round(n_ph / v, 2) if v and n_ph >= SHORT_PHONES else None), False, note


def pace_bank(voice_id: str, only: set[str] | None = None, check: bool = True, force: bool = False) -> int:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from voicebank import encode_m4a, Listener   # the packs' own encoder (levelled, AAC 56k) and Whisper check
    ear = Listener() if check else None
    out_dir = os.path.join(OUT, voice_id)
    mpath = os.path.join(out_dir, "manifest.json")
    manifest = json.load(open(mpath, encoding="utf-8"))
    lang, n_changed = LANG[voice_id], 0
    for n, (key, e) in enumerate(manifest["tokens"].items(), 1):
        if only and key not in only:
            continue
        if "pace" in e and not force:
            continue                                          # paced already (once only: a clip is never stretched twice)
        path = os.path.join(out_dir, e["file"])
        audio = decode(path)
        text = e.get("text", "")
        before = (e["heard"] if isinstance(e.get("heard"), (int, float)) else ear.score(audio, text)[0]) if ear else 1.0
        paced, rate, changed, note = paced_and_heard(audio, text, lang, TARGETS[voice_id], ear, before)
        if note:
            print(f"  {voice_id}: {key} heard{note}, {'paced less' if changed else 'kept as it was'}", flush=True)
        if changed:
            encode_m4a(paced, path)
            e["dur"] = round(len(paced) / SR, 3)
            n_changed += 1
        e["pace"] = rate                                  # null: too short to measure
        if n % 100 == 0:
            print(f"  {voice_id}: {n}/{len(manifest['tokens'])}, {n_changed} paced", flush=True)
            with open(mpath, "w", encoding="utf-8") as f:   # resumable: a clip in the band and with its pace is skipped
                json.dump(manifest, f, indent=1)
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    print(f"  {voice_id}: {n_changed} clips paced", flush=True)
    return n_changed


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", choices=sorted(LANG))
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--only", help="a file of keys, one a line")
    ap.add_argument("--no-check", action="store_true", help="skip the Whisper check of each paced clip")
    ap.add_argument("--force", action="store_true", help="pace clips that have been paced before (after a new render)")
    a = ap.parse_args()
    only = {l.strip() for l in open(a.only, encoding="utf-8") if l.strip()} if a.only else None
    for v in (sorted(LANG) if a.all else [a.voice] if a.voice else []):
        pace_bank(v, only, check=not a.no_check, force=a.force)


if __name__ == "__main__":
    main()
