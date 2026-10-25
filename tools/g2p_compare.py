"""Measure web/g2p.js (espeak-free) against misaki, offline. Measuring tool only: never shipped.

    /opt/tts12/bin/python tools/g2p_compare.py --gazetteer 2023_Gaz_place_national.txt [--n 3000]

Needs the Python `misaki` (0.9.4) + `espeakng-loader` env that tools/voicebank.py uses (docs/VOICE.md),
node, and the BART weights already exported to web/g2p/ (tools/g2p_export.py). espeak-ng runs here only
as the reference the shipped Kokoro banks were rendered with; nothing from it reaches web/.

Reports, per accent:
  ref_espeak : misaki dictionary + espeak-ng fallback  (= what tools/voicebank.py / Kokoro training used)
  ref_bart   : misaki dictionary + misaki's BART fallback (max_length 64, like g2p.js)
  js         : web/g2p.js
exact-match rate and phoneme error rate (Levenshtein over phoneme characters / reference length).
"""
import argparse
import json
import os
import random
import re
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NOPLACES = {**os.environ, "G2P_NO_PLACES": "1"}  # measure the misaki port alone, not the app place list

# Driving roads and places a US user will name (hand-picked; mostly out of the dictionary).
ROADS = ["Tail of the Dragon", "Deals Gap", "Cherohala Skyway", "Blue Ridge Parkway", "Moonshiner 28",
         "Diamondback 226", "Back of the Dragon", "Hellbender 28", "Snake 421", "Foothills Parkway",
         "Natchez Trace Parkway", "Beartooth Highway", "Pacific Coast Highway", "Mulholland Highway",
         "Angeles Crest Highway", "Going-to-the-Sun Road", "Talimena Scenic Drive", "Pig Trail",
         "Three Twisted Sisters", "Devil's Whip", "Tellico Plains", "Robbinsville", "Nantahala Gorge",
         "Fontana Dam", "Wolf Creek Pass", "Million Dollar Highway", "Ouray", "Tuolumne Meadows",
         "Skyline Drive", "Cumberland Gap", "Ocoee River", "Suches", "Dahlonega", "Helen", "Hiawassee",
         "Mount Mitchell", "Little Switzerland", "Roan Mountain", "Mohican State Park", "Hocking Hills",
         "Shawnee State Forest", "Kancamagus Highway", "Mount Washington Auto Road", "Hana Highway",
         "Chuckanut Drive", "Willamette Pass", "Saddle Road", "Iron Mountain Road", "Needles Highway",
         "Spearfish Canyon"]
CALLS = ["Left four minus long ..... care ... one fifty.", "Square right into left three, tightens.",
         "Right hairpin ..... double caution.", "Left two plus over crest ... eighty.", "Bump.", "Crest.",
         "Dip.", "Camera.", "Right six long opens ... two hundred.", "Left five off-camber into right four banked."]


def lev(a, b):
    a, b = list(a), list(b)
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def stats(refs, hyps):
    ok = sum(r == h for r, h in zip(refs, hyps))
    err = sum(lev(r, h) for r, h in zip(refs, hyps))
    n = sum(len(r) for r in refs)
    return {"n": len(refs), "exact": round(ok / len(refs), 3), "per": round(err / max(n, 1), 4)}


def gazetteer(path, n, seed=7):
    names = []
    with open(path, encoding="latin-1") as f:
        next(f)
        for line in f:
            name = line.split("\t")[3]
            name = re.sub(r"\s+(city|town|village|CDP|borough|municipality|city and borough|comunidad|zona urbana|"
                          r"urban county|metro government|unified government|consolidated government|"
                          r"metropolitan government|\(balance\))(\s.*)?$", "", name).strip()
            if re.fullmatch(r"[A-Za-z' .-]+", name):
                names.append(name)
    random.Random(seed).shuffle(names)
    return sorted(set(names[:n]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gazetteer")
    ap.add_argument("--n", type=int, default=3000)
    ap.add_argument("--out")
    args = ap.parse_args()
    import torch
    from misaki import en, espeak
    from transformers import BartForConditionalGeneration

    class Bart:  # misaki.en.FallbackNetwork, but from web/g2p/ and max_length 64
        def __init__(self, acc):
            from safetensors.torch import load_file
            from transformers import BartConfig
            meta = json.load(open(f"{REPO}/web/g2p/en_{acc}_fallback.json"))
            cfg = BartConfig(vocab_size=63, d_model=128, encoder_ffn_dim=1024, decoder_ffn_dim=1024, encoder_layers=1,
                             decoder_layers=1, encoder_attention_heads=1, decoder_attention_heads=1,
                             max_position_embeddings=64, bos_token_id=1, eos_token_id=2, pad_token_id=0,
                             decoder_start_token_id=1, forced_eos_token_id=2)
            self.m = BartForConditionalGeneration(cfg).eval()
            self.m.load_state_dict(load_file(f"{REPO}/web/g2p/en_{acc}_fallback.safetensors"), strict=False)
            self.m.tie_weights()
            self.g = {c: i for i, c in enumerate(meta["grapheme_chars"])}
            self.p = {i: c for i, c in enumerate(meta["phoneme_chars"])}

        def word(self, text):
            ids = torch.tensor([[1] + [self.g.get(c, 3) for c in text][:62] + [2]])
            with torch.no_grad():
                out = self.m.generate(input_ids=ids, max_length=64, num_beams=1, do_sample=False)
            return "".join(self.p.get(t, "") for t in out[0].tolist() if t > 3)

        def __call__(self, tk):
            return self.word(tk.text), 1

    texts = {"calls": CALLS, "roads": ROADS}
    if args.gazetteer:
        texts["places"] = gazetteer(args.gazetteer, args.n)
    report = {}
    for acc in ("gb", "us"):
        british = acc == "gb"
        bart = Bart(acc)
        g_es = en.G2P(trf=False, british=british, fallback=espeak.EspeakFallback(british=british), unk="")
        g_bt = en.G2P(trf=False, british=british, fallback=bart, unk="")
        for name, items in texts.items():
            ref_es = [g_es(t)[0].strip() for t in items]
            ref_bt = [g_bt(t)[0].strip() for t in items]
            js = json.loads(subprocess.run(["node", f"{REPO}/tools/g2p_node.js", REPO, acc], input=json.dumps(items),
                                           capture_output=True, text=True, check=True, env=NOPLACES).stdout)
            js = [r["phonemes"] for r in js]
            report[f"{acc}/{name}"] = {"js_vs_ref_bart": stats(ref_bt, js), "js_vs_ref_espeak": stats(ref_es, js),
                                       "ref_bart_vs_ref_espeak": stats(ref_es, ref_bt)}
            if name == "places":  # the fallback alone on single words, port fidelity
                words = sorted({w for t in items for w in t.split() if re.fullmatch(r"[A-Za-z]+", w)})[:1500]
                pyb = [bart.word(w) for w in words]
                jsb = json.loads(subprocess.run(["node", f"{REPO}/tools/g2p_node.js", REPO, acc, "fallback"],
                                                input=json.dumps(words), capture_output=True, text=True, check=True, env=NOPLACES).stdout)
                report[f"{acc}/fallback_words"] = {"js_bart_vs_py_bart": stats(pyb, jsb)}
            if args.out:
                with open(f"{args.out}.{acc}.{name}.json", "w") as f:
                    json.dump([{"text": t, "espeak": a, "bart": b, "js": c} for t, a, b, c in zip(items, ref_es, ref_bt, js)],
                              f, ensure_ascii=False, indent=1)
    json.dump(report, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
