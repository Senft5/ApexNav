"""Render co-driver voice banks with an open-source TTS model.

Rally games don't synthesise pace notes live: they stitch a recorded word bank. We do the
same with an open model, so the co-driver sounds identical offline, in the browser, in the
iOS app and (later) on CarPlay, with no dependence on whatever voices a device ships.

  # needs the TTS environment (see docs/VOICE.md): torch CPU + kokoro
  /opt/tts12/bin/python tools/voicebank.py --voice marguerite
  /opt/tts12/bin/python tools/voicebank.py --all

Output: web/voices/<id>/<token>.m4a + manifest.json, and web/voices/index.json.
web/voice.js turns structured pace notes into token sequences and plays them.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import re
import subprocess
import sys
import tempfile

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "voices")
SR = 24000

NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
TENS = {30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy", 80: "eighty"}
RALLY_DISTANCES = (30, 40, 50, 60, 70, 80, 100, 120, 150, 200, 250, 300, 350, 400, 450, 500)
MODS = ("long", "short", "tightens", "opens", "banked", "off-camber", "over crest")
CAUTIONS = ("care", "caution", "double caution", "triple caution")


def codriver_distance(d: int) -> str:
    """Co-drivers say "one-fifty", "two hundred", "thirty"."""
    if d in TENS:
        return TENS[d]
    h, r = divmod(d, 100)
    if r == 0:
        return f"{NUM[h]} hundred"
    return f"{NUM[h]} {TENS.get(r, 'twenty' if r == 20 else str(r))}"


# The theme voice packs (docs/design/REVIEW.md 4.4): one co-driver per theme. The calls are the same in every pack; the
# character is in the lines around them. No speed numbers, no praise for pace, "score" the only score word.
PACK_LINES = {
    "marguerite": {"sys:test": "Notes ready. Have a good one.", "sys:stage": "Full notes.", "sys:cruise": "Quiet from here. Bumps and cameras only.",
                   "sys:end": "That's the drive.", "sys:sample": "Left four, tightens. Long. Care.",
                   "end:score": "Score", "end:best": "your best on this road."},
    "kit": {"sys:test": "Tape's in. Let's keep it tidy.", "sys:stage": "Full notes. Here we go.", "sys:cruise": "Quiet now. Hazards only.",
            "sys:end": "That's a wrap.", "sys:sample": "Left four, tightens. Easy in, late out.", "end:best": "Best yet on this road."},
    "hale": {"sys:test": "Route loaded.", "sys:stage": "Full notes.", "sys:cruise": "Hazards only.",
             "sys:end": "Complete.", "sys:sample": "Left four. Tightens. Long.", "end:score": "Score,", "end:best": "Best on this road."},
}


def codriver_vocabulary(pack: str = None) -> dict[str, str]:
    """token -> text. Tokens are what web/voice.js asks for; a pack's own lines replace the plain ones."""
    v = {}
    for d, word in (("L", "Left"), ("R", "Right")):
        for sev in range(1, 7):
            for g, gw in (("", ""), ("-", " minus"), ("+", " plus")):
                v[f"head:{d}{sev}{g}"] = f"{word} {NUM[sev]}{gw}"
        v[f"head:{d}HP"] = f"{word} hairpin"
        v[f"head:{d}SQ"] = f"Square {word.lower()}"
        v[f"head:{d}AC"] = f"Acute {word.lower()}"
    for m in MODS:
        v[f"mod:{m}"] = m.replace("-", " ")
    for i, c in enumerate(CAUTIONS, start=1):
        v[f"caution:{i}"] = c
    v["link:into"] = "into"
    v["link:and"] = "and"
    for d in RALLY_DISTANCES:
        v[f"dist:{d}"] = codriver_distance(d)
    for k, w in (("bump", "Bump"), ("crest", "Crest"), ("dip", "Dip"), ("alpr", "Camera")):
        v[f"hazard:{k}"] = w
    v["sys:stage"] = "Stage mode. Full notes."
    v["sys:cruise"] = "Cruise. Hazards only."
    v["sys:test"] = "Co-driver ready."
    v.update(score_vocabulary())
    v.update(voice_lines())
    v.update(PACK_LINES.get(pack, {}))
    return v


def voice_lines() -> dict[str, str]:
    """The directions, route, traffic, hazard-report, coaching and track lines (web/voice_lines.js, the JSON between its
    markers): in every pack so a drive is said in one voice, never half by the phone's own."""
    src = open(os.path.join(ROOT, "web", "voice_lines.js"), encoding="utf-8").read()
    body = src.split("/* VOICE_LINES_JSON */", 1)[1].split("/* END_VOICE_LINES_JSON */", 1)[0]
    return json.loads(body)


def score_vocabulary() -> dict[str, str]:
    """The Vetta Score at the end of a drive (web/end_line.js): 0-99, the hundreds and a thousand, so 702 is
    "seven hundred" + "two" in the pack's own voice."""
    ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
            "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
    tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
    v = {f"n:{n}": ones[n] if n < 20 else tens[n // 10] + (f"-{ones[n % 10]}" if n % 10 else "") for n in range(100)}
    v.update({f"n:h{h}": f"{ones[h]} hundred" for h in range(1, 10)})
    v["n:k1"] = "one thousand"
    return v


def add_missing(voice_id: str) -> int:
    """Renders only the tokens a bank doesn't have yet and merges them into its manifest (phrase clips are kept)."""
    cfg = VOICES[voice_id]
    mpath = os.path.join(OUT, voice_id, "manifest.json")
    manifest = json.load(open(mpath, encoding="utf-8"))
    vocab = codriver_vocabulary(voice_id)
    todo = [(t, x) for t, x in vocab.items() if t not in manifest["tokens"] or manifest["tokens"][t].get("text") != x]
    engine = KokoroEngine(cfg["lang"])
    for n, (token, text) in enumerate(todo, 1):
        audio = trim(engine.render(text, cfg["kokoro_voice"], cfg["speed"]))
        fname = safe_name(token) + ".m4a"
        encode_m4a(audio, os.path.join(OUT, voice_id, fname))
        manifest["tokens"][token] = {"file": fname, "dur": round(len(audio) / SR, 3), "text": text}
        with open(mpath, "w", encoding="utf-8") as f:       # resumable
            json.dump(manifest, f, indent=1)
        print(f"  {voice_id}: [{n}/{len(todo)}] {token} {text}", flush=True)
    return len(todo)


def phrase_key(tokens) -> str:
    """Whole-phrase clips are keyed by their token run joined with '+'; web/voice.js plays the
    longest run it has a clip for and falls back to single tokens."""
    return "+".join(tokens)


def phrase_text(tokens, vocab) -> str:
    """One natural sentence for a token run: commas before cautions and distances."""
    out = ""
    for t in tokens:
        w = vocab[t]
        if not out:
            out = w
        elif t.startswith(("caution:", "dist:")):
            out += ", " + w
        else:
            out += " " + w
    return out[0].upper() + out[1:] + "."


def tts_text(tokens, vocab) -> str:
    """What the speech model is given. A co-driver runs a chunk together ("Left four opens over
    crest into right two") and breathes before the caution (~0.3-0.4 s) and before the distance
    (~0.2-0.25 s), measured on the owner's real recordings. Runs of dots are the longest pause
    Kokoro will make inside one sentence; commas give it under 0.1 s, which sounds like a run-on."""
    out = ""
    for t in tokens:
        w = vocab[t]
        if not out:
            out = w
        elif t.startswith("caution:"):
            out += " ..... " + w
        elif t.startswith("dist:"):
            out += " ... " + w
        else:
            out += " " + w
    return out[0].upper() + out[1:] + "."


def unit_phrases(vocab) -> list[list[str]]:
    """Every head with each single modifier: the unit the ear hears as one call."""
    heads = [t for t in vocab if t.startswith("head:")]
    mods = [t for t in vocab if t.startswith("mod:")]
    return [[h, m] for h in heads for m in mods]


def route_phrases() -> list[list[str]]:
    path = os.path.join(ROOT, "tools", "route_calls.json")
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else []


VOICES = {
    # Marguerite was bf_isabella; every British female Kokoro voice ends a short call with an extra syllable ("Left four
    # plus-es", "Crest-ed"; checked with --rebuild-checked), so she is af_bella, the one that says all of them clean.
    "marguerite": {"name": "Marguerite", "style": "codriver", "engine": "kokoro", "kokoro_voice": "af_bella", "lang": "a", "speed": 1.05},
    "kit": {"name": "Kit", "style": "codriver", "engine": "kokoro", "kokoro_voice": "bm_fable", "lang": "b", "speed": 1.12},
    "hale": {"name": "Hale", "style": "codriver", "engine": "kokoro", "kokoro_voice": "bm_lewis", "lang": "b", "speed": 0.98},
}
LICENSES = {"kokoro": "Kokoro-82M, Apache-2.0 (hexgrad/Kokoro-82M)",
            "vc": "Kokoro-82M (Apache-2.0) converted to the owner's consented voice with kNN-VC (MIT)",
            "chatterbox": "Chatterbox, MIT (resemble-ai/chatterbox); clone of a consented sample, Perth-watermarked"}


class KokoroEngine:
    def __init__(self, lang: str):
        from kokoro import KPipeline
        self.pipe = KPipeline(lang_code=lang)

    def render(self, text: str, voice: str, speed: float) -> np.ndarray:
        parts = [np.asarray(a, dtype=np.float32) for _, _, a in self.pipe(text, voice=voice, speed=speed)]
        return np.concatenate(parts) if parts else np.zeros(1, dtype=np.float32)


class ChatterboxEngine:
    """Zero-shot clone from a reference clip. Chatterbox clips bare single words short, so each
    token ends in punctuation and is re-rendered (new sample) when it comes out much shorter
    than the same token in a Kokoro bank."""

    def __init__(self, ref_wav: str, device: str = None):
        import torch
        from chatterbox.tts import ChatterboxTTS
        torch.manual_seed(7)
        device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        print(f"  chatterbox on {device}", flush=True)
        self.model = ChatterboxTTS.from_pretrained(device=device)
        self.model.prepare_conditionals(ref_wav, exaggeration=0.5)
        self.sr = self.model.sr

    def render(self, text: str, voice: str = None, speed: float = 1.0, expect_s: float = None) -> np.ndarray:
        prompt = text if text[-1] in ".!?:" else text + "."
        best = None
        for _ in range(3):
            a = self.model.generate(prompt, cfg_weight=0.5, exaggeration=0.5).squeeze(0).numpy().astype(np.float32)
            if self.sr != SR:
                a = np.interp(np.arange(0, len(a), self.sr / SR), np.arange(len(a)), a).astype(np.float32)
            dur = len(trim(a)) / SR
            if best is None or dur > best[1]:
                best = (a, dur)
            if expect_s is None or 0.6 * expect_s <= dur <= 2.0 * expect_s:
                return a
        return best[0]


def trim(audio: np.ndarray, threshold_db: float = -42.0, pad_s: float = 0.015) -> np.ndarray:
    """Cut leading/trailing silence so stitched clips sit tight together."""
    env = np.convolve(np.abs(audio), np.ones(240) / 240, mode="same")
    thr = 10 ** (threshold_db / 20) * max(1e-6, float(np.max(np.abs(audio))))
    idx = np.flatnonzero(env > thr)
    if not len(idx):
        return audio
    pad = int(pad_s * SR)
    return audio[max(0, idx[0] - pad):min(len(audio), idx[-1] + pad)]


def safe_name(token: str) -> str:
    """'head:L4-' -> 'head_L4m', 'head:R2+' -> 'head_R2p', 'mod:off-camber' -> 'mod_off_camber'."""
    name = token.replace(":", "_")
    if name.startswith("head_"):
        name = name.replace("+", "p").replace("-", "m")
    return re.sub(r"[^A-Za-z0-9_]+", "_", name)


TARGET_RMS_DB = -20.0   # every clip in every pack at the same speech level, so a call stitched from clips, and a change of
                        # theme, never jumps in volume; peaks are held under -1 dBFS (a loud plosive lowers its clip instead)


def level(audio: np.ndarray) -> np.ndarray:
    peak = max(1e-6, float(np.max(np.abs(audio))))
    env = np.abs(audio)
    voiced = audio[env > 10 ** (-40 / 20) * peak]
    rms = float(np.sqrt(np.mean(voiced ** 2))) if len(voiced) else peak / 4
    gain = min(10 ** (TARGET_RMS_DB / 20) / max(rms, 1e-6), 0.89 / peak)
    return audio * gain


def encode_m4a(audio: np.ndarray, path: str) -> None:
    pcm = (np.clip(level(audio), -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    "-c:a", "aac", "-strict", "-2", "-b:a", "56k", "-movflags", "+faststart", path], input=pcm, check=True)


def build(voice_id: str, ref: str = None) -> dict:
    cfg = VOICES[voice_id]
    vocab = codriver_vocabulary(voice_id)
    expect = {}
    if cfg["engine"] == "chatterbox":
        if not ref:
            raise SystemExit(f"{voice_id} is a cloned voice: pass --ref sample.wav (a consented recording)")
        engine = ChatterboxEngine(ref)
        george = os.path.join(OUT, "marguerite", "manifest.json")   # expected token lengths
        if os.path.exists(george):
            expect = {k: v["dur"] for k, v in json.load(open(george, encoding="utf-8"))["tokens"].items()}
    else:
        engine = KokoroEngine(cfg["lang"])
    out_dir = os.path.join(OUT, voice_id)
    os.makedirs(out_dir, exist_ok=True)
    tokens = {}
    for token, text in vocab.items():
        if cfg["engine"] == "chatterbox":
            audio = trim(engine.render(text, expect_s=expect.get(token)))
        else:
            audio = trim(engine.render(text, cfg["kokoro_voice"], cfg["speed"]))
        fname = safe_name(token) + ".m4a"
        encode_m4a(audio, os.path.join(out_dir, fname))
        tokens[token] = {"file": fname, "dur": round(len(audio) / SR, 3), "text": text}
        print(f"  {voice_id}: {token:16} {tokens[token]['dur']:.2f}s  {text}", flush=True)
    manifest = {"id": voice_id, "name": cfg["name"], "style": cfg["style"], "engine": cfg["engine"],
                "kokoro_voice": cfg.get("kokoro_voice"), "speed": cfg.get("speed", 1.0),
                "license": LICENSES[cfg["engine"]], "tokens": tokens}
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    return manifest


# Units worth rendering first for the slow cloned engine (most common modifiers).
CORE_MODS = ("mod:banked", "mod:long", "mod:off-camber")


def merge_recorded(voice_id: str, recorded_dir: str) -> int:
    """Copy real recordings (tools/split_recording.py output) into a bank; they win over renders."""
    mpath = os.path.join(OUT, voice_id, "manifest.json")
    manifest = json.load(open(mpath, encoding="utf-8"))
    rec = json.load(open(os.path.join(recorded_dir, "recorded_keep.json"), encoding="utf-8"))
    for key, v in rec.items():
        shutil.copy(os.path.join(recorded_dir, v["file"]), os.path.join(OUT, voice_id, v["file"]))
        manifest["tokens"][key] = {"file": v["file"], "dur": v["dur"], "text": v["text"], "src": "recording"}
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    return len(rec)


def build_phrases(voice_id: str, ref: str = None, tier: str = "calls", recorded: str = None, redo: bool = False) -> None:
    """Add whole-phrase clips to an existing bank. tier: calls (exact calls of the shipped
    routes), core (+ heads x banked/long/off-camber), units (+ every head x modifier),
    mined (+ the runs tools/mine_phrases.py found most valuable on real routes)."""
    cfg = VOICES[voice_id]
    vocab = codriver_vocabulary()
    mpath = os.path.join(OUT, voice_id, "manifest.json")
    if recorded:
        print(f"  {voice_id}: merged {merge_recorded(voice_id, recorded)} real recordings", flush=True)
    manifest = json.load(open(mpath, encoding="utf-8"))
    if redo:    # drop every phrase clip (keys with several tokens) and render them again
        for k in [k for k, v in manifest["tokens"].items() if "src" not in v and k.count(":") > 1]:   # multi-token keys
            try:
                os.remove(os.path.join(OUT, voice_id, manifest["tokens"][k]["file"]))
            except OSError:
                pass
            del manifest["tokens"][k]
    wanted = list(route_phrases())
    units = unit_phrases(vocab)
    if tier in ("mined", "units"):   # units is a superset: mined runs + every head x modifier
        mp = os.path.join(ROOT, "tools", "mined_phrases.json")
        wanted += json.load(open(mp, encoding="utf-8")) if os.path.exists(mp) else []
    if tier in ("core", "units"):
        wanted += [u for u in units if tier == "units" or u[1] in CORE_MODS]
    seen, todo = set(), []
    for toks in wanted:
        k = phrase_key(toks)
        if k not in seen and k not in manifest["tokens"] and all(t in vocab for t in toks):
            seen.add(k)
            todo.append(toks)
    if cfg["engine"] == "chatterbox":
        engine, expect = ChatterboxEngine(ref), {}
    else:
        engine, expect = KokoroEngine(cfg["lang"]), None
    for n, toks in enumerate(todo, 1):
        k, text = phrase_key(toks), phrase_text(toks, vocab)
        if expect is None:
            audio = trim(engine.render(tts_text(toks, vocab), cfg["kokoro_voice"], cfg["speed"]))
        else:
            want = sum(manifest["tokens"][t]["dur"] for t in toks if t in manifest["tokens"])
            audio = trim(engine.render(text, expect_s=want * 0.9 if want else None))
        fname = "p_" + hashlib.sha1(k.encode()).hexdigest()[:12] + ".m4a"
        encode_m4a(audio, os.path.join(OUT, voice_id, fname))
        manifest["tokens"][k] = {"file": fname, "dur": round(len(audio) / SR, 3), "text": text}
        with open(mpath, "w", encoding="utf-8") as f:       # resumable: written after every clip
            json.dump(manifest, f, indent=1)
        print(f"  {voice_id}: [{n}/{len(todo)}] {text}", flush=True)


TOKEN_START = re.compile(r"\+(?=(?:head|mod|caution|link|dist|hazard|n|end|sys|nav|navd|lane|line):)")


def split_key(key: str) -> list[str]:
    """'head:R1++mod:long' -> ['head:R1+', 'mod:long'] (a '+' that starts a token, not the one in 'R1+')."""
    return TOKEN_START.split(key)


class Listener:
    """Whisper (base.en) checks a render says its words: --rebuild-checked keeps the first variant that does."""
    PROMPT = ("Rally pace notes: left four, right two minus, square left, hairpin, into, and, care, caution, off camber, "
              "tightens, opens, banked, crest, dip, bump, one-fifty. Directions: in half a mile, turn left, keep right.")

    def __init__(self):
        from faster_whisper import WhisperModel
        self.model = WhisperModel("base.en", device="cpu", compute_type="int8")

    @staticmethod
    def words(s: str) -> list[str]:
        ones = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
        tens = {2: "twenty", 3: "thirty", 4: "forty", 5: "fifty", 6: "sixty", 7: "seventy", 8: "eighty", 9: "ninety"}
        def say(n: int) -> str:
            if n < 20: return ones[n]
            if n < 100: return tens[n // 10] + ("" if n % 10 == 0 else " " + ones[n % 10])
            if n < 1000: return ones[n // 100] + " " + (say(n % 100) if n % 100 else "hundred") if n % 100 and n // 100 and n % 100 >= 10 else ones[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + say(n % 100))
            return "one thousand"
        s = s.lower().replace("-", " ").replace("off camber", "offcamber")
        s = re.sub(r"\d+", lambda m: " " + say(int(m.group())) + " ", s)
        return re.sub(r"[^a-z ]+", " ", s).split()

    def score(self, audio: np.ndarray, want: str) -> tuple[float, str]:
        import difflib
        x = np.interp(np.arange(0, len(audio), SR / 16000), np.arange(len(audio)), audio).astype(np.float32)
        x = np.concatenate([np.zeros(4000, np.float32), x / max(1e-6, float(np.max(np.abs(x)))) * 0.5, np.zeros(4000, np.float32)])
        segs, _ = self.model.transcribe(x, language="en", beam_size=5, without_timestamps=True, condition_on_previous_text=False, initial_prompt=self.PROMPT)
        heard = " ".join(s.text for s in segs).strip()
        a, b = self.words(want), self.words(heard)
        # "three fifty" is how a co-driver says 350: compare the words, and the numbers as Whisper writes them
        return difflib.SequenceMatcher(None, a, b).ratio(), heard


# Clips a voice says wrong at its own setting, by Whisper base and small: Kit's fast "sixty" and "eighty" are "sixteen" and
# "eighteen". The bare clip uses this pronunciation (lang) and speed; a phrase holding the token also gets a take at it.
TOKEN_OVERRIDES = {"kit": {"dist:40": ("b", 0.9), "dist:50": ("b", 0.9), "dist:60": ("b", 0.9), "dist:80": ("a", 0.9)}}


def rebuild_checked(voice_id: str, only: list[str] | None = None, threshold: float = 0.8) -> None:
    """Re-render a bank's every clip (or `only`), each checked by ear: up to three spellings of the line, at the voice's
    speed and then 12 % slower, are rendered and the first Whisper hears as its words is kept, else the closest. Phrase keys are kept as they are; new vocabulary
    (web/voice_lines.js) is added. Writes the score into the manifest ("heard": 0-1) so a later pass can find weak clips."""
    cfg = VOICES[voice_id]
    vocab = codriver_vocabulary(voice_id)
    out_dir = os.path.join(OUT, voice_id)
    mpath = os.path.join(out_dir, "manifest.json")
    manifest = json.load(open(mpath, encoding="utf-8")) if os.path.exists(mpath) else {"tokens": {}}
    manifest.update({"id": voice_id, "name": cfg["name"], "style": cfg["style"], "engine": cfg["engine"], "kokoro_voice": cfg["kokoro_voice"],
                     "speed": cfg["speed"], "license": LICENSES[cfg["engine"]]})
    keys = list(dict.fromkeys(list(manifest["tokens"]) + list(vocab)))
    if only:
        keys = [k for k in keys if k in set(only)]
    engines, ear = {cfg["lang"]: KokoroEngine(cfg["lang"])}, Listener()
    for n, key in enumerate(keys, 1):
        toks = split_key(key)
        if not all(t in vocab for t in toks):
            continue
        done = manifest["tokens"].get(key)
        if done and "heard" in done and done.get("voice") == cfg["kokoro_voice"] and done["heard"] >= threshold:
            continue                                           # resumable: already rendered and heard right in this voice
        multi = len(toks) > 1
        want = phrase_text(toks, vocab) if multi else vocab[key]
        base = tts_text(toks, vocab) if multi else vocab[key]
        stem = base.rstrip(".,!?")
        # then the same a little slower: at Kit's 1.12 "forty" comes out as "fourteen" (heard so by Whisper base and small)
        over = TOKEN_OVERRIDES.get(voice_id, {})
        slow = [o[1] for t, o in over.items() if t in toks]
        tries = [(t, sp, cfg["lang"]) for sp in dict.fromkeys([cfg["speed"], round(cfg["speed"] * 0.88, 2)] + slow)
                 for t in dict.fromkeys([base, stem + ",", stem + "."])]
        if not multi and key in over:
            lang, sp = over[key]
            tries = [(t, sp, lang) for t in dict.fromkeys([base, stem + ",", stem + "."])]
        best = None
        for text, speed, lang in tries:
            if lang not in engines:
                engines[lang] = KokoroEngine(lang)
            audio = trim(engines[lang].render(text, cfg["kokoro_voice"], speed))
            sc, heard = ear.score(audio, want)
            if best is None or sc > best[0]:
                best = (sc, audio, heard, text)
            if sc >= threshold:
                break
        sc, audio, heard, text = best
        fname = (safe_name(key) if not multi else "p_" + hashlib.sha1(key.encode()).hexdigest()[:12]) + ".m4a"
        encode_m4a(audio, os.path.join(out_dir, fname))
        manifest["tokens"][key] = {"file": fname, "dur": round(len(audio) / SR, 3), "text": want, "heard": round(sc, 2), "voice": cfg["kokoro_voice"]}
        if n % 20 == 0 or n == len(keys):
            with open(mpath, "w", encoding="utf-8") as f:   # resumable
                json.dump(manifest, f, indent=1)
        print(f"  {voice_id}: [{n}/{len(keys)}] {sc:.2f} {key} | {want} | heard {heard!r}", flush=True)
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)


def relevel(voice_id: str) -> int:
    """Bring every clip a checked rebuild didn't render to the common speech level (TARGET_RMS_DB): decode, level, encode."""
    out_dir = os.path.join(OUT, voice_id)
    manifest = json.load(open(os.path.join(out_dir, "manifest.json"), encoding="utf-8"))
    n = 0
    for key, info in manifest["tokens"].items():
        if "heard" in info:
            continue
        path = os.path.join(out_dir, info["file"])
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
        audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
        if len(audio):
            encode_m4a(audio, path)
            n += 1
    return n


def write_index() -> None:
    voices = []
    for vid in sorted(os.listdir(OUT)):
        m = os.path.join(OUT, vid, "manifest.json")
        if os.path.exists(m):
            d = json.load(open(m, encoding="utf-8"))
            voices.append({"id": d["id"], "name": d["name"], "style": d["style"], "license": d["license"]})
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"voices": voices}, f, indent=1)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", choices=sorted(VOICES))
    ap.add_argument("--all", action="store_true", help="every Kokoro voice (cloned voices need --voice and --ref)")
    ap.add_argument("--phrases", choices=["calls", "core", "units", "mined"], help="add whole-phrase clips to an existing bank")
    ap.add_argument("--missing", action="store_true", help="render only tokens the bank doesn't have yet (keeps phrase clips)")
    ap.add_argument("--redo", action="store_true", help="re-render every phrase clip (e.g. after changing tts_text)")
    ap.add_argument("--recorded", help="dir with recorded_keep.json from tools/split_recording.py")
    ap.add_argument("--ref", help="reference recording for a cloned voice (keep it out of git)")
    ap.add_argument("--rebuild-checked", action="store_true", help="re-render every clip, each checked by Whisper (needs faster-whisper)")
    ap.add_argument("--only", help="with --rebuild-checked: a file of token keys, one per line")
    ap.add_argument("--relevel", action="store_true", help="bring clips not re-rendered to the common speech level")
    args = ap.parse_args(argv)
    ids = sorted(v for v in VOICES if VOICES[v]["engine"] == "kokoro") if args.all else [args.voice] if args.voice else []
    if not ids:
        ap.error("--voice ID or --all")
    for vid in ids:
        if args.relevel:
            print(f"  {vid}: relevelled {relevel(vid)} clips", flush=True)
        elif args.rebuild_checked:
            only = [l.strip() for l in open(args.only, encoding="utf-8") if l.strip()] if args.only else None
            rebuild_checked(vid, only)
        elif args.missing:
            add_missing(vid)
        elif args.phrases:
            build_phrases(vid, args.ref, args.phrases, args.recorded, args.redo)
        else:
            build(vid, args.ref)
    write_index()
    return 0


if __name__ == "__main__":
    sys.exit(main())
