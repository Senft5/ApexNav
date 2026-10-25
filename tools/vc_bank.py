"""Convert a Kokoro voice bank to the owner's voice with kNN-VC (MIT), resumable.

Why: zero-shot cloning (Chatterbox) gave a voice that did not sound like the owner, and cannot run
on a phone. kNN-VC keeps the source's words and rhythm and swaps each 20 ms frame of speech for the
closest frames of the owner's own recording, so timbre comes from real audio of them. Source is an
American male Kokoro voice (a British source leaks its accent through the conversion).

  /opt/cbx/bin/python tools/vc_bank.py --src michael --dst me --ref-wav my_recording.wav [--recorded tools/local/recorded]

Needs torch, torchaudio, soundfile (and ffmpeg). Downloads the kNN-VC code and weights (~1.3 GB) once
to ~/.cache/apexnav/knnvc. The reference recording stays local; only converted clips are published.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voicebank as vb  # noqa: E402

CACHE = os.path.expanduser("~/.cache/apexnav/knnvc")
RAW = "https://raw.githubusercontent.com/bshall/knn-vc/master/"
REL = "https://github.com/bshall/knn-vc/releases/download/v0.1/"
CODE = ["hubconf.py", "matcher.py", "knnvc_utils.py", "wavlm/WavLM.py", "wavlm/modules.py",
        "hifigan/models.py", "hifigan/utils.py", "hifigan/config_v1_wavlm.json"]
WEIGHTS = ["prematch_g_02500000.pt", "WavLM-Large.pt"]


def fetch():
    for f in CODE:
        p = os.path.join(CACHE, "knn", f)
        if not os.path.exists(p):
            os.makedirs(os.path.dirname(p), exist_ok=True)
            urllib.request.urlretrieve(RAW + f, p)
    for f in WEIGHTS:
        p = os.path.join(CACHE, f)
        if not os.path.exists(p):
            print(f"downloading {f} ...", flush=True)
            urllib.request.urlretrieve(REL + f, p)


def load_model():
    import torch
    fetch()
    sys.path.insert(0, os.path.join(CACHE, "knn"))
    os.chdir(os.path.join(CACHE, "knn"))
    files = {w: os.path.join(CACHE, w) for w in WEIGHTS}
    torch.hub.load_state_dict_from_url = lambda url, map_location=None, progress=True: torch.load(
        files[os.path.basename(url)], map_location=map_location, weights_only=False)
    import hubconf
    return hubconf.knn_vc(pretrained=True, prematched=True, device="cuda" if torch.cuda.is_available() else "cpu")


def decode16k(path):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ar", "16000", "-ac", "1", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="source bank id, e.g. michael")
    ap.add_argument("--dst", required=True, help="destination bank id, e.g. me")
    ap.add_argument("--ref-wav", required=True, help="the owner's recording (any length over a few minutes)")
    ap.add_argument("--recorded", help="dir with recorded_keep.json: real clips override converted ones")
    ap.add_argument("--topk", type=int, default=4)
    args = ap.parse_args()
    import torch
    import torchaudio
    torch.set_num_threads(os.cpu_count() or 4)
    vc = load_model()
    wav = torch.from_numpy(decode16k(args.ref_wav))[None]
    chunks = [wav[:, i:i + 16000 * 15] for i in range(0, wav.shape[1], 16000 * 15) if wav[:, i:i + 16000 * 15].shape[1] > 32000]
    ref = torch.cat([vc.get_features(c, vad_trigger_level=0).cpu() for c in chunks], 0)   # chunked: whole file at once exhausts RAM
    print(f"reference: {ref.shape[0] * 0.02 / 60:.1f} min of speech", flush=True)

    src = json.load(open(os.path.join(vb.OUT, args.src, "manifest.json"), encoding="utf-8"))
    cfg = vb.VOICES[args.dst]
    out_dir = os.path.join(vb.OUT, args.dst)
    os.makedirs(out_dir, exist_ok=True)
    mpath = os.path.join(out_dir, "manifest.json")
    manifest = json.load(open(mpath, encoding="utf-8")) if os.path.exists(mpath) else {
        "id": args.dst, "name": cfg["name"], "style": cfg["style"], "engine": cfg["engine"],
        "kokoro_voice": cfg["kokoro_voice"], "speed": cfg["speed"], "license": vb.LICENSES[cfg["engine"]], "tokens": {}}
    todo = [(k, v) for k, v in src["tokens"].items() if k not in manifest["tokens"]]
    for n, (key, v) in enumerate(todo, 1):
        q = vc.get_features(torch.from_numpy(decode16k(os.path.join(vb.OUT, args.src, v["file"])))[None], vad_trigger_level=0)
        out = vc.match(q, ref, topk=args.topk).cpu()
        a = torchaudio.functional.resample(out[None], 16000, vb.SR)[0].numpy().astype(np.float32)
        a = vb.trim(a)
        fname = os.path.splitext(v["file"])[0] + ".m4a"
        vb.encode_m4a(a, os.path.join(out_dir, fname))
        manifest["tokens"][key] = {"file": fname, "dur": round(len(a) / vb.SR, 3), "text": v["text"], "src": "vc"}
        if n % 10 == 0 or n == len(todo):
            json.dump(manifest, open(mpath, "w", encoding="utf-8"), indent=1)
            print(f"  {args.dst}: [{n}/{len(todo)}] {v['text']}", flush=True)
    if args.recorded:
        print(f"merged {vb.merge_recorded(args.dst, args.recorded)} real recordings", flush=True)
    vb.write_index()
    return 0


if __name__ == "__main__":
    sys.exit(main())
