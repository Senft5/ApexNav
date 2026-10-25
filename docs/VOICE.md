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

## Whole phrases, not stitched words
Stitched single words were audibly choppy, so every bank now plays **whole-phrase clips**:
- Clips are keyed by their token run joined with `+` (`head:L4-+mod:long+caution:1`). `web/voice.js`
  `cover()` plays the longest clip it has for each run and only uses single words for gaps.
- Rendered per voice: every head with each single modifier (units), the 56 exact calls on the shipped
  drives, and ~470 phrases **mined from 1,586 real calls** (`tools/mine_phrases.py`, built from loops in
  seven regions, `tools/call_corpus.json`). Mining takes the average call from 4.3 clips to ~2.
- Kokoro voices go further: at route load the cockpit renders every call the bank can only voice by
  joining clips as one whole phrase in the browser (kokoro-js) and plays that instead (`playWhole`). The
  render happens in route order in the background and never delays a note: if it is not ready, the bank plays.
- `My Voice` (Chatterbox clone + the owner's real recordings) cannot render live, so it relies on the
  pre-rendered phrases above; its real recordings (`src: "recording"`) win over renders.

## Rhythm: why it did not "flow" (measured on the owner's real calls)
Stock TTS reads a call as one run-on at ~3.1–3.4 words/s with no pauses. The owner chunks a call at 2.7
words/s: chunks run together ("Left four opens over crest into right two") and they breathe
**before the caution (0.29–0.43 s) and before the distance (0.18–0.25 s)**, nowhere else (51 clips,
Whisper word timings, `scratchpad` analysis in STATE). Kokoro commas give <0.1 s; a run of dots gives ~0.24 s
inside one sentence. `tts_text()` (Python) and `spokenText(text, rhythm)` (app) put `.....` before the caution
and `...` before the distance; everything else is spoken unpunctuated. Device TTS never gets the dots.

## My Voice: voice conversion, not zero-shot cloning
Chatterbox gave "a voice like me, not me" and cannot run on a phone. Now: Kokoro **Michael** (American male;
a British source leaked its accent) speaks each whole call; **kNN-VC** (MIT, WavLM + HiFi-GAN) replaces every
20 ms frame by the nearest frames of the owner's own recording, then the owner's 54 real calls override the
converted ones. `tools/vc_bank.py`. Held-out calls, Resemblyzer speaker similarity to the owner:
real clip vs own voice 0.89 (ceiling) | stock Kokoro US voices 0.50–0.65 | converted Michael 0.86 (George, British,
sounded British to the owner). Conversion runs ~0.6 s per second of speech on 4 CPU cores. Reference audio stays
local (`--ref-wav`), only converted clips are published. Possible phone path: ONNX WavLM-Base + kNN + HiFi-GAN.

## In-app voice enrollment (design only; owner put voice work on hold)
Goal (owner, 2026-10-25): any user records a short guided session inside the app and the co-driver speaks in their voice from then on, with every phrase
generated whole. No giant call sheet, no server-side training, nothing about the voice leaves the phone.

**Flow.** Setup → Co-driver voice → *Use my voice*:
1. Consent screen: "Only record your own voice. It stays on this phone." (Chatterbox/other models that clone are not used; this is conversion of our own TTS.)
2. Check the room: 3 s of silence measures noise (needs roughly 25 dB below speech), then a level meter coaches distance and warns on clipping or a loud fan.
3. About 4 minutes of **ordinary reading**, 20–25 short lines, one at a time, big text, auto-advancing on silence. The lines are everyday sentences chosen for sound coverage
   (all English phonemes in several contexts) with the pace-note words woven in naturally ("banked", "crest", "tightens", numbers). Resumable; can be extended later.
4. Build (about a minute, once): the voice is made on the phone and a short sample plays: "Left four, long, into square right. Care." Keep / re-record.
5. Delete my voice: one button erases the recording and the voice.

**How the voice is made (kNN-VC, MIT).** The app already speaks every call as one whole sentence with its fast built-in voice. A small model turns each 20 ms of that speech
into the closest 20 ms of the user's own recording. So the words and rhythm come from the app's voice and the sound of it comes from the user's real audio. More recorded speech means a
better match (we measured the owner's 5.7 min at 0.83 speaker similarity against a 0.89 ceiling); extra sessions can be added at any time.
- Needs on the phone: WavLM (feature extractor), a nearest-neighbour search over the user's recording (a few minutes of audio is ~17k vectors), and a vocoder. The research
  checkpoint is WavLM-Large (1.2 GB): too heavy; the spike below tests WavLM-Base+ (~95M parameters, ~100 MB quantised) exported to ONNX and run with ONNX Runtime Web (WASM/WebGPU).
- Timing: our CPU measurement was ~0.6 s of compute per second of speech with the Large model; a route's calls (~300) are converted in the background at route load and cached, never mid-drive.
- Known limit, from the owner's listening: the conversion keeps the source voice's phrasing, so it can sound like "me, but a computer talking". Measurements cannot see this. The best-sounding
  path remains a voice **fine-tuned** on the owner's real speech (Kokoro, on a GPU); in-app enrollment is the zero-setup path that works for every user.

**Spike (1 day, when voice work resumes).** Pass if all hold: (a) WavLM-Base+ ONNX q8 converts a 3 s call in under 3 s on an iPhone 12-class device; (b) speaker similarity with the Base+ model is within 0.05 of
the Large model on the owner's recording; (c) the owner calls it "clearly me" on 10 held-out calls. If it fails, enrollment stays a desktop/PC feature (tools/vc_bank.py) and users get stock voices on the phone.

**Rules.** Only the signed-in person's own recording; no uploading of voice audio ever; the converted clips and the reference both live in the browser's IndexedDB; no sharing of voices between accounts.

## Real recordings (docs/VOICE_SCRIPT.md)
`tools/make_voice_script.py` writes a script; the owner reads it; `tools/split_recording.py` cuts it:
Whisper word timestamps -> fuzzy alignment of every script line -> cut at the quietest point between
lines -> every clip is re-transcribed and checked. Lines read as a rapid list (the bare heads) bleed into
their neighbours and are dropped; the calls read as calls are kept (54 of 56). Clone reference = Part A.

## Building banks (phrases)
```
/opt/tts12/bin/python tools/voicebank.py --voice george --phrases mined          # also calls|core|units
/opt/cbx/bin/python tools/voicebank.py --voice own --ref voice_test/ref.wav      # word bank (clone)
/opt/cbx/bin/python tools/voicebank.py --voice own --ref voice_test/ref.wav --phrases calls --recorded <dir>
/opt/cbx/bin/python tools/voicebank.py --voice own --ref voice_test/ref.wav --phrases mined
```
Renders are resumable (the manifest is written after every clip). The clone needs `setuptools<81`
(Perth watermarker) and takes ~25 s per phrase on 4 CPU cores.

## Path to ANY phrase in the owner's voice (not built; needs a free GPU)
Option research (Opus review, 2026): voice conversion on top of Kokoro stacks two models' errors; a
Kokoro voicepack alone captures about a third of the identity; Piper is GPL (espeak-ng); so the plan is
**distillation into Kokoro itself**:
1. On Kaggle (free T4) render `tools/training_phrases.json` (4,000 phrases: the 1,202 distinct real calls,
   then grammar-random calls) with Chatterbox from the clean reference, ~1–2 h on a GPU (~28 h on CPU).
2. Filter: Whisper must match the text exactly; drop the lowest-10% speaker similarity against the real
   recordings; trim and normalise to -20 LUFS; add the real recordings weighted 3x.
3. Fine-tune Kokoro-82M with the kikiri-tts recipe (StyleTTS2 stages 1+2, ~10 epochs each, 4–8 T4-hours);
   pick the epoch by listening. Fit a voicepack by averaging style vectors over the real lines.
4. Export to ONNX + q8 like `onnx-community/Kokoro-82M-v1.0-ONNX`, host it, point kokoro-js at it. The
   in-browser path is then identical to the stock voices: any call rendered whole at route load.
Spike first (~1 h on Kaggle): fine-tune on ~400 phrases + 134 real lines, hold out 10 real lines; pass if
speaker similarity is within 0.05 of Chatterbox, word error rate is no worse, and 4/10 blind A/B clips are
"as good or better".

## Licences to check before charging for the app
- kokoro-js depends on the `phonemizer` npm package (declared Apache-2.0) built on **espeak-ng (GPL-3.0)**.
  The pace-note vocabulary is closed, so a precomputed phoneme lexicon (misaki, offline) would keep
  espeak-ng out of the shipped app. Verify with a lawyer's eyes, not only with npm metadata.
- Chatterbox: MIT; its output carries an inaudible Perth watermark. Clone only voices whose owners consented.

## Known limits
- New routes still need ~2 clips per call on the clone (distance tails, "into/and" chains): the mined
  phrases cover ~30% of calls as one clip, ~70% as at most two. The Kokoro voices close the gap live.
- Per-clip loudness is peak-normalised, so clips from different renders can differ in level; an LUFS
  pass over the banks would hide more seams.
