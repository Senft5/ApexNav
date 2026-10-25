"""web/g2p.js: espeak-free English G2P for live Kokoro (docs/VOICE.md "Removing espeak-ng (GPL)").

Expected phonemes were verified, not just snapshotted:
- every in-dictionary case equals Python misaki 0.9.4 with its espeak-ng fallback (the G2P the shipped
  Kokoro banks were rendered with; run offline via tools/g2p_compare.py, espeak never shipped);
- out-of-vocabulary names come from misaki's BART fallback; the JS port matched the Python BART exactly on
  1,472 place-name words. Where the BART output differs from espeak it is marked below. Cherohala was
  read symbol by symbol (chair-oh/uh-HAH-luh); Tellico and Mulholland come from web/g2p/places.json
  because the fallback stressed them wrongly.
Audio was not listened to (see docs/VOICE.md for the Whisper round-trip check).
"""
import json
import os
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

GB = {  # George / Daniel / Emma (British Kokoro voices)
    "Left four minus long ..... care ... one fifty.": "lˈɛft fˈɔː mˈInəs lˈɒŋ ..... kˈɛː ... wˈʌn fˈɪfti.",
    "Square right into left three, tightens.": "skwˈɛː ɹˈIt ˈɪntuː lˈɛft θɹˈiː, tˈItᵊnz.",
    "Right hairpin ..... double caution.": "ɹˈIt hˈɛːpɪn ..... dˈʌbᵊl kˈɔːʃᵊn.",
    "Left two plus over crest ... eighty.": "lˈɛft tˈuː plˈʌs ˈQvə kɹˈɛst ... ˈAti.",
    "Left five off-camber into right four banked.": "lˈɛft fˈIv ˌɒfkˈambə ˈɪntuː ɹˈIt fˈɔː bˈaŋkt.",
    "Right six long opens ... two hundred.": "ɹˈIt sˈɪks lˈɒŋ ˈQpᵊnz ... tˈuː hˈʌndɹəd.",
    "Bump.": "bˈʌmp.",
    "Crest, dip.": "kɹˈɛst, dˈɪp.",
    "Camera.": "kˈaməɹə.",
    "Tail of the Dragon.": "tˈAl ɒv ðə dɹˈaɡᵊn.",
    "Deals Gap": "dˈiːlz ɡˈap",
    "Back of the Dragon": "bˈak ɒv ðə dɹˈaɡᵊn",
    "Blue Ridge Parkway": "blˈuː ɹˈɪʤ pˈɑːkwA",
    "Going-to-the-Sun Road": "ɡˈQɪŋtəðəsˈʌn ɹˈQd",
    "Devil's Whip": "dˈɛvᵊlz wˈɪp",
    "Moonshiner 28": "mˈuːnʃInə twˈɛnti ˈAt",
    "Snake 421": "snˈAk fˈɔː hˈʌndɹəd twˈɛnti wˈʌn",
    "US 129": "jˌuːˈɛs wˈʌn hˈʌndɹəd twˈɛnti nˈIn",
    # OOV, BART fallback; espeak says ʧˌɛɹQhˈɑːlə (schwa vs "oh" in the 2nd syllable)
    "Cherohala Skyway": "ʧˌɛɹəhˈɑːlə skˈIwA",
    "Tellico Plains": "tˈɛlɪkˌQ plˈAnz",  # places.json (BART said tɛlˈiːkQ); equals espeak
}
US = {  # Michael / Jarvis (American Kokoro voices); flap ɾ is written T for Kokoro v1.0
    "Left four minus long ..... care ... one fifty.": "lˈɛft fˈɔɹ mˈInəs lˈɔŋ ..... kˈɛɹ ... wˈʌn fˈɪfti.",
    "Tail of the Dragon.": "tˈAl ʌv ðə dɹˈæɡən.",
    "Natchez Trace Parkway": "nˈæʧəz tɹˈAs pˈɑɹkwˌA",
    "Square right into left three, tightens.": "skwˈɛɹ ɹˈIt ˈɪntu lˈɛft θɹˈi, tˈItnz.",
    "Cherohala Skyway": "ʧˌɛɹOhˈɑlə skˈIwˌA",  # OOV, BART fallback; equals espeak
    "Mulholland Highway": "mʌlhˈɑlənd hˈIwˌA",  # places.json (BART said mˌʌlhˈɑnt)
    "Tellico Plains": "tˈɛlɪkˌO plˈAnz",  # places.json; equals espeak
    "butter": "bˈʌTəɹ",
}
# Kokoro-82M v1.0 tokenizer vocabulary (onnx-community/Kokoro-82M-v1.0-ONNX tokenizer.json)
KOKORO_VOCAB = set(';:,.!?—…"()“” ̃ʣʥʦʨᵝꭧAIOQSTWYᵊabcdefhijklmnopqrstuvwxyzɑɐɒæβɔɕçɖðʤəɚɛɜɟɡɥɨɪʝɯɰŋɳɲɴøɸθœɹɾɻʁɽʂʃʈʧʊʋʌɣɤχʎʒʔˈˌːʰʲ↓→↗↘ᵻ')


def run(acc, texts, mode="phrase", places=True):
    env = dict(os.environ)
    if not places:
        env["G2P_NO_PLACES"] = "1"
    out = subprocess.run([NODE, os.path.join(REPO, "tools", "g2p_node.js"), REPO, acc, mode], input=json.dumps(texts),
                         capture_output=True, text=True, check=True, env=env)
    return json.loads(out.stdout)


@pytest.mark.parametrize("acc,cases", [("gb", GB), ("us", US)])
def test_phonemes_match_verified_expectations(acc, cases):
    got = run(acc, list(cases))
    for (text, want), g in zip(cases.items(), got):
        assert g["phonemes"] == want, (text, g["phonemes"], want)
        assert not g["unknown"], text
        assert set(g["phonemes"]) <= KOKORO_VOCAB, text


def test_unknown_words_go_to_the_fallback_and_are_reported():
    g = run("gb", ["Cherohala Skyway", "Deals Gap"])
    assert g[0]["oov"] == ["Cherohala"] and g[1]["oov"] == []


def test_fallback_matches_python_bart():
    # Python misaki BART (transformers greedy generate, max_length 64) outputs, tools/g2p_compare.py
    assert run("us", ["Cherohala", "Nantahala", "Ocoee", "Deals"], mode="fallback") == ["ʧˌɛɹOhˈɑlə", "nˌɑntəhˈɑlə", "OkˈOi", "dˈilz"]
    assert run("us", ["Mulholland Highway"], places=False)[0]["phonemes"] == "mˌʌlhˈɑnt hˈIwˌA"


def test_shipped_web_app_loads_no_espeak():
    voice = open(os.path.join(REPO, "web", "voice.js"), encoding="utf-8").read()
    assert "kokoro-js@" not in voice and "phonemizer" not in voice
    assert "transformers@3.5.1" in voice
    # markers of espeak-ng code or the libraries that bundle it (kokoro-js web build, phonemizer.js)
    bad = re.compile(r"espeak-ng-data|espeakng|_espeak|kokoro-js@|kokoro\.web\.js|from ['\"]phonemizer|npm/phonemizer")
    for root, _, files in os.walk(os.path.join(REPO, "web")):
        if os.sep + "voices" in root:
            continue  # pre-rendered audio
        for f in files:
            if f.endswith((".js", ".html", ".json", ".mjs")):
                body = open(os.path.join(root, f), encoding="utf-8", errors="ignore").read()
                assert not bad.search(body), (f, bad.search(body))
