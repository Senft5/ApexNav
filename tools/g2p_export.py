"""Build the espeak-free G2P data under web/g2p/ from pinned, permissively licensed sources.

    python3 tools/g2p_export.py

Sources (both Apache-2.0, see THIRD_PARTY_NOTICES.md and docs/VOICE.md "Removing espeak-ng (GPL)"):
- misaki 0.9.4 (hexgrad) wheel from PyPI, sha256-pinned: us/gb gold + silver pronunciation dictionaries,
  already in Kokoro's phoneme set.
- PeterReid/graphemes_to_phonemes_en_{us,gb} (Hugging Face, revision-pinned): the 1+1 layer BART that
  misaki itself uses as its non-espeak fallback for out-of-vocabulary words. Shipped unmodified.

Output: en_{us,gb}_lexicon.json (gold + silver; silver keys that gold already answers are dropped, which
does not change any lookup), en_{us,gb}_fallback.safetensors + .json (char tables), LICENSE-APACHE-2.0.txt.
No espeak-ng code or data is downloaded or produced.
"""
import hashlib
import io
import json
import os
import urllib.request
import zipfile

OUT = os.path.join(os.path.dirname(__file__), "..", "web", "g2p")
MISAKI_WHL = ("https://files.pythonhosted.org/packages/82/ec/0ee4110ddb54278b8f21c40a140370ae8f687036c4edf578316602697c56/"
              "misaki-0.9.4-py3-none-any.whl")
MISAKI_SHA = "90e2eeb169786c014c429e5058d2ea6bcd02d651f2a24450ba6c9ffc0f8da15a"
BART = {
    "us": ("PeterReid/graphemes_to_phonemes_en_us", "a5631b285d18d59483c32c0c3379cb9fac924f4b",
           "dc4a02e62d4fcb4bb4097ecf00db89b8e1a12a549a52ab6adfbba220b80a55c5"),
    "gb": ("PeterReid/graphemes_to_phonemes_en_gb", "d8357d5067fa26a5c34134d6bbcf4bbf000c0ac8",
           "4994f474bb6f4584076a4e98189caaec11aa3f773a0d82d5bc263a03dd07e703"),
}


def fetch(url, sha=None):
    with urllib.request.urlopen(url) as r:
        data = r.read()
    if sha and hashlib.sha256(data).hexdigest() != sha:
        raise SystemExit(f"sha256 mismatch for {url}")
    return data


def grown_has(d, w):
    """misaki Lexicon.grow_dictionary semantics: is w answered by d (exact, or by case variant)?"""
    if w in d:
        return True
    if len(w) < 2:
        return False
    if w == w.lower() and w != w.capitalize():
        return w.capitalize() in d and w.capitalize() == w.capitalize().lower().capitalize()
    if w == w.lower().capitalize():
        return w.lower() in d and w.lower() != w.lower().capitalize()
    return False


def main():
    os.makedirs(OUT, exist_ok=True)
    whl = zipfile.ZipFile(io.BytesIO(fetch(MISAKI_WHL, MISAKI_SHA)))
    lic = [n for n in whl.namelist() if n.endswith("LICENSE")]
    with open(os.path.join(OUT, "LICENSE-APACHE-2.0.txt"), "wb") as f:
        f.write(whl.read(lic[0]))
    for acc in ("us", "gb"):
        gold = json.loads(whl.read(f"misaki/data/{acc}_gold.json"))
        silver = json.loads(whl.read(f"misaki/data/{acc}_silver.json"))
        # Silver is only consulted when gold has no answer, except for proper nouns (is_NNP), which skip
        # silver entirely, so dropping silver keys that gold answers never changes a result.
        silver = {k: v for k, v in silver.items() if not grown_has(gold, k)}
        doc = {"source": f"misaki 0.9.4 (hexgrad/misaki, Apache-2.0) data/{acc}_gold.json + {acc}_silver.json",
               "license": "Apache-2.0", "gold": gold, "silver": silver}
        with open(os.path.join(OUT, f"en_{acc}_lexicon.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        repo, rev, sha = BART[acc]
        base = f"https://huggingface.co/{repo}/resolve/{rev}/"
        with open(os.path.join(OUT, f"en_{acc}_fallback.safetensors"), "wb") as f:
            f.write(fetch(base + "model.safetensors", sha))
        cfg = json.loads(fetch(base + "config.json"))
        meta = {"source": f"https://huggingface.co/{repo} @ {rev} (Apache-2.0), unmodified",
                "license": "Apache-2.0", "grapheme_chars": cfg["grapheme_chars"], "phoneme_chars": cfg["phoneme_chars"],
                "d_model": cfg["d_model"], "max_position_embeddings": cfg["max_position_embeddings"]}
        with open(os.path.join(OUT, f"en_{acc}_fallback.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
        print(acc, len(gold), "gold", len(silver), "silver kept")


if __name__ == "__main__":
    main()
