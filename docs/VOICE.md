# APEX NAV — CO-DRIVER VOICE

## How it works
1. **Voice banks (pace notes)** — `tools/voicebank.py` renders the whole co-driver vocabulary
   (78 tokens: "Left four minus", "Square right", "long", "tightens", "care" … "triple caution",
   "into", "and", "thirty" … "five hundred", "Bump", "Crest", …) with an open-source TTS model,
   trims silence and encodes AAC clips + `manifest.json` under `web/voices/<id>/`.
   `web/voice.js` turns each structured note (`dir`, `severity`, `grade`, `shape`, `mods`,
   `caution`, `link`) into a token sequence and stitches the clips with WebAudio — the way rally
   games do it. Works offline, starts instantly, sounds identical in Safari, the iOS app and
   (later) CarPlay.
2. **Live synthesis (names, routes)** — the same model runs in the browser via kokoro-js
   (ONNX, quantised WASM, ~90 MB one-time download, cached). Known phrases (a route's name) are
   pre-rendered in the background when the route loads; a phrase that isn't ready within 1.5 s
   falls back to the device voice so pace notes are never delayed. Toggle: LIVE in the route book.
3. **Jarvis** — a machine-speak vocabulary rendered with a deep Kokoro voice, played through a
   cartoon-robot chain (ring modulator 58 Hz, 9 ms comb, soft clip) with a chirp before each call.
4. **DEVICE** — the phone's own voices, for anyone who prefers them.

Voices shipped: George, Daniel (British male), Emma (British female), Jarvis.
Model: Kokoro-82M, Apache-2.0 (hexgrad/Kokoro-82M).

## Building banks
```
uv venv -p 3.12 /opt/tts12
uv pip install --python /opt/tts12/bin/python torch --index-url https://download.pytorch.org/whl/cpu
uv pip install --python /opt/tts12/bin/python kokoro soundfile "numpy<2.3" "spacy==3.8.7" \
    "preshed==3.0.9" "cymem==2.0.10" "murmurhash==1.0.12"      # spaCy pins avoid a tokenizer crash
/opt/tts12/bin/python tools/voicebank.py --all                  # ~3 min on 4 CPU cores
```

## Voice cloning (planned)
Engine: **Chatterbox** (Resemble AI, MIT licence, zero-shot cloning from ~10–20 s of clean speech;
outputs carry an inaudible Perth watermark). Plan:
- `tools/voicebank.py --engine chatterbox --ref sample.wav --voice <id>` renders the same 78-token
  bank in the cloned voice offline (GPU recommended; CPU works, slowly).
- Pace notes are then fully cloned. Live phrases can't run Chatterbox in a phone browser, so names
  would either be pre-rendered server-side when a route is created, or fall back to a Kokoro voice.
- Consent: only clone a voice whose owner has agreed; keep the reference sample out of the repo.

## Known limits
- Clips are rendered in isolation, so some single words are less crisp than in a sentence; an
  automatic transcription pass flagged "tightens", "care", "short" as the weakest. Good enough for now.
